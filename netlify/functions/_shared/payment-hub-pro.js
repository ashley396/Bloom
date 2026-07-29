/** Payment Hub Pro v1.1 — dashboard, refunds, wholesale, wizard, admin metrics (pure). */

export const SETUP_WIZARD_OPTIONS = [
  { id: "stripe", label: "Stripe" },
  { id: "square", label: "Square" },
  { id: "clover", label: "Clover" },
  { id: "paypal", label: "PayPal" },
  { id: "authorize_net", label: "Authorize.net" },
  { id: "none", label: "I don't have one yet" }
];

export const FUTURE_PAYMENT_RAILS = [
  { id: "apple_pay", label: "Apple Pay", status: "placeholder" },
  { id: "google_pay", label: "Google Pay", status: "placeholder" },
  { id: "ach", label: "ACH", status: "placeholder" },
  { id: "afterpay", label: "Afterpay", status: "placeholder" },
  { id: "klarna", label: "Klarna", status: "placeholder" }
];

export const REFUND_REASONS = ["customer_request", "duplicate", "fraudulent", "product_issue", "other"];

export function buildProDashboard(summary = {}, extras = {}) {
  return {
    todays_sales: summary.daily_sales ?? 0,
    refunds: summary.refunds ?? 0,
    pending_payouts: extras.pending_payouts ?? 0,
    failed_payments: extras.failed_payments ?? 0,
    transaction_count: summary.count ?? 0
  };
}

export function buildSalesByProcessor(payments = []) {
  const map = {};
  for (const p of payments) {
    const proc = String(p.processor || p.metadata?.processor || "manual").toLowerCase();
    map[proc] = (map[proc] || 0) + Number(p.amount || 0);
  }
  return map;
}

export function buildTipsReport(payments = []) {
  return payments.reduce((sum, p) => sum + Number(p.metadata?.tip || p.tip || 0), 0);
}

export function buildHouseAgingReport(accounts = [], transactions = [], asOf = new Date()) {
  const now = asOf.getTime();
  const buckets = { current: 0, days_30: 0, days_60: 0, days_90_plus: 0 };
  for (const acct of accounts) {
    const balance = Number(acct.balance || 0);
    if (balance <= 0) continue;
    const lastCharge = transactions
      .filter((t) => t.house_account_id === acct.id && t.kind === "charge")
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    const ageDays = lastCharge ? Math.floor((now - new Date(lastCharge.created_at).getTime()) / 86400000) : 0;
    if (ageDays <= 30) buckets.current += balance;
    else if (ageDays <= 60) buckets.days_30 += balance;
    else if (ageDays <= 90) buckets.days_60 += balance;
    else buckets.days_90_plus += balance;
  }
  return buckets;
}

export function validateRefundRequest({ amount, paymentAmount, partial = false }) {
  const a = Number(amount || 0);
  const max = Math.abs(Number(paymentAmount || 0));
  if (a <= 0) return { valid: false, error: "Refund amount must be positive." };
  if (a > max + 0.005) return { valid: false, error: "Refund cannot exceed original payment." };
  return { valid: true, partial: partial || a < max - 0.005, amount: Math.round(a * 100) / 100 };
}

export function validateGiftCardReload({ balance, amount }) {
  const a = Number(amount || 0);
  if (a <= 0) return { valid: false, error: "Reload amount must be positive." };
  return { valid: true, new_balance: Math.round((Number(balance || 0) + a) * 100) / 100 };
}

export function validateWholesaleCredit({ outstanding, credit_limit, additional = 0 }) {
  const next = Number(outstanding || 0) + Number(additional || 0);
  const limit = Number(credit_limit || 0);
  if (limit > 0 && next > limit) return { valid: false, error: "Wholesale credit limit exceeded." };
  return { valid: true, available: limit > 0 ? Math.max(0, limit - next) : null };
}

export function giftCardQrPayload(shopId, code) {
  return JSON.stringify({ v: 1, type: "bloom_gift_card", shop_id: shopId, code: String(code || "").toUpperCase() });
}

export function buildPlatformPaymentMetrics(rows = []) {
  const byProvider = {};
  let failures = 0;
  let webhookErrors = 0;
  for (const row of rows) {
    byProvider[row.provider_id] = (byProvider[row.provider_id] || 0) + 1;
    if (row.status === "error" || row.event_type === "connection_failure") failures += 1;
    if (row.event_type === "webhook_error") webhookErrors += 1;
  }
  return {
    provider_usage: byProvider,
    connection_failures: failures,
    webhook_errors: webhookErrors,
    shops_tracked: new Set(rows.map((r) => r.shop_id)).size
  };
}

export function providerHealthFromStatus(status = {}) {
  if (status.coming_soon) return "coming_soon";
  if (status.error) return "degraded";
  if (status.connected && status.charges_enabled !== false) return "healthy";
  if (status.connected) return "attention";
  return "disconnected";
}
