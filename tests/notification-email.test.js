import test from "node:test";
import assert from "node:assert/strict";
import {
  emailProviderConfigured,
  renderPaymentLinkEmail,
  renderPaymentReceiptEmail,
  renderPaymentFailedEmail,
  renderPaymentReminderEmail,
  renderSubscriptionReceiptEmail,
  dispatchEmail,
  sendPaymentLinkEmail,
} from "../netlify/functions/_shared/notification-email.js";

// notification-email.js had only 30.9% coverage. Real money-adjacent
// correctness lives here (amount formatting, provider fallback order,
// the actual HTTP call shape to whichever provider is configured) — all
// exercised here with a mocked global fetch, so no real network call is
// ever made regardless of what's actually deployed in this environment.

test("emailProviderConfigured: Resend wins when multiple providers are configured at once", () => {
  const cfg = emailProviderConfigured({
    RESEND_API_KEY: "re_123",
    BLOOM_EMAIL_PROVIDER: "sendgrid",
    SENDGRID_API_KEY: "sg_123",
  });
  assert.deepEqual(cfg, { configured: true, provider: "resend" });
});

test("emailProviderConfigured: SendGrid requires both the provider selector AND the key", () => {
  assert.equal(emailProviderConfigured({ SENDGRID_API_KEY: "sg_123" }).configured, false, "selector missing");
  assert.equal(emailProviderConfigured({ BLOOM_EMAIL_PROVIDER: "sendgrid" }).configured, false, "key missing");
  assert.deepEqual(
    emailProviderConfigured({ BLOOM_EMAIL_PROVIDER: "sendgrid", SENDGRID_API_KEY: "sg_123" }),
    { configured: true, provider: "sendgrid" }
  );
});

test("emailProviderConfigured: falls back to a generic webhook when no named provider is set", () => {
  assert.deepEqual(
    emailProviderConfigured({ BLOOM_EMAIL_WEBHOOK_URL: "https://hooks.example.com/email" }),
    { configured: true, provider: "webhook" }
  );
});

test("emailProviderConfigured: nothing configured at all reports honestly, never a false positive", () => {
  assert.deepEqual(emailProviderConfigured({}), { configured: false, provider: null });
});

test("renderPaymentLinkEmail: formats the amount to 2 decimals and includes the order number only when given", () => {
  const withOrder = renderPaymentLinkEmail({ shopName: "Bloom & Co", customerName: "Jane", orderNumber: "ORD-1", amountDue: 24.5, payUrl: "https://pay/1" });
  assert.match(withOrder.html, /\$24\.50/);
  assert.match(withOrder.html, /order <strong>ORD-1<\/strong>/);

  const withoutOrder = renderPaymentLinkEmail({ amountDue: 10, payUrl: "https://pay/2" });
  assert.doesNotMatch(withoutOrder.html, /for order/);
});

test("renderPaymentLinkEmail: falls back to 'there' and 'Your florist' when no customer/shop name is given", () => {
  const tpl = renderPaymentLinkEmail({ amountDue: 5, payUrl: "https://pay/3" });
  assert.match(tpl.html, /Hi there,/);
  assert.equal(tpl.subject, "Your florist — secure payment link");
});

test("renderPaymentLinkEmail: shows a real expiry date when given, 'soon' otherwise — never a raw Invalid Date", () => {
  const withExpiry = renderPaymentLinkEmail({ amountDue: 5, payUrl: "https://x", expiresAt: "2026-06-01T00:00:00Z" });
  assert.doesNotMatch(withExpiry.html, /Invalid Date/);
  assert.doesNotMatch(withExpiry.html, />soon</);

  const withoutExpiry = renderPaymentLinkEmail({ amountDue: 5, payUrl: "https://x" });
  assert.match(withoutExpiry.html, /expires soon/);
});

test("renderPaymentLinkEmail: contact info only appears when the shop actually provided it", () => {
  const withContact = renderPaymentLinkEmail({ amountDue: 5, payUrl: "https://x", shopPhone: "555-1234", shopEmail: "shop@example.com" });
  assert.match(withContact.html, /Call 555-1234/);
  assert.match(withContact.html, /shop@example\.com/);

  const withoutContact = renderPaymentLinkEmail({ amountDue: 5, payUrl: "https://x" });
  assert.doesNotMatch(withoutContact.html, /Call /);
});

test("renderPaymentReceiptEmail, renderPaymentFailedEmail, renderPaymentReminderEmail, renderSubscriptionReceiptEmail: each produces a distinct, correctly-titled template", () => {
  assert.match(renderPaymentReceiptEmail({ amount: 10 }).subject, /receipt$/);
  assert.match(renderPaymentReceiptEmail({ amount: 10 }).html, /Payment received/);

  assert.match(renderPaymentFailedEmail({ amountDue: 10, payUrl: "https://x" }).subject, /payment failed$/);
  assert.match(renderPaymentFailedEmail({ amountDue: 10, payUrl: "https://x" }).html, /could not be processed/);

  assert.match(renderPaymentReminderEmail({ amountDue: 10, payUrl: "https://x" }).subject, /payment reminder$/);
  assert.match(renderPaymentReminderEmail({ amountDue: 10, payUrl: "https://x" }).html, /Balance due: <strong>\$10\.00/);

  const sub = renderSubscriptionReceiptEmail({ amount: 30, schedule: "monthly" });
  assert.match(sub.subject, /subscription receipt$/);
  assert.match(sub.html, /monthly flower subscription/);
});

test("renderSubscriptionReceiptEmail: defaults to 'recurring' when no schedule is given", () => {
  const tpl = renderSubscriptionReceiptEmail({ amount: 30 });
  assert.match(tpl.html, /recurring flower subscription/);
});

test("dispatchEmail: no provider configured is a clean no-op — never attempts fetch", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", () => { throw new Error("must not be called"); });
  const result = await dispatchEmail({}, { to: "a@example.com", subject: "s", html: "<p>h</p>" });
  assert.deepEqual(result, { ok: false, code: "provider_not_configured", provider: null });
  assert.equal(fetchMock.mock.calls.length, 0);
});

test("dispatchEmail: an invalid recipient is rejected before ever attempting fetch, even with a real provider configured", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", () => { throw new Error("must not be called"); });
  const result = await dispatchEmail({ RESEND_API_KEY: "re_123" }, { to: "not-an-email", subject: "s", html: "<p>h</p>" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_recipient");
  assert.equal(fetchMock.mock.calls.length, 0);
});

test("dispatchEmail: a successful Resend call posts to the real Resend endpoint with a Bearer key and the actual recipient/content", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(opts.headers.Authorization, "Bearer re_123");
    const body = JSON.parse(opts.body);
    assert.deepEqual(body.to, ["a@example.com"]);
    assert.equal(body.subject, "Hello");
    return { ok: true };
  });
  const result = await dispatchEmail({ RESEND_API_KEY: "re_123" }, { to: "a@example.com", subject: "Hello", html: "<p>h</p>" });
  assert.deepEqual(result, { ok: true, provider: "resend" });
});

test("dispatchEmail: a failed Resend call surfaces the real HTTP status and a truncated response detail, never throws", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 422, text: async () => "x".repeat(500) }));
  const result = await dispatchEmail({ RESEND_API_KEY: "re_123" }, { to: "a@example.com", subject: "s", html: "<p>h</p>" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.equal(result.detail.length, 240, "detail must be capped, not an unbounded provider response");
});

test("dispatchEmail: a SendGrid call posts the correct personalizations/content shape", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    assert.equal(url, "https://api.sendgrid.com/v3/mail/send");
    const body = JSON.parse(opts.body);
    assert.equal(body.personalizations[0].to[0].email, "a@example.com");
    assert.ok(body.content.some((c) => c.type === "text/html"));
    return { ok: true };
  });
  const result = await dispatchEmail(
    { BLOOM_EMAIL_PROVIDER: "sendgrid", SENDGRID_API_KEY: "sg_123" },
    { to: "a@example.com", subject: "s", html: "<p>h</p>" }
  );
  assert.deepEqual(result, { ok: true, provider: "sendgrid" });
});

test("dispatchEmail: a Postmark call authenticates via the server-token header, not a Bearer token", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    assert.equal(url, "https://api.postmarkapp.com/email");
    assert.equal(opts.headers["X-Postmark-Server-Token"], "pm_123");
    return { ok: true };
  });
  const result = await dispatchEmail(
    { BLOOM_EMAIL_PROVIDER: "postmark", POSTMARK_SERVER_TOKEN: "pm_123" },
    { to: "a@example.com", subject: "s", html: "<p>h</p>" }
  );
  assert.deepEqual(result, { ok: true, provider: "postmark" });
});

test("dispatchEmail: a generic webhook posts a plain {to, subject, html, text} payload to the configured URL", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    assert.equal(url, "https://hooks.example.com/email");
    const body = JSON.parse(opts.body);
    assert.equal(body.to, "a@example.com");
    return { ok: true };
  });
  const result = await dispatchEmail(
    { BLOOM_EMAIL_WEBHOOK_URL: "https://hooks.example.com/email" },
    { to: "a@example.com", subject: "s", html: "<p>h</p>" }
  );
  assert.deepEqual(result, { ok: true, provider: "webhook" });
});

test("dispatchEmail: a failed non-Resend provider call reports the real status without a detail field (only Resend reads the response body)", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 500 }));
  const result = await dispatchEmail(
    { BLOOM_EMAIL_PROVIDER: "sendgrid", SENDGRID_API_KEY: "sg_123" },
    { to: "a@example.com", subject: "s", html: "<p>h</p>" }
  );
  assert.deepEqual(result, { ok: false, code: "provider_error", status: 500 });
});

test("sendPaymentLinkEmail: threads the rendered template's subject/html/text through to dispatch, end to end", async (t) => {
  let captured = null;
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    captured = JSON.parse(opts.body);
    return { ok: true };
  });
  const result = await sendPaymentLinkEmail(
    { to: "a@example.com", shopName: "Bloom & Co", amountDue: 12, payUrl: "https://pay/1" },
    { RESEND_API_KEY: "re_123" }
  );
  assert.equal(result.ok, true);
  assert.match(captured.subject, /secure payment link/);
  assert.match(captured.text, /Pay 12 at https:\/\/pay\/1/);
});
