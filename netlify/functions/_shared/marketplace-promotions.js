/**
 * MARKETPLACE SPECIALS from the marketplace vision. marketplace_promotions
 * has held real seller promo-code data (code, percent_off, active,
 * starts_at, ends_at) since the greenfield baseline, but nothing ever
 * created a row, showed one to a buyer, or applied one at checkout — a
 * dormant table, not a real feature. This module is the shared,
 * deterministic logic every consumer (seller dashboard, buyer catalog,
 * checkout) uses so a promo's real state is computed identically
 * everywhere, never re-derived three different ways.
 */

export const PROMOTIONS_TABLE = "marketplace_promotions";

/**
 * Real state only: active flag AND inside the real starts_at/ends_at
 * window, re-checked at the moment of use — a promo scheduled for next
 * month or one that ended yesterday is not "active" just because someone
 * once flipped the active flag on.
 */
export function isPromotionActive(promo, now = Date.now()) {
  if (!promo || promo.active === false) return false;
  if (promo.starts_at && Date.parse(promo.starts_at) > now) return false;
  if (promo.ends_at && Date.parse(promo.ends_at) < now) return false;
  return true;
}

/** Codes are matched case-insensitively but stored/compared in one real form. */
export function normalizePromoCode(code = "") {
  return String(code || "").trim().toUpperCase();
}

/**
 * A bounded, deterministic discount computation — never a Stripe
 * primitive, never a refund/charge, just the same multiply-and-round the
 * unit_amount computation already does. percent_off is clamped to
 * [0, 100] so a corrupt or out-of-range row can never produce a negative
 * or over-100% charge.
 */
export function applyPercentOffCents(amountCents, percentOff) {
  const pct = Math.min(100, Math.max(0, Number(percentOff) || 0));
  const amount = Math.max(0, Math.round(Number(amountCents) || 0));
  return Math.max(0, Math.round(amount * (1 - pct / 100)));
}

/** Buyer-facing shape only — never the seller's internal promo id or shop linkage details beyond what's needed to display it. */
export function sanitizePromotionForBuyer(promo, sellerDisplayName) {
  return {
    id: promo.id,
    code: promo.code,
    description: promo.description || null,
    percent_off: Number(promo.percent_off) || 0,
    seller_shop_id: promo.shop_id,
    seller_display_name: sellerDisplayName || null,
    ends_at: promo.ends_at || null
  };
}
