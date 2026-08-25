import test from "node:test";
import assert from "node:assert/strict";
import {
  smsProviderConfigured,
  normalizePhoneE164,
  assertSmsConsent,
  sendPaymentLinkSms,
  sendPaymentReminderSms,
  sendPaymentFailedSms,
  sendReceiptConfirmationSms,
} from "../netlify/functions/_shared/notification-sms.js";

// notification-sms.js had only 41% coverage. All tests mock global fetch
// so no real Twilio/webhook call ever fires regardless of what's actually
// deployed in this environment.

test("smsProviderConfigured: Twilio requires ALL of provider selector + SID + auth token + from number — a partial config is not configured", () => {
  assert.equal(smsProviderConfigured({ BLOOM_SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1" }).configured, false);
  assert.deepEqual(
    smsProviderConfigured({
      BLOOM_SMS_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC1",
      TWILIO_AUTH_TOKEN: "tok",
      TWILIO_FROM_NUMBER: "+15551234567",
    }),
    { configured: true, provider: "twilio" }
  );
});

test("smsProviderConfigured: falls back to a generic webhook when Twilio isn't fully configured", () => {
  assert.deepEqual(
    smsProviderConfigured({ BLOOM_SMS_WEBHOOK_URL: "https://hooks.example.com/sms" }),
    { configured: true, provider: "webhook" }
  );
});

test("smsProviderConfigured: nothing configured reports honestly", () => {
  assert.deepEqual(smsProviderConfigured({}), { configured: false, provider: null });
});

test("normalizePhoneE164: a bare 10-digit US number gets the default country code prefixed", () => {
  assert.deepEqual(normalizePhoneE164("5551234567"), { ok: true, value: "+15551234567" });
});

test("normalizePhoneE164: an 11-digit number already starting with 1 is prefixed with just a +", () => {
  assert.deepEqual(normalizePhoneE164("15551234567"), { ok: true, value: "+15551234567" });
});

test("normalizePhoneE164: an already-E.164 formatted number passes through unchanged", () => {
  assert.deepEqual(normalizePhoneE164("+15551234567"), { ok: true, value: "+15551234567" });
});

test("normalizePhoneE164: an invalid phone (too short) returns the underlying validation failure, not a garbage number", () => {
  const result = normalizePhoneE164("123");
  assert.equal(result.ok, false);
});

test("normalizePhoneE164: honors a non-default country code for a bare 10-digit number", () => {
  assert.deepEqual(normalizePhoneE164("5551234567", "44"), { ok: true, value: "+445551234567" });
});

test("assertSmsConsent: no explicit sms_consent field defaults to allowed (opt-out model, not opt-in)", () => {
  assert.deepEqual(assertSmsConsent({}), { allowed: true });
  assert.deepEqual(assertSmsConsent(), { allowed: true });
});

test("assertSmsConsent: an explicit false blocks with a clear reason", () => {
  assert.deepEqual(assertSmsConsent({ sms_consent: false }), { allowed: false, reason: "no_consent" });
});

test("sendPaymentLinkSms: no provider configured is a clean no-op, never attempts fetch", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", () => { throw new Error("must not be called"); });
  const result = await sendPaymentLinkSms({ to: "5551234567", amountDue: 10, payUrl: "https://x" }, {});
  assert.deepEqual(result, { ok: false, code: "provider_not_configured", sent: false });
  assert.equal(fetchMock.mock.calls.length, 0);
});

test("sendPaymentLinkSms: an invalid phone is rejected before ever attempting fetch, even with a real provider configured", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", () => { throw new Error("must not be called"); });
  const env = { BLOOM_SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM_NUMBER: "+15550000000" };
  const result = await sendPaymentLinkSms({ to: "123", amountDue: 10, payUrl: "https://x" }, env);
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_phone");
  assert.equal(fetchMock.mock.calls.length, 0);
});

test("sendPaymentLinkSms: a successful Twilio call authenticates with Basic auth and posts the real recipient/message body", async (t) => {
  const env = { BLOOM_SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM_NUMBER: "+15550000000" };
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    assert.equal(url, "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    assert.match(opts.headers.Authorization, /^Basic /);
    const params = new URLSearchParams(opts.body);
    assert.equal(params.get("To"), "+15551234567");
    assert.equal(params.get("From"), "+15550000000");
    assert.match(params.get("Body"), /\$10\.00/);
    return { ok: true };
  });
  const result = await sendPaymentLinkSms({ to: "5551234567", shopName: "Bloom & Co", amountDue: 10, payUrl: "https://x" }, env);
  assert.deepEqual(result, { ok: true, sent: true, provider: "twilio" });
});

test("sendPaymentReminderSms: a failed Twilio call surfaces the real status without throwing", async (t) => {
  const env = { BLOOM_SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM_NUMBER: "+15550000000" };
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 400 }));
  const result = await sendPaymentReminderSms({ to: "5551234567", amountDue: 5, payUrl: "https://x" }, env);
  assert.deepEqual(result, { ok: false, code: "provider_error", sent: false, status: 400 });
});

test("sendPaymentFailedSms: a webhook provider posts a plain {to, body} JSON payload", async (t) => {
  const env = { BLOOM_SMS_WEBHOOK_URL: "https://hooks.example.com/sms" };
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    assert.equal(url, "https://hooks.example.com/sms");
    const body = JSON.parse(opts.body);
    assert.equal(body.to, "+15551234567");
    assert.match(body.body, /Payment failed/);
    return { ok: true };
  });
  const result = await sendPaymentFailedSms({ to: "5551234567", shopName: "Bloom & Co", payUrl: "https://x" }, env);
  assert.deepEqual(result, { ok: true, sent: true, provider: "webhook" });
});

test("sendReceiptConfirmationSms: formats the confirmed amount into the message body", async (t) => {
  const env = { BLOOM_SMS_WEBHOOK_URL: "https://hooks.example.com/sms" };
  let captured = null;
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    captured = JSON.parse(opts.body);
    return { ok: true };
  });
  await sendReceiptConfirmationSms({ to: "5551234567", shopName: "Bloom & Co", amount: 42 }, env);
  assert.match(captured.body, /\$42\.00 received/);
});

test("sendReceiptConfirmationSms: a webhook failure is reported without a status field (only real HTTP-status providers set it)", async (t) => {
  const env = { BLOOM_SMS_WEBHOOK_URL: "https://hooks.example.com/sms" };
  t.mock.method(globalThis, "fetch", async () => ({ ok: false }));
  const result = await sendReceiptConfirmationSms({ to: "5551234567", amount: 5 }, env);
  assert.deepEqual(result, { ok: false, code: "provider_error", sent: false });
});
