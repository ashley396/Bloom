import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Ad-hoc single-item creation (Phase 1 of the "Florist-Facing Marketing
// Studio" pass) — plan_month is a whole-month planner; this closes the
// real gap it left: no way to create just ONE content item for a
// florist's own free-form request ("create a Facebook post for a fresh
// flower arrangement").

function superAdminRow() {
  return { data: { user_id: "u1", role: "super_admin", active: true }, error: null };
}
function baseDeps(client) {
  return { authenticate: async () => ({ user: { id: "u1" } }), createServerClient: () => client };
}
function event(body) {
  return { httpMethod: "POST", queryStringParameters: {}, headers: {}, body: JSON.stringify({ action: "create_content_item", ...body }) };
}

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
  process.env.FLORISYN_FLAG_MARKETING_STUDIO = "true";
});
test.after(() => {
  process.env = { ...savedEnv };
});

test("create_content_item: creates exactly one idea-status item + its variant rows, from a free-form brief", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "image_post", title: "fresh flower arrangement", brief: "fresh flower arrangement", status: "idea" }, error: null },
    { data: [{ id: "variant-1", content_item_id: "item-1", platform: "facebook" }], error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event({ shop_id: "shop-1", brief: "fresh flower arrangement", platforms: ["facebook"] }));
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.item.status, "idea");
  assert.equal(body.item.variants.length, 1);

  const insertCall = client.calls.find((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "insert"));
  assert.equal(insertCall.payload.status, "idea");
  assert.equal(insertCall.payload.shop_id, "shop-1");
  assert.equal(insertCall.payload.requires_human_approval, true, "an ad-hoc item still requires explicit human approval before anything can publish");
});

test("create_content_item: refuses an empty brief rather than creating a blank item", async () => {
  const client = createFakeSupabaseClient([superAdminRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event({ shop_id: "shop-1", brief: "   " }));
  assert.equal(res.statusCode, 400);
});

test("create_content_item: rejects an unsupported platform rather than silently dropping it", async () => {
  const client = createFakeSupabaseClient([superAdminRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event({ shop_id: "shop-1", brief: "fresh flowers", platforms: ["not_a_real_platform"] }));
  assert.equal(res.statusCode, 400);
});

test("create_content_item: requires a shop_id", async () => {
  const client = createFakeSupabaseClient([superAdminRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event({ brief: "fresh flowers" }));
  assert.equal(res.statusCode, 400);
});
