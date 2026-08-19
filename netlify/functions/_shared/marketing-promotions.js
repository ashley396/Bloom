/**
 * Validators for Marketing Promotions — a promotion DEFINITION and
 * activation-safety layer (name, type, value, dates, which real products
 * it covers), not a checkout-time coupon-code redemption engine. See the
 * migration header comment for why that split is deliberate.
 */

function trimStr(value, max) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

function parseDate(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return s;
}

function parseUuid(value) {
  const s = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    return null;
  }
  return s.toLowerCase();
}

export const PROMOTION_TYPES = Object.freeze(["percentage_off", "dollar_off", "free_delivery", "minimum_purchase"]);
export const PROMOTION_STATUSES = Object.freeze(["draft", "active", "ended"]);

export function validateMarketingPromotionBody(body = {}, { partial = false } = {}) {
  const name = trimStr(body.name, 120);
  const promo_type = trimStr(body.promo_type, 32).toLowerCase();
  const description = trimStr(body.description, 1000) || null;
  const value = body.value === undefined ? undefined : Number(body.value);

  if (!partial && !name) return { valid: false, error: "Promotion name is required." };
  if (body.name !== undefined && !name) return { valid: false, error: "Promotion name is required." };
  if (!partial && !PROMOTION_TYPES.includes(promo_type)) {
    return { valid: false, error: "Invalid promotion type." };
  }
  if (body.promo_type !== undefined && !PROMOTION_TYPES.includes(promo_type)) {
    return { valid: false, error: "Invalid promotion type." };
  }
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    return { valid: false, error: "Discount value must be a non-negative number." };
  }
  const effectiveType = promo_type || body.promo_type;
  if (effectiveType === "percentage_off" && value !== undefined && value > 100) {
    return { valid: false, error: "A percentage discount can't exceed 100." };
  }
  if (body.status !== undefined && !PROMOTION_STATUSES.includes(String(body.status).toLowerCase())) {
    return { valid: false, error: "Invalid promotion status." };
  }

  const starts_on = body.starts_on === undefined ? undefined : parseDate(body.starts_on);
  const ends_on = body.ends_on === undefined ? undefined : parseDate(body.ends_on);
  if (starts_on === undefined && body.starts_on !== undefined) return { valid: false, error: "Invalid start date." };
  if (ends_on === undefined && body.ends_on !== undefined) return { valid: false, error: "Invalid end date." };
  if (starts_on && ends_on && ends_on < starts_on) {
    return { valid: false, error: "End date must be on or after start date." };
  }

  let product_ids;
  if (body.product_ids !== undefined) {
    const list = Array.isArray(body.product_ids) ? body.product_ids : [];
    const parsed = list.map((id) => parseUuid(id)).filter(Boolean);
    if (parsed.length !== list.length) return { valid: false, error: "Invalid product id in product_ids." };
    product_ids = parsed.slice(0, 100);
  }

  let campaign_id;
  if (body.campaign_id !== undefined) {
    campaign_id = body.campaign_id ? parseUuid(body.campaign_id) : null;
    if (body.campaign_id && !campaign_id) return { valid: false, error: "Invalid campaign id." };
  }

  const sanitized = {};
  if (body.name !== undefined || !partial) sanitized.name = name;
  if (body.promo_type !== undefined || !partial) sanitized.promo_type = promo_type;
  if (body.value !== undefined || !partial) sanitized.value = value ?? 0;
  if (body.description !== undefined || !partial) sanitized.description = description;
  if (body.starts_on !== undefined) sanitized.starts_on = starts_on;
  if (body.ends_on !== undefined) sanitized.ends_on = ends_on;
  if (product_ids !== undefined) sanitized.product_ids = product_ids;
  if (campaign_id !== undefined) sanitized.campaign_id = campaign_id;

  return { valid: true, sanitized };
}
