import test from "node:test";
import assert from "node:assert/strict";

import { planAtLeast, loadShopPlanCode, requireMarketplaceSellerPlan } from "../netlify/functions/_shared/marketplace-plan-gate.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Wholesale marketplace SELLER tools are advertised on the pricing page as
// a Premium-only feature (see public/pricing-catalog.js) — this used to be
// unenforced anywhere in the backend. These tests cover the enforcement:
// buyer-side marketplace access (marketplace-catalog.js, marketplace-checkout.js)
// is deliberately untouched and must stay available on every plan.

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

test("requireMarketplaceSellerPlan rejects Starter and Pro shops with a clear, upgrade-labeled 403", async () => {
  for (const planCode of ["starter", "professional", "trial"]) {
    const client = createFakeSupabaseClient([{ data: { plan_code: planCode }, error: null }]);
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

test("requireMarketplaceSellerPlan allows a Premium shop through and returns its plan code", async () => {
  const client = createFakeSupabaseClient([{ data: { plan_code: "premium" }, error: null }]);
  const code = await requireMarketplaceSellerPlan(client, "shop_1");
  assert.equal(code, "premium");
});
