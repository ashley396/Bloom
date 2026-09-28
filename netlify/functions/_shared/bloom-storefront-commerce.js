/** Bloom RC1.2 — public storefront commerce (pure, testable). */

import crypto from "node:crypto";
import { storefrontCartTotals } from "./bloom-storefront-core.js";
import { productVisibleOnPublicSite } from "./floral-library-core.js";
import { validateEmail, validatePhone, clampText } from "./validation.js";

export const COMMERCE_PAYMENT_MODES = ["pay_now", "pay_later"];

export const DEFAULT_COMMERCE_SETTINGS = {
  online_ordering_enabled: true,
  stripe_checkout_enabled: true,
  pay_later_enabled: true,
  deposit_percent: 0,
  min_order_amount: 0,
  delivery_lead_days: 0,
  auto_payment_link_on_pay_later: true,
  pickup_eligible: true,
  delivery_eligible: true
};

export function mergeCommerceSettings(projectSettings = {}, shop = {}) {
  const raw = { ...DEFAULT_COMMERCE_SETTINGS, ...(projectSettings || {}) };
  if (shop.default_delivery_fee != null && raw.default_delivery_fee == null) {
    raw.default_delivery_fee = Number(shop.default_delivery_fee || 0);
  }
  return raw;
}

// A-1c (2026-09-28): "today" for a storefront order is the SHOP's calendar
// day, in the shop's own configured IANA timezone (shops.timezone) — never
// the server's clock (UTC on Netlify) and never an assumed US zone. A missing
// or invalid zone falls back to UTC (`fallback: true` tells callers it did).
export function resolveShopTimeZone(timeZone) {
  const zone = String(timeZone || "").trim();
  if (!zone) return { timeZone: "UTC", fallback: true };
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return { timeZone: zone, fallback: false };
  } catch {
    return { timeZone: "UTC", fallback: true };
  }
}

/** The calendar date (YYYY-MM-DD) it currently is in `timeZone`. */
export function shopLocalDateString(now = new Date(), timeZone = "UTC") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveShopTimeZone(timeZone).timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const part = (type) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addCalendarDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Earliest pickup/delivery date the shop accepts: shop-local today + lead days. */
export function earliestFulfillmentDate({ leadDays = 0, now = new Date(), timeZone } = {}) {
  const lead = Number.isFinite(Number(leadDays)) ? Math.max(0, Math.floor(Number(leadDays))) : 0;
  return addCalendarDays(shopLocalDateString(now, timeZone), lead);
}

export function deliveryDateValid(dateStr, leadDays = 0, now = new Date(), timeZone = "UTC") {
  if (!dateStr || !String(dateStr).trim()) return { valid: false, error: "Choose a delivery or pickup date." };
  // A-1b (2026-09-28): only a real YYYY-MM-DD calendar date is accepted.
  // `new Date("2026-02-30T12:00:00")` silently rolls over to March 2, which
  // passed this check and then failed at the database's date column (500).
  const text = String(dateStr).trim();
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!parts) return { valid: false, error: "Enter the date as YYYY-MM-DD." };
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    return { valid: false, error: "Invalid date." };
  }
  dateStr = text;
  // Both sides are YYYY-MM-DD, so a string comparison is a calendar comparison.
  if (dateStr < earliestFulfillmentDate({ leadDays, now, timeZone })) {
    const lead = Number.isFinite(Number(leadDays)) ? Math.max(0, Math.floor(Number(leadDays))) : 0;
    return {
      valid: false,
      error: lead > 0 ? `Orders need at least ${lead} day(s) lead time.` : "Date cannot be in the past."
    };
  }
  return { valid: true, value: dateStr };
}

// A-1c: a public cart quantity is a whole number from 1 to the existing
// per-line maximum. Anything else is rejected — never silently turned into 1
// (the old clamp charged "abc" as 1 and 1.5 as 1.5).
export const STOREFRONT_MAX_LINE_QTY = 99;

export function parseCartQuantity(value) {
  let n = null;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && /^\d{1,3}$/.test(value.trim())) n = Number(value.trim());
  if (!Number.isInteger(n) || n < 1 || n > STOREFRONT_MAX_LINE_QTY) return null;
  return n;
}

export function reconcileCartLines(cartLines = [], catalogProducts = []) {
  const errors = [];
  const byId = new Map(catalogProducts.map((p) => [String(p.id), p]));
  const lines = [];
  const qtyByProduct = new Map();
  if (cartLines != null && !Array.isArray(cartLines)) return { valid: false, errors: ["Your cart could not be read."], lines, subtotal: 0 };

  for (const raw of cartLines || []) {
    const id = String(raw?.id || "");
    const product = byId.get(id);
    if (!product) {
      errors.push(`Product ${id || raw?.name || "unknown"} is no longer available.`);
      continue;
    }
    if (!productVisibleOnPublicSite(product)) {
      errors.push(`${product.name} is not available online.`);
      continue;
    }
    const qty = parseCartQuantity(raw.qty);
    // The maximum applies per product, so splitting it across duplicate lines cannot exceed it.
    const productQty = (qtyByProduct.get(id) || 0) + (qty || 0);
    if (qty === null || productQty > STOREFRONT_MAX_LINE_QTY) {
      errors.push(`Quantity for ${product.name} must be a whole number from 1 to ${STOREFRONT_MAX_LINE_QTY}.`);
      continue;
    }
    qtyByProduct.set(id, productQty);
    const price = Number(product.retail_price ?? product.price ?? 0);
    if (!Number.isFinite(price) || price < 0) {
      errors.push(`${product.name} has no valid price.`);
      continue;
    }
    lines.push({
      id: product.id,
      name: product.name,
      price,
      qty,
      product_id: product.id,
      // A-1c: taxability comes only from the catalog product (products.taxable,
      // NOT NULL DEFAULT true) — a browser-sent `taxable` is never read.
      taxable: product.taxable !== false
    });
  }

  if (!lines.length && !errors.length) errors.push("Your cart is empty.");
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  return { valid: errors.length === 0, errors, lines, subtotal };
}

export function resolveDeliveryFee(fulfillment, shop = {}, settings = {}) {
  if (fulfillment !== "DELIVERY") return 0;
  const fee = settings.default_delivery_fee ?? shop.default_delivery_fee ?? 0;
  return Math.max(0, Number(fee || 0));
}

export function computeDepositAmount(total, depositPercent = 0) {
  const pct = Math.max(0, Math.min(100, Number(depositPercent || 0)));
  if (pct <= 0) return Math.round(Number(total || 0) * 100) / 100;
  const deposit = (Number(total || 0) * pct) / 100;
  return Math.max(0.5, Math.round(deposit * 100) / 100);
}

export function validateStorefrontCheckout(body = {}, settings = {}, now = new Date(), { timeZone } = {}) {
  const errors = [];
  const name = clampText(body.customer?.name || body.customer_name, 120);
  if (!name) errors.push("Your name is required.");

  const phone = body.customer?.phone || body.customer_phone;
  if (phone) {
    const pv = validatePhone(phone, { required: false });
    if (!pv.ok) errors.push(pv.error);
  } else {
    errors.push("Phone number is required so your florist can reach you.");
  }

  const email = body.customer?.email || body.customer_email;
  if (email) {
    const ev = validateEmail(email);
    if (!ev.ok) errors.push(ev.error);
  }

  const fulfillment = body.options?.fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP";
  if (fulfillment === "DELIVERY") {
    if (!settings.delivery_eligible) errors.push("Delivery is not available for this shop.");
    if (!clampText(body.options?.delivery_address, 500)) errors.push("Delivery address is required.");
  } else if (!settings.pickup_eligible) {
    errors.push("Pickup is not available for this shop.");
  }

  // A-1b: "now" is never taken from the (untrusted, public) request body —
  // a body `_now` used to let any caller bypass the past-date and lead-days rules.
  const dateCheck = deliveryDateValid(body.options?.delivery_date, settings.delivery_lead_days, now, timeZone);
  if (!dateCheck.valid) errors.push(dateCheck.error);

  const mode = String(body.payment_mode || "pay_later").toLowerCase();
  if (!COMMERCE_PAYMENT_MODES.includes(mode)) errors.push("Choose a payment option.");
  if (mode === "pay_now" && !settings.stripe_checkout_enabled) errors.push("Pay now is not enabled for this shop.");
  if (mode === "pay_later" && !settings.pay_later_enabled) errors.push("Pay later is not enabled for this shop.");

  if (body.options?.card_message && clampText(body.options.card_message, 500).length !== String(body.options.card_message).trim().length) {
    errors.push("Card message is too long.");
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: {
      customer_name: name,
      fulfillment,
      delivery_date: dateCheck.value,
      payment_mode: mode
    }
  };
}

export function buildWebOrderTotals(lines, shop, options = {}, settings = {}) {
  const fulfillment = options.fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP";
  const deliveryFee = resolveDeliveryFee(fulfillment, shop, settings);
  // P1 #7 (2026-09-28): the tax rate is always the shop's own — never a
  // caller-supplied options.tax_rate (public checkout bodies are untrusted).
  // A web buyer never chooses a discount either: no storefront client sends one,
  // so any options.discount in the body is an attacker knob (it also bypassed
  // the minimum-order check). Promotions must be applied server-side.
  const totals = storefrontCartTotals(lines, shop.tax_rate, deliveryFee, 0);
  return { ...totals, fulfillment, deliveryFee };
}

export function commerceCheckoutAmount(total, balanceDue, paymentMode, depositPercent = 0) {
  const due = Math.max(0, Number(balanceDue ?? total ?? 0));
  if (paymentMode === "pay_later") return { charge: 0, balance_due: due, deposit_applied: 0 };
  const charge = computeDepositAmount(due, depositPercent);
  return { charge, balance_due: due, deposit_applied: 0 };
}

export function buildPublicStripeSessionParams({
  order,
  shop,
  chargeAmount,
  customerEmail,
  idempotencyKey,
  siteBase,
  shopSlug,
  stripeConnectAccountId
}) {
  const site = String(siteBase || "").replace(/\/$/, "");
  const cents = Math.round(Number(chargeAmount) * 100);
  const meta = {
    bloom_order_id: order.id,
    bloom_order_number: order.order_number,
    bloom_shop_id: String(order.shop_id || shop.id),
    bloom_idempotency_key: idempotencyKey,
    bloom_web_checkout: "true",
    bloom_actor_user_id: ""
  };
  const successPath = shopSlug ? `/store/${shopSlug}/?order_success=${encodeURIComponent(order.order_number)}` : "/";
  const cancelPath = shopSlug ? `/store/${shopSlug}/?checkout_cancelled=1` : "/";
  const params = {
    mode: "payment",
    customer_email: customerEmail || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: cents,
          product_data: { name: `${order.order_number} — ${shop.name || "Florist order"}` }
        }
      }
    ],
    metadata: meta,
    payment_intent_data: { metadata: { ...meta } },
    success_url: `${site}${successPath}`,
    cancel_url: `${site}${cancelPath}`
  };
  if (stripeConnectAccountId) {
    params.payment_intent_data = {
      ...params.payment_intent_data,
      transfer_data: { destination: stripeConnectAccountId }
    };
  }
  return params;
}

export function newWebCheckoutIdempotencyKey() {
  return crypto.randomUUID();
}

export function storefrontCommerceHandoff({ order, paymentMode, checkoutUrl, paymentLinkUrl, settings }) {
  const balance = Math.max(0, Number(order.balance_due ?? (Number(order.total || 0) - Number(order.amount_paid || 0))));
  return {
    order_id: order.id,
    order_number: order.order_number,
    payment_mode: paymentMode,
    balance_due: balance,
    checkout_url: checkoutUrl || null,
    payment_link_url: paymentLinkUrl || null,
    message:
      paymentMode === "pay_now" && checkoutUrl
        ? "Redirecting to secure payment…"
        : settings?.auto_payment_link_on_pay_later && paymentLinkUrl
          ? "Order received — use the secure link to pay when ready."
          : "Order received — your florist will confirm and follow up for payment.",
    create_checkout_requires_staff: true
  };
}

// A-1c: WEB order numbers are globally unique (orders.order_number UNIQUE).
// The old `WEB-<last 8 digits of Date.now()>` collided for two orders in the
// same millisecond and wrapped every ~27.8 h. Now: shop-local date + 6
// characters from a 32-symbol alphabet with no 0/O/1/I (~1.07e9 codes per
// day), and the insert retries on a unique violation.
const ORDER_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateWebOrderNumber({ now = new Date(), timeZone, randomInt = crypto.randomInt } = {}) {
  const day = shopLocalDateString(now, timeZone).slice(2).replace(/-/g, "");
  let code = "";
  for (let i = 0; i < 6; i += 1) code += ORDER_CODE_ALPHABET[randomInt(ORDER_CODE_ALPHABET.length)];
  return `WEB-${day}-${code}`;
}

export function isOrderNumberConflict(error) {
  return error?.code === "23505" && /order_number/i.test(`${error.message || ""} ${error.details || ""} ${error.constraint || ""}`);
}

// A-1c: the ONE place both the public GET and checkout decide which payment
// options exist. `cardReady` must come from a live, server-side Stripe check
// that the shop's connected account can accept charges — never from the
// mere existence of a Connect account id.
export function resolveStorefrontPaymentModes(settings = {}, { cardReady = false } = {}) {
  return [
    ...(settings.stripe_checkout_enabled && cardReady ? ["pay_now"] : []),
    ...(settings.pay_later_enabled ? ["pay_later"] : [])
  ];
}

export const ONLINE_ORDERING_UNAVAILABLE_MESSAGE =
  "Online ordering is currently unavailable for this shop. Please call or visit the florist to place your order.";

export function minOrderMet(subtotal, minAmount = 0) {
  const min = Number(minAmount || 0);
  if (min <= 0) return { ok: true };
  if (Number(subtotal || 0) < min) return { ok: false, error: `Minimum order is $${min.toFixed(2)}.` };
  return { ok: true };
}
