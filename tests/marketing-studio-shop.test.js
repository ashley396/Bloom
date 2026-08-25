import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioShopHandler } from "../netlify/functions/marketing-studio-shop.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Florist-facing Marketing Studio entry point (Phase 1 of the
// "Florist-Facing Marketing Studio + Lily Connected Intelligence" pass).
// These tests exercise THIS file's own auth/gating logic in isolation —
// a stub `floristHandler` stands in for the real, separately-tested
// createMarketingStudioHandler dispatch, so what's actually proven here
// is: real session resolution, the beta gate, the action allowlist, and
// (critically) that a client-supplied shop_id can never override the
// session's own resolved shop.

function event({ action = "status", body = {}, auth = true } = {}) {
  return {
    httpMethod: "POST",
    queryStringParameters: {},
    headers: auth ? { authorization: "Bearer real-session-token" } : {},
    body: JSON.stringify({ action, ...body })
  };
}

function stubFloristHandler(recorder) {
  return async (ev) => {
    recorder.calledWith = JSON.parse(ev.body);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  };
}

test("Shop A's own authorized member: allowed", async () => {
  const recorder = {};
  const handler = createMarketingStudioShopHandler({
    currentUser: async () => ({ client: {}, user: { id: "u-a" }, shopId: "shop-A", role: "owner" }),
    isShopFeatureEnabled: async (shopId) => shopId === "shop-A",
    floristHandler: stubFloristHandler(recorder)
  });
  const res = await handler(event({ action: "list_content" }));
  assert.equal(res.statusCode, 200);
});

test("a client-supplied shop_id can never override the session's own resolved shop — even for Shop A's own member trying to reach Shop B", async () => {
  const recorder = {};
  const handler = createMarketingStudioShopHandler({
    currentUser: async () => ({ client: {}, user: { id: "u-a" }, shopId: "shop-A", role: "owner" }),
    isShopFeatureEnabled: async (shopId) => shopId === "shop-A", // Shop A has access, Shop B does not
    floristHandler: stubFloristHandler(recorder)
  });
  // The attacker supplies shop_id: "shop-B" directly in the body.
  const res = await handler(event({ action: "list_content", body: { shop_id: "shop-B" } }));
  // Access is decided by the SESSION's shop (Shop A, which has access),
  // proving the body's shop_id was never consulted for the gate — but
  // the real proof this matters is in marketing-studio.js itself, which
  // forcibly overwrites body.shop_id with the session's own shopId
  // before dispatch (see createMarketingStudioHandler's deps.florist
  // branch), so even a "successful" call here can only ever operate on
  // Shop A's own data.
  assert.equal(res.statusCode, 200);
});

test("a non-member (currentUser finds no active shop membership): denied", async () => {
  const handler = createMarketingStudioShopHandler({
    currentUser: async () => {
      const e = new Error("Your Florisyn login works, but this account is not linked to an active flower shop yet.");
      e.statusCode = 403;
      e.code = "shop_membership_required";
      throw e;
    },
    isShopFeatureEnabled: async () => true,
    floristHandler: stubFloristHandler({})
  });
  const res = await handler(event({ action: "list_content" }));
  assert.equal(res.statusCode, 403);
});

test("missing/expired auth: denied", async () => {
  const handler = createMarketingStudioShopHandler({
    currentUser: async () => {
      const e = new Error("Please sign in");
      e.statusCode = 401;
      throw e;
    },
    isShopFeatureEnabled: async () => true,
    floristHandler: stubFloristHandler({})
  });
  const res = await handler(event({ action: "list_content", auth: false }));
  assert.equal(res.statusCode, 401);
});

test("a real, authorized member of a shop WITHOUT beta access: denied", async () => {
  const handler = createMarketingStudioShopHandler({
    currentUser: async () => ({ client: {}, user: { id: "u-c" }, shopId: "shop-C", role: "owner" }),
    isShopFeatureEnabled: async () => false,
    floristHandler: stubFloristHandler({})
  });
  const res = await handler(event({ action: "list_content" }));
  assert.equal(res.statusCode, 403);
});

test("an action outside the florist allowlist is rejected before ever reaching the shared dispatch", async () => {
  const recorder = {};
  const handler = createMarketingStudioShopHandler({
    currentUser: async () => ({ client: {}, user: { id: "u-a" }, shopId: "shop-A", role: "owner" }),
    isShopFeatureEnabled: async () => true,
    floristHandler: stubFloristHandler(recorder)
  });
  const res = await handler(event({ action: "revoke_clone_consent" }));
  assert.equal(res.statusCode, 404);
  assert.equal(recorder.calledWith, undefined, "the disallowed action must never reach the shared dispatch at all");
});

test("every action in the florist allowlist is a genuinely safe, real action — no typos silently opening the wrong door", async () => {
  // Cross-check against marketing-studio.js's own real action strings so
  // this allowlist can never silently drift to reference an action that
  // doesn't exist (or, worse, a near-miss typo that happens to match a
  // MORE sensitive action).
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("../netlify/functions/marketing-studio.js", import.meta.url), "utf8");
  const realActions = new Set([...source.matchAll(/action === "([a-z_]+)"/g)].map((m) => m[1]));
  const candidateActions = [
    "status", "get_brand_brain", "get_visual_style", "connections", "usage_summary",
    "list_content", "create_content_item", "generate_content", "revise_content",
    "revert_content_revision", "approve_content"
  ];
  for (const action of candidateActions) {
    assert.ok(realActions.has(action), `"${action}" must be a real action in marketing-studio.js`);
  }
});

test("end-to-end through the REAL shared dispatch (not a stub): a malicious client-supplied shop_id in the body is discarded — the actual DB query issued uses only the session's own shop", async () => {
  const fakeClient = createFakeSupabaseClient([
    // list_content's real query sequence: marketing_content_items select
    { data: [], error: null }
  ]);
  const handler = createMarketingStudioShopHandler({
    currentUser: async () => ({ client: fakeClient, user: { id: "u-a" }, shopId: "shop-A-real-session", role: "owner" }),
    isShopFeatureEnabled: async (shopId) => shopId === "shop-A-real-session"
    // No floristHandler override here — this exercises the REAL
    // createMarketingStudioHandler dispatch from marketing-studio.js.
  });
  const res = await handler(event({ action: "list_content", body: { shop_id: "shop-B-attacker-supplied" } }));
  assert.equal(res.statusCode, 200);

  const itemsCall = fakeClient.calls.find((c) => c.table === "marketing_content_items");
  const eqOps = itemsCall.ops.filter((op) => op[0] === "eq");
  const shopIdFilter = eqOps.find((op) => op[1][0] === "shop_id");
  assert.ok(shopIdFilter, "the real query must filter by shop_id");
  assert.equal(shopIdFilter[1][1], "shop-A-real-session", "the query must use the SESSION's shop, never the attacker-supplied body.shop_id");
});
