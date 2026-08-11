/** Florist-to-florist wire order helpers (pure). */

/** Florisyn never takes a cut of Florist Network wire sales. */
export const FLORISYN_WIRE_PLATFORM_FEE_PERCENT = 0;
export const FLORISYN_WIRE_PLATFORM_FEE_FLAT = 0;

/** Default: sending florist keeps 20%, fulfilling florist receives 80%. */
export const DEFAULT_RELAY_FEE_PERCENT = 20;

export const WIRE_ZERO_PLATFORM_POLICY =
  "Florisyn charges $0 on Florist Network wires. By default the fulfilling florist receives 80% and the sending florist keeps 20% — both shops can agree on a different split per wire.";

export const WIRE_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "countered",
  "confirmed",
  "in_production",
  "out_for_delivery",
  "delivered",
  "completed",
  "cancelled",
  "expired",
];

export const WIRE_STATUS_LABELS = {
  draft: "Draft",
  sent: "Awaiting partner",
  viewed: "Viewed by partner",
  accepted: "Accepted",
  declined: "Declined",
  countered: "Counter offer",
  confirmed: "Confirmed",
  in_production: "In production",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
};

/** Sending shop relay % must leave 0–100 for fulfiller share. */
export function validateRelaySplitPercent(relayPercent) {
  const percent = Number(relayPercent ?? DEFAULT_RELAY_FEE_PERCENT);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return { ok: false, error: "Revenue split must be between 0% and 100% and total 100%." };
  }
  return { ok: true, relayPercent: percent, fulfillingPercent: 100 - percent };
}

export function generateWireNumber(prefix = "FN") {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

export function validateWirePayload(body = {}) {
  const recipient_name = String(body.recipient_name || "").trim();
  const delivery_address = String(body.delivery_address || "").trim();
  const delivery_date = String(body.delivery_date || "").trim();
  const product_description = String(body.product_description || body.description || "").trim();
  if (!recipient_name) return { ok: false, error: "Recipient name is required." };
  if (!delivery_address) return { ok: false, error: "Delivery address is required." };
  if (!delivery_date) return { ok: false, error: "Delivery date is required." };
  if (!product_description) return { ok: false, error: "Describe the arrangement to wire." };
  const wire_amount = Math.max(0, Number(body.wire_amount || body.amount || 0));
  if (wire_amount <= 0) return { ok: false, error: "Wire amount must be greater than zero." };
  return {
    ok: true,
    payload: {
      recipient_name,
      recipient_phone: String(body.recipient_phone || "").trim() || null,
      delivery_address,
      delivery_date,
      delivery_time_window: String(body.delivery_time_window || "").trim() || null,
      card_message: String(body.card_message || "").trim() || null,
      arrangement_notes: String(body.arrangement_notes || body.notes || "").trim() || null,
      product_description,
      wire_amount,
      customer_total: Math.max(0, Number(body.customer_total || 0)) || null
    }
  };
}

export function canTransitionWire(from, to) {
  const flow = {
    draft: ["sent", "cancelled"],
    sent: ["viewed", "accepted", "declined", "countered", "cancelled", "expired"],
    viewed: ["accepted", "declined", "countered", "cancelled", "expired"],
    countered: ["sent", "confirmed", "declined", "cancelled"],
    confirmed: ["in_production", "cancelled"],
    accepted: ["in_production", "confirmed", "cancelled"],
    in_production: ["out_for_delivery", "cancelled"],
    out_for_delivery: ["delivered", "cancelled"],
    delivered: ["completed"],
    completed: [],
    declined: [],
    cancelled: [],
    expired: [],
  };
  return (flow[from] || []).includes(to);
}

export function wireFeeSplit(amount, { percent = 0, flat = 0, platformPercent = FLORISYN_WIRE_PLATFORM_FEE_PERCENT, platformFlat = FLORISYN_WIRE_PLATFORM_FEE_FLAT } = {}) {
  const florisynFee = Math.round((Number(amount || 0) * (platformPercent / 100) + platformFlat) * 100) / 100;
  const afterPlatform = Math.max(0, Number(amount || 0) - florisynFee);
  const partnerRelay = Math.round((afterPlatform * (percent / 100) + flat) * 100) / 100;
  const fulfillingShop = Math.round((afterPlatform - partnerRelay) * 100) / 100;
  return {
    florisynFee,
    relay: partnerRelay,
    shop: fulfillingShop,
    fulfillingShop,
    total: Number(amount || 0),
  };
}

/** Settlement — Florisyn fee $0; relay percent goes to sending shop, remainder to fulfiller. */
export function computeWireSettlement(wireAmount, { relayPercent = DEFAULT_RELAY_FEE_PERCENT, relayFlat = 0 } = {}) {
  const percent = Math.min(100, Math.max(0, Number(relayPercent ?? DEFAULT_RELAY_FEE_PERCENT)));
  const flat = Math.max(0, Number(relayFlat || 0));
  const split = wireFeeSplit(wireAmount, { percent, flat });
  return {
    wire_amount: split.total,
    florisyn_platform_fee: split.florisynFee,
    partner_relay_fee: split.relay,
    fulfilling_shop_payout: split.fulfillingShop,
    relay_fee_percent: percent,
    relay_fee_flat: flat,
    policy: WIRE_ZERO_PLATFORM_POLICY,
  };
}
