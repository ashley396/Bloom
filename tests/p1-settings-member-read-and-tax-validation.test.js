import test from "node:test";
import assert from "node:assert/strict";
import { handleSettings, MEMBER_READ_FIELDS } from "../netlify/functions/settings.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Launch-readiness P1 #7 follow-up (independent review, 2026-09-28): the
// POS/order-builder preview for a non-privileged member needs the shop's
// real tax rate (it used to fall back to a hard-coded 6% because
// GET /settings was owner/manager only), and the stored rate must be a
// real percentage since every order is now taxed at it server-side.

const SHOP_ID = "shop-a";
const USER = { id: "user-a" };

function event(httpMethod, body) {
  return { httpMethod, headers: {}, body: body === undefined ? undefined : JSON.stringify(body) };
}
function deps(client, role) {
  return { currentUser: async () => ({ client, shopId: SHOP_ID, user: USER, role }) };
}
function selectArgs(client) {
  return client.calls.find((c) => c.table === "shops")?.ops.find(([op]) => op === "select")?.[1]?.[0] || "";
}

test("a cashier's GET returns only the member-safe subset (tax rate, delivery fee, identity) — never the full settings", async () => {
  const client = createFakeSupabaseClient([{ data: { name: "Shop", tax_rate: 8.25, default_delivery_fee: 10 }, error: null }]);
  const res = await handleSettings(event("GET"), deps(client, "cashier"));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.scope, "member");
  assert.equal(body.item.tax_rate, 8.25);
  const cols = selectArgs(client).split(",");
  assert.deepEqual(cols, MEMBER_READ_FIELDS);
  for (const sensitive of ["custom_domain", "slug", "pos_tiles", "register_id", "website_published", "homepage_sections"]) {
    assert.ok(!cols.includes(sensitive), `${sensitive} exposed to a cashier`);
  }
  assert.ok(client.calls[0].ops.some(([op, args]) => op === "eq" && args[0] === "id" && args[1] === SHOP_ID));
});

test("an owner's GET still returns the full settings record", async () => {
  const client = createFakeSupabaseClient([{ data: { name: "Shop", tax_rate: 8.25, custom_domain: "x" }, error: null }]);
  const res = await handleSettings(event("GET"), deps(client, "owner"));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).scope, "full");
  assert.ok(selectArgs(client).split(",").includes("custom_domain"));
});

test("a cashier cannot PATCH settings (403) and nothing reaches the database", async () => {
  const client = { from() { throw new Error("A denied PATCH reached the database."); } };
  const res = await handleSettings(event("PATCH", { tax_rate: 0 }), deps(client, "cashier"));
  assert.equal(res.statusCode, 403);
});

test("owner PATCH validates the tax rate as a 0..100 percentage and stores it as a number", async () => {
  for (const bad of [-1, 101, "abc", "", null, "Infinity"]) {
    const client = { from() { throw new Error("An invalid tax rate reached the database."); } };
    const res = await handleSettings(event("PATCH", { tax_rate: bad }), deps(client, "owner"));
    assert.equal(res.statusCode, 400, `tax_rate ${String(bad)}`);
    assert.match(JSON.parse(res.body).error, /between 0 and 100/);
  }
  const client = createFakeSupabaseClient([{ data: { tax_rate: 7.5 }, error: null }]);
  const res = await handleSettings(event("PATCH", { tax_rate: "7.5", default_delivery_fee: "12" }), deps(client, "manager"));
  assert.equal(res.statusCode, 200);
  const update = client.calls[0].ops.find(([op]) => op === "update")[1][0];
  assert.deepEqual(update, { tax_rate: 7.5, default_delivery_fee: 12 });
});

test("the POS and order-builder previews no longer assume 6% when settings are unavailable", async () => {
  const fs = await import("node:fs");
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.equal((app.match(/tax_rate\?\?6\b/g) || []).length, 0, "a hard-coded 6% fallback is still in app.js");
  assert.doesNotMatch(html, /name="tax_rate" class="order-money"[^>]*value="6"/);
});
