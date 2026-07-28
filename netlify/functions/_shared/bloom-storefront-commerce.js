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

export function deliveryDateValid(dateStr, leadDays = 0, now = new Date()) {
  if (!dateStr) return { valid: false, error: "Choose a delivery or pickup date." };
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return { valid: false, error: "Invalid date." };
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const min = new Date(today);
  min.setDate(min.getDate() + Math.max(0, Number(leadDays || 0)));
  if (d < min) {
    return {
      valid: false,
      error: leadDays > 0 ? `Orders need at least ${leadDays} day(s) lead time.` : "Date cannot be in the past."
    };
  }
  return { valid: true, value: dateStr };
}

export function reconcileCartLines(cartLines = [], catalogProducts = []) {
  const errors = [];
  const byId = new Map(catalogProducts.map((p) => [String(p.id), p]));
  const lines = [];

  for (const raw of cartLines || []) {
    const id = String(raw.id || "");
    const qty = Math.max(1, Math.min(99, Number(raw.qty || 1)));
    const product = byId.get(id);
    if (!product) {
      errors.push(`Product ${id || raw.name || "unknown"} is no longer available.`);
      continue;
    }
    if (!productVisibleOnPublicSite(product)) {
      errors.push(`${product.name} is not available online.`);
      continue;
    }
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
      product_id: product.id
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

export function validateStorefrontCheckout(body = {}, settings = {}) {
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

  const dateCheck = deliveryDateValid(
    body.options?.delivery_date,
    settings.delivery_lead_days,
    body._now ? new Date(body._now) : new Date()
  );
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
  const totals = storefrontCartTotals(lines, options.tax_rate ?? shop.tax_rate, deliveryFee, options.discount ?? 0);
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

export function minOrderMet(subtotal, minAmount = 0) {
  const min = Number(minAmount || 0);
  if (min <= 0) return { ok: true };
  if (Number(subtotal || 0) < min) return { ok: false, error: `Minimum order is $${min.toFixed(2)}.` };
  return { ok: true };
}
