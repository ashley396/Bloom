/** Bloom production validation helpers (server-side). */

export const WALK_IN_CUSTOMER_NAME = "Walk-in Customer";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s().+\-]{7,20}$/;

export function clampText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

export function resolveCustomerName(value) {
  const text = clampText(value, 120);
  return text || WALK_IN_CUSTOMER_NAME;
}

export function orderHasLineItem(body = {}) {
  const desc = clampText(body.arrangement_description, 4000);
  const productId = clampText(body.product_id, 64);
  const subtotal = Number(body.subtotal || 0);
  return Boolean(desc) || Boolean(productId) || (Number.isFinite(subtotal) && subtotal > 0);
}

export function validateEmail(value, { required = false } = {}) {
  const text = String(value ?? "").trim();
  if (!text) return required ? { ok: false, error: "Email is required.", code: "invalid_email" } : { ok: true, value: "" };
  if (text.length > 254) return { ok: false, error: "Email is too long.", code: "invalid_email" };
  const at = text.lastIndexOf("@");
  const domain = at > 0 ? text.slice(at + 1) : "";
  if (/^(localhost|test\.local|invalid)$/i.test(domain)) {
    return { ok: false, error: "Enter a valid business email address with a real domain.", code: "invalid_email_domain" };
  }
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return { ok: false, error: "Enter a valid business email address with a real domain.", code: "invalid_email_domain" };
  }
  if (!EMAIL_RE.test(text)) return { ok: false, error: "Enter a valid email address.", code: "invalid_email" };
  return { ok: true, value: text.toLowerCase() };
}

export function validatePhone(value, { required = false } = {}) {
  const text = String(value ?? "").trim();
  if (!text) return required ? { ok: false, error: "Phone is required." } : { ok: true, value: "" };
  const digits = text.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return { ok: false, error: "Enter a valid phone number." };
  if (!PHONE_RE.test(text)) return { ok: false, error: "Phone contains invalid characters." };
  return { ok: true, value: text };
}

export function validateRequiredText(value, fieldName, max = 200) {
  const text = clampText(value, max);
  if (!text) return { ok: false, error: `${fieldName} is required.` };
  return { ok: true, value: text };
}

export function validateMoney(value, { min = 0, max = 1_000_000, fieldName = "Amount" } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false, error: `${fieldName} must be a number.` };
  if (n < min || n > max) return { ok: false, error: `${fieldName} must be between ${min} and ${max}.` };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export function validateOrderCreateBody(body = {}) {
  const errors = [];
  const customer_name = resolveCustomerName(body.customer_name);
  if (body.customer_email) {
    const email = validateEmail(body.customer_email);
    if (!email.ok) errors.push(email.error);
  }
  if (body.customer_phone) {
    const phone = validatePhone(body.customer_phone);
    if (!phone.ok) errors.push(phone.error);
  }
  if (!orderHasLineItem(body)) {
    errors.push(
      "Add at least one item — select a catalog product, describe the arrangement, or enter a product amount."
    );
  }
  const subtotal = validateMoney(body.subtotal ?? 0, { fieldName: "Subtotal", max: 500_000, min: 0 });
  if (!subtotal.ok) errors.push(subtotal.error);
  const fulfillment = String(body.fulfillment || "PICKUP").toUpperCase();
  if (!["PICKUP", "DELIVERY"].includes(fulfillment)) {
    errors.push("Choose pickup or delivery.");
  }
  const deliveryDate = clampText(body.delivery_date, 32);
  if (!deliveryDate) {
    errors.push("Choose a due, pickup, or delivery date.");
  }
  if (fulfillment === "DELIVERY") {
    const address = validateRequiredText(body.delivery_address, "Delivery address", 500);
    if (!address.ok) errors.push(address.error);
  }
  const paymentRequired = String(body.payment_required ?? "YES").toUpperCase();
  if (!["YES", "NO"].includes(paymentRequired)) {
    errors.push("Choose whether to take payment now or skip payment for later.");
  }
  if (body.notes && clampText(body.notes, 4000).length !== String(body.notes).trim().length) {
    errors.push("Notes are too long.");
  }
  return {
    valid: errors.length === 0,
    errors,
    sanitized: { customer_name, fulfillment, payment_required: paymentRequired }
  };
}

/** PATCH / orders — delivery address required when fulfillment is DELIVERY. */
export function validateOrderPatchBody(body = {}) {
  const errors = [];
  if ("customer_name" in body) {
    const name = resolveCustomerName(body.customer_name);
    if (!name) errors.push("Customer name is required.");
  }
  if ("delivery_date" in body && !clampText(body.delivery_date, 32)) {
    errors.push("Choose a due, pickup, or delivery date.");
  }
  if (String(body.fulfillment || "").toUpperCase() === "DELIVERY") {
    const address = validateRequiredText(body.delivery_address, "Delivery address", 500);
    if (!address.ok) errors.push(address.error);
  }
  return { valid: errors.length === 0, errors };
}

export function validateInventoryItemBody(body = {}) {
  const errors = [];
  const name = validateRequiredText(body.name, "Item name", 160);
  if (!name.ok) errors.push(name.error);
  const qty = validateMoney(body.quantity, { min: 0, max: 1_000_000, fieldName: "Quantity" });
  if (!qty.ok) errors.push(qty.error);
  return { valid: errors.length === 0, errors };
}

export function validateCustomerBody(body = {}) {
  const errors = [];
  const name = validateRequiredText(body.name, "Customer name", 120);
  if (!name.ok) errors.push(name.error);
  if (body.email) {
    const email = validateEmail(body.email);
    if (!email.ok) errors.push(email.error);
  }
  if (body.phone) {
    const phone = validatePhone(body.phone);
    if (!phone.ok) errors.push(phone.error);
  }
  return { valid: errors.length === 0, errors };
}

export function sanitizeClientErrorPayload(body = {}) {
  const blocked = /password|token|secret|authorization|cookie|ssn|tax_id|stripe/i;
  const out = {};
  for (const [key, value] of Object.entries(body).slice(0, 30)) {
    if (blocked.test(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, 500);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}

// Marketing-site analytics (Section 22 of the SEO/GEO brief): a fixed,
// known shape rather than a generic blocklist — nothing outside this
// allowlist ever reaches audit_events.metadata, no matter what a caller
// sends. Never accepts an IP, email, name, or anything identifying —
// this is deliberately anonymous, no-invasive-tracking analytics.
const SITE_ANALYTICS_EVENT_TYPES = new Set([
  "site_pageview",
  "site_cta_click",
  "site_signup_conversion",
]);

function truncateStr(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Pulls just the registrable host out of a referrer URL, e.g.
 * "https://www.google.com/search?q=..." -> "google.com". Never stores
 * the full referrer URL (which can carry a search query or another
 * site's path) — only which site sent the visitor. */
export function referrerHost(referrer) {
  if (!referrer || typeof referrer !== "string") return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    return host ? host.slice(0, 100) : null;
  } catch {
    return null;
  }
}

export function sanitizeSiteAnalyticsPayload(body = {}) {
  if (!body || typeof body !== "object") return null;
  const eventType = SITE_ANALYTICS_EVENT_TYPES.has(body.event_type) ? body.event_type : null;
  if (!eventType) return null;
  const path = truncateStr(body.path, 200);
  if (!path || !path.startsWith("/")) return null;
  return {
    eventType,
    metadata: {
      path,
      referrer_host: referrerHost(body.referrer),
      landing_path: truncateStr(body.landing_path, 200),
      landing_referrer_host: referrerHost(body.landing_referrer),
      utm_source: truncateStr(body.utm_source, 100),
      utm_medium: truncateStr(body.utm_medium, 100),
      utm_campaign: truncateStr(body.utm_campaign, 100),
      cta_id: truncateStr(body.cta_id, 100),
      session_id: truncateStr(body.session_id, 40),
    },
  };
}
