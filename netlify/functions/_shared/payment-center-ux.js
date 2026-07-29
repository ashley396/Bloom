/** Payment Center UX helpers (testable; no DOM). */

export function defaultCashPaymentAmount(balanceDue) {
  const balance = Math.max(0, Number(balanceDue) || 0);
  return Math.round(balance * 100) / 100;
}

/** Change to return when customer pays with cash (non-negative). */
export function computeCashChange(cashReceived, paymentAmount) {
  const received = Math.max(0, Number(cashReceived) || 0);
  const pay = Math.max(0, Number(paymentAmount) || 0);
  return Math.max(0, Math.round((received - pay) * 100) / 100);
}

export const PAYMENT_CENTER_PRIMARY_METHODS = ["Cash", "Card", "Check", "Split", "PayLater"];

export const PAYMENT_CENTER_MORE_METHODS = ["Gift Card", "Store Credit", "Other"];

/** Which payment-center panel is active (regression anchors for tests). */
export const PAYMENT_CENTER_PANEL_IDS = {
  summary: "paymentTopSummary",
  methods: "paymentMethodPicker",
  cash: "paymentFlowCash",
  card: "paymentFlowCard",
  split: "paymentFlowSplit",
  history: "paymentHistorySection",
  success: "paymentSuccessPanel"
};
