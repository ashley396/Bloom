/** Customer profile visibility (RC1.1). */

export const CUSTOMER_SENSITIVE_FIELDS = [
  "tax_id",
  "house_account_limit",
  "internal_credit_notes",
  "saved_payment_methods"
];

export function canViewSensitiveCustomerData(role) {
  const allowed = ["owner", "manager", "accountant"];
  return allowed.includes(String(role || "").toLowerCase());
}

export function filterCustomerForRole(customer, role) {
  const base = { ...customer };
  if (!canViewSensitiveCustomerData(role)) {
    delete base.tax_id;
    delete base.house_account_limit;
    delete base.internal_credit_notes;
    if (base.house_account) base.house_account = { enabled: !!base.house_account?.enabled, terms: null };
    if (Array.isArray(base.saved_payment_methods)) {
      base.saved_payment_methods = base.saved_payment_methods.map((m) => ({
        brand: m.brand,
        last4: m.last4,
        exp: m.exp
      }));
    }
  }
  if (Array.isArray(base.saved_payment_methods)) {
    base.saved_payment_methods = base.saved_payment_methods.map((m) => ({
      brand: m.brand,
      last4: m.last4,
      exp: m.exp
    }));
  }
  return base;
}

export function customerLifetimeValue(orders = []) {
  return orders.reduce((s, o) => s + Number(o.total || 0), 0);
}

export function customerOpenBalance(orders = []) {
  return orders
    .filter((o) => (o.payment_status || "UNPAID") !== "PAID")
    .reduce((s, o) => s + Math.max(0, Number(o.balance_due ?? (Number(o.total || 0) - Number(o.amount_paid || 0)))), 0);
}

export function lilyCustomerSummaryAllowed(facts) {
  if (!facts || facts.manufactured) return { ok: false, error: "Cannot summarize manufactured data." };
  return { ok: true, requiresApproval: true };
}
