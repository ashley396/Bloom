/** Florist Network wire payment helpers — Florisyn platform fee always $0. */

import { FLORISYN_WIRE_PLATFORM_FEE_FLAT, FLORISYN_WIRE_PLATFORM_FEE_PERCENT, computeWireSplit } from "./wire-orders.js";

export const WIRE_PAYMENT_STATUSES = ["unpaid", "pending_payment", "paid", "refunded"];

/** Florisyn's application fee on a wire payment is always $0, regardless of amount or split. */
export function stripeApplicationFeeCents() {
  return 0;
}

/**
 * The sending shop only ever pays the fulfilling shop's share (their own
 * commission is kept from what they already collected from their
 * customer, never charged or transferred here) — so the $0.50 Stripe
 * minimum applies to that share, not the full wire amount.
 */
export function canInitiateWirePayment(wire, shopId) {
  if (!wire || !shopId) return { ok: false, error: "Wire order not found." };
  if (wire.sending_shop_id !== shopId) return { ok: false, error: "Only the sending shop can pay this wire." };
  if (wire.payment_status === "paid") return { ok: false, error: "This wire is already paid." };
  if (!["draft", "sent", "accepted", "in_production"].includes(String(wire.status || ""))) {
    return { ok: false, error: "This wire can no longer be paid online." };
  }
  const split = computeWireSplit(wire.wire_amount, wire.sending_shop_percent);
  if (split.fulfilling_shop_amount < 0.5) {
    return { ok: false, error: "The partner's share is below $0.50 — too small for card payment. Mark this wire paid offline instead." };
  }
  return { ok: true, amount: split.fulfilling_shop_amount, split };
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
