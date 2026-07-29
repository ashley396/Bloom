/** Bloom SMS notification adapter. */

import { validatePhone } from "./validation.js";

export function smsProviderConfigured(env = process.env) {
  if (env.BLOOM_SMS_PROVIDER === "twilio" && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER) {
    return { configured: true, provider: "twilio" };
  }
  if (env.BLOOM_SMS_WEBHOOK_URL) return { configured: true, provider: "webhook" };
  return { configured: false, provider: null };
}

export function normalizePhoneE164(phone, defaultCountry = "1") {
  const v = validatePhone(phone, { required: true });
  if (!v.ok) return v;
  const digits = v.value.replace(/\D/g, "");
  if (digits.length === 10) return { ok: true, value: `+${defaultCountry}${digits}` };
  if (digits.length === 11 && digits.startsWith("1")) return { ok: true, value: `+${digits}` };
  if (v.value.startsWith("+")) return { ok: true, value: v.value };
  return { ok: true, value: `+${digits}` };
}

export function assertSmsConsent(customer = {}) {
  if (customer.sms_consent === false) return { allowed: false, reason: "no_consent" };
  return { allowed: true };
}

async function dispatchSms(env, { to, body }) {
  const cfg = smsProviderConfigured(env);
  if (!cfg.configured) return { ok: false, code: "provider_not_configured", sent: false };

  const phone = normalizePhoneE164(to);
  if (!phone.ok) return { ok: false, code: "invalid_phone", error: phone.error, sent: false };

  if (cfg.provider === "twilio") {
    const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const params = new URLSearchParams({ To: phone.value, From: env.TWILIO_FROM_NUMBER, Body: body });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });
    if (!res.ok) return { ok: false, code: "provider_error", sent: false, status: res.status };
    return { ok: true, sent: true, provider: "twilio" };
  }

  if (cfg.provider === "webhook") {
    const res = await fetch(env.BLOOM_SMS_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: phone.value, body })
    });
    if (!res.ok) return { ok: false, code: "provider_error", sent: false };
    return { ok: true, sent: true, provider: "webhook" };
  }

  return { ok: false, code: "provider_not_configured", sent: false };
}

export async function sendPaymentLinkSms({ to, shopName, amountDue, payUrl }, env = process.env) {
  const body = `${shopName || "Your florist"}: Pay $${Number(amountDue).toFixed(2)} securely: ${payUrl}`;
  return dispatchSms(env, { to, body });
}

export async function sendPaymentReminderSms({ to, shopName, amountDue, payUrl }, env = process.env) {
  const body = `${shopName || "Florist"} reminder: $${Number(amountDue).toFixed(2)} due. ${payUrl}`;
  return dispatchSms(env, { to, body });
}

export async function sendPaymentFailedSms({ to, shopName, payUrl }, env = process.env) {
  const body = `${shopName || "Florist"}: Payment failed. Retry: ${payUrl}`;
  return dispatchSms(env, { to, body });
}

export async function sendReceiptConfirmationSms({ to, shopName, amount }, env = process.env) {
  const body = `${shopName || "Florist"}: Payment $${Number(amount).toFixed(2)} received. Thank you!`;
  return dispatchSms(env, { to, body });
}
