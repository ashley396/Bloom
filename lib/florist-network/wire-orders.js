/** Florist-to-florist wire order helpers (pure). */

/** Florisyn never takes a cut of Florist Network wire sales — florists keep 100%. */
export const FLORISYN_WIRE_PLATFORM_FEE_PERCENT = 0;
export const FLORISYN_WIRE_PLATFORM_FEE_FLAT = 0;

export const WIRE_ZERO_PLATFORM_POLICY =
  "Florisyn charges $0 on Florist Network wires. The fulfilling florist receives 100% of the wire amount.";

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

/** Settlement for a wire order — Florisyn fee is always $0; fulfilling shop receives 100%. */
export function computeWireSettlement(wireAmount) {
  const amount = Math.max(0, Number(wireAmount || 0));
  return {
    wire_amount: amount,
    florisyn_platform_fee: 0,
    partner_relay_fee: 0,
    fulfilling_shop_payout: amount,
    policy: WIRE_ZERO_PLATFORM_POLICY,
  };
}

/**
 * Trust signal for the partner directory — the one thing legacy wire
 * networks (Teleflora, FTD, BloomNet) provide that a plain directory
 * doesn't: a "will this shop actually deliver what I'm sending them" score.
 */
export function validateWireRatingPayload(body = {}) {
  const wire_id = String(body.wire_id || "").trim();
  const rating = Number(body.rating);
  const comment = String(body.comment || "").trim().slice(0, 500) || null;
  const errors = [];
  if (!wire_id) errors.push("wire_id is required.");
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.push("rating must be a whole number from 1 to 5.");
  if (errors.length) return { errors };
  return { errors: [], wire_id, rating, comment };
}

/** Only a delivered wire can be rated — reflects an actual completed relationship. */
export function canRateWire(wire) {
  return String(wire?.status || "").toLowerCase() === "delivered";
}

/** Given a shop's rating rows, compute the average + count shown on its directory listing. */
export function aggregateShopRatings(rows = []) {
  if (!rows.length) return { average: null, count: 0 };
  const sum = rows.reduce((acc, r) => acc + Number(r.rating || 0), 0);
  return { average: Math.round((sum / rows.length) * 10) / 10, count: rows.length };
}

/** Builds a shop_id → {average, count} map from a flat list of rating rows. */
export function aggregateRatingsByShop(rows = []) {
  const byShop = new Map();
  for (const row of rows) {
    const key = row.ratee_shop_id;
    if (!byShop.has(key)) byShop.set(key, []);
    byShop.get(key).push(row);
  }
  const result = new Map();
  for (const [shopId, shopRows] of byShop) result.set(shopId, aggregateShopRatings(shopRows));
  return result;
}
