/** Bloom shop SaaS billing — plan labels and helpers (pure). */

import {
  PRICING_TIERS,
  monthlyPrice as pricingMonthly,
  planQuote,
  validSubscriptionPrices as pricingValidPrices
} from "../../../lib/pricing/florisyn-pricing.js";

export const PLAN_CATALOG = Object.fromEntries([
  ["trial", { label: "Trial", price: 0, code: "trial" }],
  ...PRICING_TIERS.map((t) => [t.code, { label: t.name, price: t.monthly, code: t.code }])
]);

export const PLAN_ORDER = ["starter", "professional", "premium"];

export function planLabel(planCode) {
  return PLAN_CATALOG[planCode]?.label || String(planCode || "Trial");
}

export function planPrice(planCode) {
  const code = planCode === "pro" ? "professional" : planCode;
  return PLAN_CATALOG[code]?.price ?? pricingMonthly(code);
}

export function validSubscriptionPrices() {
  return pricingValidPrices();
}

export { planQuote };

export function upgradeTarget(current) {
  const i = PLAN_ORDER.indexOf(current);
  if (i < 0 || i >= PLAN_ORDER.length - 1) return null;
  return PLAN_ORDER[i + 1];
}

export function downgradeTarget(current) {
  const i = PLAN_ORDER.indexOf(current);
  if (i <= 0) return null;
  return PLAN_ORDER[i - 1];
}

export function formatBillingDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

export function subscriptionStatusLabel(status, cancelAtPeriodEnd) {
  if (cancelAtPeriodEnd) return "Cancels at period end";
  const map = {
    active: "Active",
    trialing: "Trial",
    past_due: "Past due",
    paused: "Paused",
    canceled: "Canceled",
    incomplete: "Incomplete"
  };
  return map[String(status || "").toLowerCase()] || status || "—";
}

export function canManageShopBilling(role) {
  return String(role || "").toLowerCase() === "owner";
}
