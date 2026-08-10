/** Bloom shop SaaS billing — plan labels and helpers (pure). */

export const PLAN_CATALOG = {
  trial: { label: "Trial", price: 0, code: "trial" },
  starter: { label: "Starter", price: 59, code: "starter" },
  professional: { label: "Professional", price: 99, code: "professional" },
  premium: { label: "Premium", price: 149, code: "premium" }
};

export const PLAN_ORDER = ["starter", "professional", "premium"];

export function planLabel(planCode) {
  return PLAN_CATALOG[planCode]?.label || String(planCode || "Trial");
}

export function planPrice(planCode) {
  const code = planCode === "pro" ? "professional" : planCode;
  return PLAN_CATALOG[code]?.price ?? 0;
}

export function validSubscriptionPrices() {
  return PLAN_ORDER.map((code) => PLAN_CATALOG[code].price);
}

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
