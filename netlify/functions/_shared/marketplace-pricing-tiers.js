/**
 * MARKETPLACE VOLUME PRICING from the marketplace vision. marketplace_pricing_tiers
 * has existed since the greenfield baseline, and the seller dashboard's
 * "Pricing" tab has always let a seller create real rows (name,
 * min_quantity, discount_percent) — but nothing downstream ever read a
 * tier back: checkout never looked the table up, so a buyer ordering 500
 * units paid exactly the same per-unit price as a buyer ordering 1, no
 * matter what volume discounts the seller configured. This module is the
 * shared, deterministic logic so "which tier applies, and at what
 * discount" is computed identically everywhere it's needed — today just
 * checkout, but the same function is what any future surface (a
 * buyer-facing "order 50+ to unlock 10% off" hint, for example) should
 * reuse rather than re-deriving the threshold logic.
 */

export const PRICING_TIERS_TABLE = "marketplace_pricing_tiers";

/**
 * Given a seller's active tiers and the real total quantity being bought
 * from that seller in this order, returns the single best-fit tier — the
 * highest min_quantity threshold the order's quantity actually meets or
 * exceeds — or null if no tier's threshold is met. "Best fit" (not "first
 * match" or "any match") matters: a seller with both a 10-unit and a
 * 50-unit tier configured expects an 80-unit order to get the deeper
 * 50-unit discount, not whichever tier happens to be listed first.
 */
export function bestPricingTierFor(tiers, totalQuantity) {
  const qty = Number(totalQuantity) || 0;
  let best = null;
  for (const tier of tiers || []) {
    if (tier.active === false) continue;
    const threshold = Number(tier.min_quantity) || 0;
    if (qty < threshold) continue;
    if (!best || threshold > (Number(best.min_quantity) || 0)) best = tier;
  }
  return best;
}
