import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Priority 6 wiring: run_analytics_ingestion makes the real ingestion job
// reachable through the admin API surface, same pattern as run_publishing_queue.

function superAdminRow() {
  return { data: { user_id: "u1", role: "super_admin", active: true }, error: null };
}

function baseDeps(client) {
  return {
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client
  };
}

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
  process.env.FLORISYN_FLAG_MARKETING_STUDIO = "true";
});
test.after(() => {
  process.env = { ...savedEnv };
});

function event(action, body, { method = "POST", qs = {} } = {}) {
  return {
    httpMethod: method,
    queryStringParameters: { action, ...qs },
    headers: {},
    body: JSON.stringify({ action, ...body })
  };
}

test("run_analytics_ingestion: requires super_admin", async () => {
  const client = createFakeSupabaseClient([{ data: { user_id: "u1", role: "support", active: true }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("run_analytics_ingestion", { shop_id: "shop-1" }));
  assert.equal(res.statusCode, 403);
});

test("run_analytics_ingestion: scoped to the requesting shop and honestly reports the not-live outcome, never a fake success", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: [{ id: "variant-1", shop_id: "shop-1", platform: "tiktok", external_post_id: "ext-1", status: "published" }], error: null }, // variants select
    { data: null, error: null } // last-fetch lookup
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("run_analytics_ingestion", { shop_id: "shop-1" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.processed, 1);
  assert.equal(body.results[0].outcome, "provider_error");
  assert.match(body.note, /NOT LIVE/);

  const variantsCall = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "select"));
  const shopEq = variantsCall.ops.find((op) => op[0] === "eq" && op[1][0] === "shop_id");
  assert.equal(shopEq[1][1], "shop-1");
});

test("run_analytics_ingestion: zero published variants for this shop returns an honest empty result", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: [], error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("run_analytics_ingestion", { shop_id: "shop-1" }));
  const body = JSON.parse(res.body);
  assert.equal(body.processed, 0);
  assert.deepEqual(body.results, []);
});
