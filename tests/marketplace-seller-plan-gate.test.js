import test from "node:test";
import assert from "node:assert/strict";

import {
  planAtLeast,
  loadShopPlanCode,
  isGrandfatheredSeller,
  requireMarketplaceSellerPlan,
  GRANDFATHER_CUTOFF,
} from "../netlify/functions/_shared/marketplace-plan-gate.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Wholesale marketplace SELLER tools are advertised on the pricing page as
// a Premium-only feature (see public/pricing-catalog.js) — this used to be
// unenforced anywhere in the backend. These tests cover the enforcement:
// buyer-side marketplace access (marketplace-catalog.js, marketplace-checkout.js)
// is deliberately untouched and must stay available on every plan. Shops
// that were already listing products before GRANDFATHER_CUTOFF keep access
// on their current plan; a shop whose first-ever listing is on or after
// the cutoff needs Premium like everyone else.

test("planAtLeast ranks trial < starter < professional/pro < premium", () => {
  assert.equal(planAtLeast("premium", "premium"), true);
  assert.equal(planAtLeast("pro", "premium"), false); // "pro" normalizes to "professional"
  assert.equal(planAtLeast("professional", "premium"), false);
  assert.equal(planAtLeast("starter", "premium"), false);
  assert.equal(planAtLeast(undefined, "premium"), false); // no plan_code row -> "trial" -> below everything but trial
  assert.equal(planAtLeast("premium", "starter"), true);
});

test("loadShopPlanCode reads plan_code for the shop via the caller's own RLS client, normalized", async () => {
  const client = createFakeSupabaseClient([{ data: { plan_code: "pro", status: "active" }, error: null }]);
  const code = await loadShopPlanCode(client, "shop_1");
  assert.equal(code, "professional");
});

test("loadShopPlanCode falls back to 'trial' when the shop has no subscription row yet", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  const code = await loadShopPlanCode(client, "shop_1");
  assert.equal(code, "trial");
});

test("loadShopPlanCode propagates a real query error instead of silently treating it as no-plan", async () => {
  const dbError = new Error("connection reset");
  const client = createFakeSupabaseClient([{ data: null, error: dbError }]);
  await assert.rejects(() => loadShopPlanCode(client, "shop_1"), /connection reset/);
});

test("isGrandfatheredSeller checks for a listing older than the cutoff, scoped to this shop only", async () => {
  const client = createFakeSupabaseClient([{ data: [{ id: "listing_old" }], error: null }]);
  const grandfathered = await isGrandfatheredSeller(client, "shop_1");
  assert.equal(grandfathered, true);
  const call = client.calls.find((c) => c.table === "marketplace_listings");
  assert.ok(call, "expected a marketplace_listings query");
  assert.deepEqual(
    call.ops.find(([op]) => op === "eq")[1],
    ["shop_id", "shop_1"]
  );
  assert.deepEqual(
    call.ops.find(([op]) => op === "lt")[1],
    ["created_at", GRANDFATHER_CUTOFF]
  );
});

test("isGrandfatheredSeller is false for a shop with no pre-cutoff listings", async () => {
  const client = createFakeSupabaseClient([{ data: [], error: null }]);
  assert.equal(await isGrandfatheredSeller(client, "shop_1"), false);
});

test("isGrandfatheredSeller propagates a real query error", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: new Error("timeout") }]);
  await assert.rejects(() => isGrandfatheredSeller(client, "shop_1"), /timeout/);
});

test("requireMarketplaceSellerPlan rejects a Starter/Pro/trial shop with no pre-cutoff listings", async () => {
  for (const planCode of ["starter", "professional", "trial"]) {
    const client = createFakeSupabaseClient([
      { data: { plan_code: planCode }, error: null }, // shop_subscriptions
      { data: [], error: null }, // marketplace_listings — nothing before the cutoff
    ]);
    await assert.rejects(
      () => requireMarketplaceSellerPlan(client, "shop_1"),
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, "plan_upgrade_required");
        assert.match(err.message, /Premium plan/);
        return true;
      }
    );
  }
});

test("requireMarketplaceSellerPlan grandfathers in a Starter shop that already had a listing before the cutoff", async () => {
  const client = createFakeSupabaseClient([
    { data: { plan_code: "starter" }, error: null },
    { data: [{ id: "listing_old" }], error: null },
  ]);
  const code = await requireMarketplaceSellerPlan(client, "shop_1");
  assert.equal(code, "starter", "should return the shop's real (non-Premium) plan, not pretend it's Premium");
});

test("requireMarketplaceSellerPlan does NOT grandfather a new Pro shop whose only listing is on/after the cutoff", async () => {
  // The fake client can't filter by date itself — this documents the real
  // query does the filtering (via the .lt('created_at', cutoff) call
  // asserted above), so a post-cutoff-only seller gets an empty result
  // from the real database and is correctly rejected here.
  const client = createFakeSupabaseClient([
    { data: { plan_code: "professional" }, error: null },
    { data: [], error: null },
  ]);
  await assert.rejects(() => requireMarketplaceSellerPlan(client, "shop_1"), /Premium plan/);
});

test("requireMarketplaceSellerPlan allows a Premium shop through without even checking for grandfathering", async () => {
  const client = createFakeSupabaseClient([{ data: { plan_code: "premium" }, error: null }]);
  const code = await requireMarketplaceSellerPlan(client, "shop_1");
  assert.equal(code, "premium");
  assert.equal(
    client.calls.some((c) => c.table === "marketplace_listings"),
    false,
    "a Premium shop should short-circuit before ever querying marketplace_listings"
  );
});
