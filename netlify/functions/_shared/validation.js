/** Bloom production validation helpers (server-side). */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s().+\-]{7,20}$/;

export function clampText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

export function validateEmail(value, { required = false } = {}) {
  const text = String(value ?? "").trim();
  if (!text) return required ? { ok: false, error: "Email is required." } : { ok: true, value: "" };
  if (!EMAIL_RE.test(text)) return { ok: false, error: "Enter a valid email address." };
  if (text.length > 254) return { ok: false, error: "Email is too long." };
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
  const customer = validateRequiredText(body.customer_name, "Customer name", 120);
  if (!customer.ok) errors.push(customer.error);
  if (body.customer_email) {
    const email = validateEmail(body.customer_email);
    if (!email.ok) errors.push(email.error);
  }
  if (body.customer_phone) {
    const phone = validatePhone(body.customer_phone);
    if (!phone.ok) errors.push(phone.error);
  }
  const subtotal = validateMoney(body.subtotal, { fieldName: "Subtotal", max: 500_000 });
  if (!subtotal.ok) errors.push(subtotal.error);
  const fulfillment = String(body.fulfillment || "PICKUP").toUpperCase();
  if (fulfillment === "DELIVERY") {
    const address = validateRequiredText(body.delivery_address, "Delivery address", 500);
    if (!address.ok) errors.push(address.error);
  }
  if (body.notes && clampText(body.notes, 4000).length !== String(body.notes).trim().length) {
    errors.push("Notes are too long.");
  }
  return { valid: errors.length === 0, errors, sanitized: { customer_name: customer.value || clampText(body.customer_name, 120) } };
}

/** PATCH / orders — delivery address required when fulfillment is DELIVERY. */
export function validateOrderPatchBody(body = {}) {
  const errors = [];
  if ("customer_name" in body) {
    const customer = validateRequiredText(body.customer_name, "Customer name", 120);
    if (!customer.ok) errors.push(customer.error);
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
