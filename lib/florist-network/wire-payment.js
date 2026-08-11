/** Florist Network wire payment helpers — Florisyn platform fee always $0. */

import {
  FLORISYN_WIRE_PLATFORM_FEE_FLAT,
  FLORISYN_WIRE_PLATFORM_FEE_PERCENT,
  computeWireSettlement,
} from "./wire-orders.js";

export const WIRE_PAYMENT_STATUSES = ["unpaid", "pending_payment", "paid", "refunded"];

export function stripeApplicationFeeCents(amountDollars) {
  const settlement = computeWireSettlement(amountDollars);
  return Math.round(settlement.florisyn_platform_fee * 100);
}

export function canInitiateWirePayment(wire, shopId) {
  if (!wire || !shopId) return { ok: false, error: "Wire order not found." };
  if (wire.sending_shop_id !== shopId) return { ok: false, error: "Only the sending shop can pay this wire." };
  if (wire.payment_status === "paid") return { ok: false, error: "This wire is already paid." };
  if (!["draft", "sent", "accepted", "in_production"].includes(String(wire.status || ""))) {
    return { ok: false, error: "This wire can no longer be paid online." };
  }
  const amount = Math.max(0, Number(wire.wire_amount || 0));
  if (amount < 0.5) return { ok: false, error: "Wire amount must be at least $0.50 for card payment." };
  return { ok: true, amount };
}

export function partnerCanReceiveWirePayments(shopRow) {
  return Boolean(String(shopRow?.stripe_connect_account_id || "").trim());
}

export function wirePaymentLabel(status) {
  const map = {
    unpaid: "Unpaid",
    pending_payment: "Payment processing",
    paid: "Paid to partner",
    refunded: "Refunded",
  };
  return map[String(status || "unpaid")] || "Unpaid";
}

export function buildWireCheckoutMetadata(wire, { sendingShopId, fulfillingShopId }) {
  return {
    florist_network: "wire",
    florist_wire_id: String(wire.id),
    wire_number: String(wire.wire_number || ""),
    sending_shop_id: String(sendingShopId),
    fulfilling_shop_id: String(fulfillingShopId),
    florisyn_platform_fee_percent: String(FLORISYN_WIRE_PLATFORM_FEE_PERCENT),
    florisyn_platform_fee_flat: String(FLORISYN_WIRE_PLATFORM_FEE_FLAT),
  };
}
