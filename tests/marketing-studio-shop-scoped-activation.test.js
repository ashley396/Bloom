import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Private shop-scoped activation phase: the global MARKETING_STUDIO flag
// stays OFF in production. A shop only reaches Marketing Studio when its
// OWN shop_admin_config.features.marketing_studio_beta is explicitly true
// — reusing the existing per-shop admin config store (already wired
// through admin-console.js's save_config action), never a second/parallel
// feature-flag system. The super_admin requirement in platformAdmin() is
// completely unchanged by this — these tests always authenticate as a
// real super_admin; what varies is only which shop_id is requested and
// whether THAT shop has the beta key set.

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
  // The whole point of this suite: prove the shop-scoped path works with
  // the GLOBAL flag OFF, exactly as it is in real production right now.
  delete process.env.FLORISYN_FLAG_MARKETING_STUDIO;
});
test.after(() => {
  process.env = { ...savedEnv };
});

function event(action, body, { method = "POST" } = {}) {
  return { httpMethod: method, queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}

test("global flag OFF + requesting shop has features.marketing_studio_beta=true: the action succeeds", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { features: { orders: true, marketing_studio_beta: true } }, error: null } // shop_admin_config lookup for THIS shop
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("status", { shop_id: "shop-ashley" }, { method: "GET" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.marketing_studio_enabled, true);
});

test("global flag OFF + requesting shop's config exists but has no marketing_studio_beta key: forbidden, never fabricated access", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { features: { orders: true } }, error: null } // real row, real other features, but not this one
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("status", { shop_id: "shop-other" }, { method: "GET" }));
  assert.equal(res.statusCode, 403);
});

test("global flag OFF + requesting shop has no shop_admin_config row at all: forbidden, fails closed rather than assuming access", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: null, error: null } // maybeSingle() found nothing
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("status", { shop_id: "shop-brand-new" }, { method: "GET" }));
  assert.equal(res.statusCode, 403);
});

test("global flag OFF + no shop_id supplied at all: forbidden without even attempting a lookup", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow()
    // No second response queued — a DB call here would throw "no more
    // responses", which would fail the test. peekShopId() returning null
    // must short-circuit shopHasMarketingStudioBetaAccess() before any query.
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("status", {}, { method: "GET" }));
  assert.equal(res.statusCode, 403);
});

test("global flag OFF + the shop_admin_config lookup itself errors: fails closed, never grants access on an unclear signal", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: null, error: { message: "connection reset" } }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("status", { shop_id: "shop-ashley" }, { method: "GET" }));
  assert.equal(res.statusCode, 403);
});

test("private activation for one shop has zero effect on another shop: same super_admin caller, different shop_id, same-shaped config without the beta key -> still forbidden", async () => {
  // Proves the gate is keyed by the REQUESTED shop_id's own row, not by
  // caller identity or by "some shop somewhere has beta access."
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { features: { orders: true, marketing_studio_beta: false } }, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("status", { shop_id: "shop-not-ashley" }, { method: "GET" }));
  assert.equal(res.statusCode, 403);
});

test("global flag ON (legacy/founding-beta path, unchanged): access granted without ever querying shop_admin_config", async () => {
  process.env.FLORISYN_FLAG_MARKETING_STUDIO = "true";
  try {
    const client = createFakeSupabaseClient([
      superAdminRow()
      // No shop_admin_config response queued — if the code queried it here,
      // this test would fail with "no more responses." Proves the global
      // flag still short-circuits exactly as before this pass.
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("status", { shop_id: "any-shop-at-all" }, { method: "GET" }));
    assert.equal(res.statusCode, 200);
  } finally {
    delete process.env.FLORISYN_FLAG_MARKETING_STUDIO;
  }
});
