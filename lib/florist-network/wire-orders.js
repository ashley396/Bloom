/** Florist-to-florist wire order helpers (pure). */

export const WIRE_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "in_production",
  "out_for_delivery",
  "delivered",
  "declined",
  "cancelled"
];

export const WIRE_STATUS_LABELS = {
  draft: "Draft",
  sent: "Awaiting partner",
  accepted: "Accepted",
  in_production: "In production",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  declined: "Declined",
  cancelled: "Cancelled"
};

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
    sent: ["accepted", "declined", "cancelled"],
    accepted: ["in_production", "cancelled"],
    in_production: ["out_for_delivery", "cancelled"],
    out_for_delivery: ["delivered", "cancelled"],
    delivered: [],
    declined: [],
    cancelled: []
  };
  return (flow[from] || []).includes(to);
}

export function wireFeeSplit(amount, { percent = 20, flat = 0 } = {}) {
  const relay = Math.round((amount * (percent / 100) + flat) * 100) / 100;
  const shop = Math.round((amount - relay) * 100) / 100;
  return { relay, shop, total: amount };
}
