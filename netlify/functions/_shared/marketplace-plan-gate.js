/**
 * Wholesale marketplace SELLER tools (listing products for sale, pricing
 * tiers, promotions, order management as a seller) are advertised on the
 * pricing page as a Premium-plan feature — see the "Wholesale marketplace
 * seller tools" line under Premium in public/pricing-catalog.js. This is
 * the enforcement for that claim.
 *
 * Shops that were already using seller tools before this enforcement
 * shipped are grandfathered in on their current plan — see
 * GRANDFATHER_CUTOFF and isGrandfatheredSeller below. Nothing here
 * suspends or archives their existing listings; it only decides who
 * still gets in without upgrading.
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

// The day Premium-only enforcement shipped for seller tools. Any shop
// with a marketplace listing that already existed before this moment was
// genuinely using the feature under the old (unenforced) behavior, not
// signing up to dodge a paywall the same day it appeared — grandfather
// them in on whatever plan they're on. A shop that creates its first
// listing on or after this cutoff needs Premium like everyone else.
export const GRANDFATHER_CUTOFF = "2026-08-20T00:00:00.000Z";

/**
 * True if this shop already had at least one marketplace listing (draft,
 * published, or archived — any of them proves real prior use) before the
 * grandfather cutoff. Uses the caller's own RLS-scoped client, same as
 * loadShopPlanCode — a shop can only ever check its own history here.
 */
export async function isGrandfatheredSeller(client, shopId, cutoff = GRANDFATHER_CUTOFF) {
  const { data, error } = await client
    .from("marketplace_listings")
    .select("id")
    .eq("shop_id", shopId)
    .lt("created_at", cutoff)
    .limit(1);
  if (error) throw error;
  return Boolean(data && data.length);
}

export async function requireMarketplaceSellerPlan(client, shopId) {
  const planCode = await loadShopPlanCode(client, shopId);
  if (planAtLeast(planCode, "premium")) return planCode;
  if (await isGrandfatheredSeller(client, shopId)) return planCode;
  const e = new Error(
    "Wholesale marketplace seller tools are available on the Premium plan. Upgrade your plan to list products for sale in the wholesale marketplace."
  );
  e.statusCode = 403;
  e.code = "plan_upgrade_required";
  throw e;
}
