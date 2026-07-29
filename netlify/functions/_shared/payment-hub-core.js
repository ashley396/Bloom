/** Payment Hub v1 — methods, checkout, wholesale, reports (pure logic). */

export const ALL_PAYMENT_METHODS = [
  { key: "credit_card", label: "Credit Card", group: "card", requires_processor: true },
  { key: "debit_card", label: "Debit Card", group: "card", requires_processor: true },
  { key: "apple_pay", label: "Apple Pay", group: "wallet", requires_processor: true, processor_feature: "apple_pay" },
  { key: "google_pay", label: "Google Pay", group: "wallet", requires_processor: true, processor_feature: "google_pay" },
  { key: "cash", label: "Cash", group: "manual" },
  { key: "check", label: "Check", group: "manual" },
  { key: "gift_card", label: "Gift Card", group: "stored_value" },
  { key: "store_credit", label: "Store Credit", group: "stored_value" },
  { key: "house_account", label: "House Account", group: "account" },
  { key: "purchase_order", label: "Purchase Order", group: "wholesale" },
  { key: "ach", label: "ACH", group: "bank", requires_processor: true },
  { key: "wire_transfer", label: "Wire Transfer", group: "bank" }
];

export const WHOLESALE_TERMS = ["due_on_receipt", "net_30", "net_60", "net_90", "purchase_order"];

const HUB_ROLES = ["owner", "manager", "cashier", "accountant"];

export function canManagePaymentHub(role) {
  return HUB_ROLES.includes(String(role || "").toLowerCase());
}

export function canConfigureProviders(role) {
  return ["owner", "manager"].includes(String(role || "").toLowerCase());
}

export function mergeMethodSettings(stored = {}) {
  const map = {};
  for (const m of ALL_PAYMENT_METHODS) {
    map[m.key] = stored[m.key] !== undefined ? Boolean(stored[m.key]) : defaultEnabled(m.key);
  }
  return map;
}

function defaultEnabled(key) {
  if (["credit_card", "debit_card", "cash", "check"].includes(key)) return true;
  if (key === "gift_card" || key === "store_credit") return true;
  return false;
}

export function canProcessRefunds(role) {
  return ["owner", "manager", "accountant"].includes(String(role || "").toLowerCase());
}

export function selectCheckoutMethods(methodSettings, { defaultProvider = null, processorConfigured = false, stripeConfigured = false } = {}) {
  const procReady = processorConfigured || stripeConfigured;
  return ALL_PAYMENT_METHODS.filter((m) => {
    if (!methodSettings[m.key]) return false;
    if (m.key === "ach") return procReady && defaultProvider === "authorize_net";
    if (m.requires_processor && m.group === "card") {
      return procReady && defaultProvider;
    }
    if (m.key === "apple_pay" || m.key === "google_pay") {
      return procReady && methodSettings[m.key] && defaultProvider;
    }
    return true;
  });
}

export function planSplitPayment(total, parts = []) {
  const t = Number(total || 0);
  const normalized = parts.map((p) => ({
    method: p.method,
    amount: Math.round(Number(p.amount || 0) * 100) / 100,
    tip: Math.round(Number(p.tip || 0) * 100) / 100
  }));
  const sum = normalized.reduce((s, p) => s + p.amount + p.tip, 0);
  return {
    valid: Math.abs(sum - t) < 0.02,
    total: t,
    parts: normalized,
    remaining: Math.round((t - sum) * 100) / 100
  };
}

export function planDepositPayment(total, depositAmount) {
  const t = Number(total || 0);
  const d = Math.min(t, Math.max(0, Number(depositAmount || 0)));
  return {
    deposit: Math.round(d * 100) / 100,
    balance_due: Math.round((t - d) * 100) / 100
  };
}

export function buildTransactionSummary(payments = [], { since = null } = {}) {
  const rows = payments.filter((p) => !since || new Date(p.received_at || p.created_at) >= new Date(since));
  let sales = 0;
  let refunds = 0;
  const byType = {};
  for (const p of rows) {
    const amt = Number(p.amount || 0);
    const method = String(p.method || p.payment_method || "Other");
    if (amt < 0) refunds += Math.abs(amt);
    else sales += amt;
    byType[method] = (byType[method] || 0) + amt;
  }
  return {
    daily_sales: Math.round(sales * 100) / 100,
    refunds: Math.round(refunds * 100) / 100,
    by_type: byType,
    count: rows.length
  };
}

export function buildGiftCardLiability(cards = []) {
  return cards.reduce((sum, c) => sum + Math.max(0, Number(c.balance || 0)), 0);
}

export function buildHouseAccountSummary(accounts = []) {
  return accounts.map((a) => ({
    id: a.id,
    customer_id: a.customer_id,
    name: a.name,
    outstanding: Number(a.balance || 0),
    credit_limit: Number(a.credit_limit || 0),
    available: Math.max(0, Number(a.credit_limit || 0) - Number(a.balance || 0))
  }));
}

export function validateGiftCardIssue({ amount, code }) {
  const errors = [];
  if (!code || String(code).trim().length < 6) errors.push("Gift card code must be at least 6 characters.");
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) errors.push("Amount must be greater than zero.");
  return { valid: errors.length === 0, errors };
}

export function validateGiftCardRedeem({ balance, amount }) {
  const b = Number(balance || 0);
  const a = Number(amount || 0);
  if (a <= 0) return { valid: false, error: "Redemption amount must be positive." };
  if (a > b) return { valid: false, error: "Insufficient gift card balance." };
  return { valid: true, applied: a, remaining: Math.round((b - a) * 100) / 100 };
}

export function validateHouseAccountCharge({ balance, credit_limit, amount }) {
  const next = Number(balance || 0) + Number(amount || 0);
  const limit = Number(credit_limit || 0);
  if (limit > 0 && next > limit) {
    return { valid: false, error: "Charge would exceed credit limit." };
  }
  return { valid: true, new_balance: Math.round(next * 100) / 100 };
}

export function routeCheckoutToProvider(defaultProvider, methodKey) {
  if (["credit_card", "debit_card", "apple_pay", "google_pay", "ach"].includes(methodKey)) {
    return defaultProvider || "stripe";
  }
  return "manual";
}
