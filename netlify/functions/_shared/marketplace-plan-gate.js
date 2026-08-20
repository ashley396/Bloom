/**
 * Wholesale marketplace SELLER tools (listing products for sale, pricing
 * tiers, promotions, order management as a seller) are advertised on the
 * pricing page as a Premium-plan feature — see the "Wholesale marketplace
 * seller tools" line under Premium in public/pricing-catalog.js. This is
 * the enforcement for that claim.
 *
 * Buyer-side marketplace access (browsing, ordering, standing orders,
 * reorder) is NOT covered by this gate and remains available on every
 * plan — that was a deliberate finding, not an oversight, and nothing
 * here should be applied to marketplace-catalog.js or
 * marketplace-checkout.js.
 */
import { normalizePlanCode } from "./subscription-center.js";

const PLAN_RANK = { trial: 0, starter: 1, professional: 2, premium: 3 };

export function planAtLeast(planCode, minimumCode) {
  const rank = PLAN_RANK[normalizePlanCode(planCode)] ?? 0;
  const minRank = PLAN_RANK[minimumCode] ?? 0;
  return rank >= minRank;
}

/**
 * Reads the shop's current plan_code via the caller's own RLS-scoped
 * client (the same "members read subscription" policy shop-billing.js
 * already relies on) — never the service-role client, so this can't be
 * used to peek at another shop's plan.
 */
export async function loadShopPlanCode(client, shopId) {
  const { data, error } = await client
    .from("shop_subscriptions")
    .select("plan_code, status")
    .eq("shop_id", shopId)
    .maybeSingle();
  if (error) throw error;
  return normalizePlanCode(data?.plan_code);
}

export async function requireMarketplaceSellerPlan(client, shopId) {
  const planCode = await loadShopPlanCode(client, shopId);
  if (!planAtLeast(planCode, "premium")) {
    const e = new Error(
      "Wholesale marketplace seller tools are available on the Premium plan. Upgrade your plan to list products for sale in the wholesale marketplace."
    );
    e.statusCode = 403;
    e.code = "plan_upgrade_required";
    throw e;
  }
  return planCode;
}
