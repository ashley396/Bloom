/** Subscription Center — dates, metrics, exit survey (pure). */

export const EXIT_SURVEY_REASONS = [
  { code: "too_expensive", label: "Cost" },
  { code: "missing_features", label: "Missing features" },
  { code: "switching_provider", label: "Switching to another product" },
  { code: "seasonal_closure", label: "Seasonal / temporary closure" },
  { code: "business_closed", label: "Business closed" },
  { code: "other", label: "Other" }
];

const PLAN_PRICE = { starter: 39, professional: 79, premium: 129, trial: 0, pro: 79 };

export function normalizePlanCode(code) {
  if (code === "pro") return "professional";
  return code || "trial";
}

export function accessExpirationDate(sub = {}) {
  if (sub.status === "canceled") return sub.current_period_ends_at || sub.updated_at;
  if (sub.cancel_at_period_end) return sub.current_period_ends_at || sub.trial_ends_at;
  return null;
}

export function finalBillingDate(sub = {}) {
  if (sub.cancel_at_period_end || sub.status === "canceled") {
    return sub.current_period_ends_at || sub.trial_ends_at;
  }
  return sub.current_period_ends_at || sub.trial_ends_at;
}

export function buildCancellationSummary(sub = {}) {
  const access = accessExpirationDate(sub);
  const billing = finalBillingDate(sub);
  return {
    final_billing_date: billing,
    access_expiration_date: access,
    data_export_reminder: true,
    message: "Your shop data remains available until access ends. Export anytime before that date."
  };
}

export function computeAdminSubscriptionMetrics(rows = [], events = []) {
  const counts = { active: 0, paused: 0, canceled: 0, trial: 0, reactivated: 0 };
  let mrr = 0;
  for (const row of rows) {
    const status = String(row.status || "").toLowerCase();
    const plan = normalizePlanCode(row.plan_code);
    if (status === "active") {
      counts.active += 1;
      mrr += PLAN_PRICE[plan] || 0;
    } else if (status === "paused") counts.paused += 1;
    else if (status === "canceled") counts.canceled += 1;
    else if (status === "trialing" || plan === "trial") counts.trial += 1;
  }
  const reactivated = events.filter((e) => e.event_type === "reactivate").length;
  const canceledEvents = events.filter((e) => e.event_type === "cancel").length;
  counts.reactivated = reactivated;
  const churnRate =
    rows.length > 0 ? Math.round((counts.canceled / Math.max(1, rows.length)) * 1000) / 10 : 0;
  const reasonCounts = {};
  for (const e of events) {
    if (e.reason_code) reasonCounts[e.reason_code] = (reasonCounts[e.reason_code] || 0) + 1;
  }
  return {
    counts: { ...counts, reactivated },
    mrr: Math.round(mrr * 100) / 100,
    churn_percent: churnRate,
    cancel_events: canceledEvents,
    reason_codes: reasonCounts
  };
}

export function subscriptionEventType(action) {
  const map = {
    pause: "pause",
    resume: "resume",
    cancel: "cancel",
    reactivate: "reactivate",
    upgrade: "upgrade",
    downgrade: "downgrade",
    download_data: "export"
  };
  return map[action] || action;
}
