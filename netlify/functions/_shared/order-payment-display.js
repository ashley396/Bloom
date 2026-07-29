/** Shared payment display math for orders (server tests + UI parity). */

export function computeOrderBalance(order) {
  const total = Math.max(0, Number(order?.total || 0));
  const paid = Math.max(0, Number(order?.amount_paid || 0));
  const fromField = order?.balance_due;
  if (fromField !== undefined && fromField !== null && Number.isFinite(Number(fromField))) {
    return Math.max(0, Number(fromField));
  }
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

export function normalizePaymentStatus(raw) {
  const s = String(raw || "UNPAID").trim().toUpperCase();
  if (s === "OPEN") return "UNPAID";
  if (["PAID", "PARTIAL", "UNPAID", "REFUNDED"].includes(s)) return s;
  return "UNPAID";
}

export function paymentStatusBadgeClass(status) {
  const s = normalizePaymentStatus(status);
  if (s === "PAID") return "good";
  if (s === "REFUNDED") return "warn";
  if (s === "PARTIAL") return "warn";
  return "warn";
}

export function paymentStatusLabel(status) {
  const s = normalizePaymentStatus(status);
  if (s === "UNPAID") return "UNPAID";
  return s;
}

export function syncOrderPaymentFields(order) {
  const total = Math.max(0, Number(order?.total || 0));
  const paid = Math.max(0, Number(order?.amount_paid || 0));
  const balance = computeOrderBalance(order);
  let status = normalizePaymentStatus(order?.payment_status);
  if (status === "REFUNDED") {
    return { total, paid, balance, status };
  }
  if (balance <= 0 && total > 0 && paid >= total - 0.005) status = "PAID";
  else if (paid > 0 && balance > 0.005) status = "PARTIAL";
  else if (paid <= 0 && status !== "REFUNDED") status = "UNPAID";
  return { total, paid, balance, status };
}

/** Attributes used to open Payment Center from an order card (regression anchor). */
export const PAYMENT_CENTER_FROM_ORDER_ATTR = "data-manage-payment";
