import test from "node:test";
import assert from "node:assert/strict";
import { isShopFeatureEnabled } from "../netlify/functions/_shared/shop-feature-access.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Florisyn's standard shop-scoped staged-rollout mechanism (Phase 2 of the
// "Florist-Facing Marketing Studio + Lily Connected Intelligence" pass).
// These tests exercise the shared helper directly, independent of any one
// caller (marketing-studio.js's own featureGate tests separately prove it
// wires this in correctly).

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
  delete process.env.FLORISYN_FLAG_SOME_FEATURE;
});
test.after(() => {
  process.env = { ...savedEnv };
});

test("isShopFeatureEnabled: true when the shop's own features row has the key set true", async () => {
  const client = createFakeSupabaseClient([{ data: { features: { some_feature: true } }, error: null }]);
  const result = await isShopFeatureEnabled("shop-1", "some_feature", { client });
  assert.equal(result, true);
});

test("isShopFeatureEnabled: false when the key is absent from an otherwise real row", async () => {
  const client = createFakeSupabaseClient([{ data: { features: { other_feature: true } }, error: null }]);
  const result = await isShopFeatureEnabled("shop-1", "some_feature", { client });
  assert.equal(result, false);
});

test("isShopFeatureEnabled: false, not thrown, when no config row exists for this shop", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  const result = await isShopFeatureEnabled("shop-1", "some_feature", { client });
  assert.equal(result, false);
});

test("isShopFeatureEnabled: fails closed on a DB error rather than throwing or defaulting true", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { message: "connection reset" } }]);
  const result = await isShopFeatureEnabled("shop-1", "some_feature", { client });
  assert.equal(result, false);
});

test("isShopFeatureEnabled: false on a malformed (non-object) features value, never throws", async () => {
  const client = createFakeSupabaseClient([{ data: { features: "not-an-object" }, error: null }]);
  const result = await isShopFeatureEnabled("shop-1", "some_feature", { client });
  assert.equal(result, false);
});

test("isShopFeatureEnabled: false immediately with no shopId or featureKey, never queries", async () => {
  const client = createFakeSupabaseClient([]); // any query here would throw "no more responses"
  assert.equal(await isShopFeatureEnabled(null, "some_feature", { client }), false);
  assert.equal(await isShopFeatureEnabled("shop-1", null, { client }), false);
});

// isFeatureEnabled() only recognizes names pre-registered in
// feature-flags.js's DEFAULT_FLAGS — using the real "MARKETING_STUDIO"
// flag here rather than an invented name, since an unregistered name is
// silently always false regardless of env, which would make this test
// meaningless.
test("isShopFeatureEnabled: a real global flag name, when enabled, grants every shop access without querying the per-shop row", async () => {
  process.env.FLORISYN_FLAG_MARKETING_STUDIO = "true";
  try {
    const client = createFakeSupabaseClient([]); // a query here would throw "no more responses"
    const result = await isShopFeatureEnabled("any-shop-at-all", "some_feature", { globalFlagName: "MARKETING_STUDIO", client });
    assert.equal(result, true);
  } finally {
    delete process.env.FLORISYN_FLAG_MARKETING_STUDIO;
  }
});

test("isShopFeatureEnabled: with a global flag name but the flag OFF, still falls through to the real per-shop check", async () => {
  const client = createFakeSupabaseClient([{ data: { features: { some_feature: true } }, error: null }]);
  const result = await isShopFeatureEnabled("shop-1", "some_feature", { globalFlagName: "MARKETING_STUDIO", client });
  assert.equal(result, true);
});
