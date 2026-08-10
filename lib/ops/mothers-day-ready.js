/** Mother's Day / peak readiness checklist (pure). */

export const MOTHERS_DAY_CHECKLIST = [
  { id: "delivery_fees", label: "Delivery fees & zones updated for peak", category: "pricing" },
  { id: "website_banner", label: "Website hero + Mother's Day landing section live", category: "marketing" },
  { id: "products_published", label: "At least 6 Mother's Day products published online", category: "catalog" },
  { id: "inventory_par", label: "Inventory par levels set for roses & mixed cases", category: "inventory" },
  { id: "staff_scheduled", label: "Designer & driver schedule entered in Staff", category: "ops" },
  { id: "order_cutoff", label: "Same-day cutoff policy posted on website", category: "policy" },
  { id: "payment_deposits", label: "Deposits enabled for large Mother's Day orders", category: "payments" },
  { id: "email_campaign", label: "Email campaign drafted or scheduled", category: "marketing" },
  { id: "holiday_peak", label: "Holiday Command peak window created", category: "ops" },
  { id: "florist_network", label: "Florist Network overflow partner selected", category: "network" }
];

export function scoreReadiness(completedIds = []) {
  const done = new Set(completedIds);
  const total = MOTHERS_DAY_CHECKLIST.length;
  const complete = MOTHERS_DAY_CHECKLIST.filter((i) => done.has(i.id)).length;
  const score = total ? Math.round((complete / total) * 100) : 0;
  let band = "getting_started";
  if (score >= 90) band = "ready";
  else if (score >= 70) band = "almost_there";
  else if (score >= 40) band = "in_progress";
  return { score, complete, total, band };
}

export function autoDetectReadiness(signals = {}) {
  const completed = [];
  if (signals.delivery_fee_set) completed.push("delivery_fees");
  if (signals.website_has_holiday) completed.push("website_banner");
  if (signals.mothers_day_products >= 6) completed.push("products_published");
  if (signals.inventory_items >= 10) completed.push("inventory_par");
  if (signals.staff_count >= 1) completed.push("staff_scheduled");
  if (signals.website_cutoff_text) completed.push("order_cutoff");
  if (signals.payments_enabled) completed.push("payment_deposits");
  if (signals.email_draft) completed.push("email_campaign");
  if (signals.holiday_peak) completed.push("holiday_peak");
  if (signals.network_partner) completed.push("florist_network");
  return completed;
}
