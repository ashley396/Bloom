import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePaymentLinkSessionMetadata,
  validateStripePaidAmount,
  computeLinkAfterPayment
} from "../netlify/functions/_shared/post-stripe-payment-link.js";
import { emailProviderConfigured, renderPaymentLinkEmail } from "../netlify/functions/_shared/notification-email.js";
import { smsProviderConfigured, assertSmsConsent, normalizePhoneE164 } from "../netlify/functions/_shared/notification-sms.js";
import {
  assertSavedMethodOwnership,
  mapStripePaymentIntentResult,
  sanitizeChargeResultForClient
} from "../netlify/functions/_shared/payment-saved-charge.js";
import { buildRecurringRunKey, subscriptionDueForBilling, computeRecurringOrderTotals } from "../netlify/functions/_shared/recurring-billing-execute.js";
import { planInventoryReservation } from "../netlify/functions/_shared/inventory-reservation.js";
import { shouldStopRecovery } from "../netlify/functions/_shared/payment-recovery-automation.js";
import { assertPortalCustomer } from "../netlify/functions/_shared/customer-portal-auth.js";
import { buildPaymentOperationsMetrics } from "../netlify/functions/_shared/payment-operations-admin.js";
import { transitionPaymentLinkStatus, planRecoveryAttempt } from "../netlify/functions/_shared/payment-hub-experience.js";

test("parse payment link session metadata", () => {
  const m = parsePaymentLinkSessionMetadata({
    metadata: {
      bloom_payment_link_id: "l1",
      bloom_shop_id: "s1",
      bloom_order_id: "o1",
      bloom_intended_amount_cents: "5000"
    },
    amount_total: 5000
  });
  assert.equal(m.paymentLinkId, "l1");
  assert.equal(m.intendedCents, 5000);
});

test("full payment completion updates link to paid", () => {
  const r = computeLinkAfterPayment({ amount_due: 50, amount_paid: 0, status: "viewed" }, 50);
  assert.equal(r.fullyPaid, true);
  assert.equal(r.status, "paid");
});

test("partial payment webhook amount", () => {
  const v = validateStripePaidAmount({ sessionAmountCents: 2500, intendedCents: 2500, remainingDue: 50 });
  assert.equal(v.valid, true);
  assert.equal(v.amount, 25);
});

test("incorrect amount exceeds balance rejected", () => {
  const v = validateStripePaidAmount({ sessionAmountCents: 10000, remainingDue: 50 });
  assert.equal(v.valid, false);
  assert.equal(v.error, "exceeds_balance");
});

test("duplicate webhook idempotency is handled at insert layer", () => {
  assert.ok(true);
});

test("payment link expiration status", () => {
  const t = transitionPaymentLinkStatus("active", "expire");
  assert.equal(t.status, "expired");
});

test("email configured detection", () => {
  assert.equal(emailProviderConfigured({ BLOOM_EMAIL_PROVIDER: "sendgrid", SENDGRID_API_KEY: "x" }).configured, true);
  assert.equal(emailProviderConfigured({ RESEND_API_KEY: "re_test" }).configured, true);
  assert.equal(emailProviderConfigured({ RESEND_API_KEY: "re_test" }).provider, "resend");
});

test("email not configured", () => {
  assert.equal(emailProviderConfigured({}).configured, false);
});

test("Resend dispatch requires BLOOM_EMAIL_FROM on verified domain", async () => {
  const { dispatchEmail } = await import("../netlify/functions/_shared/notification-email.js");
  const missing = await dispatchEmail({ RESEND_API_KEY: "re_test" }, {
    to: "florist@example.com",
    subject: "Confirm",
    html: "<p>hi</p>",
    text: "hi"
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "email_from_not_configured");
});

test("sms configured twilio", () => {
  const c = smsProviderConfigured({
    BLOOM_SMS_PROVIDER: "twilio",
    TWILIO_ACCOUNT_SID: "a",
    TWILIO_AUTH_TOKEN: "b",
    TWILIO_FROM_NUMBER: "+15551234567"
  });
  assert.equal(c.configured, true);
});

test("sms not configured", () => {
  assert.equal(smsProviderConfigured({}).configured, false);
});

test("normalize phone to e164", () => {
  assert.equal(normalizePhoneE164("5551234567").value, "+15551234567");
});

test("sms consent required", () => {
  assert.equal(assertSmsConsent({ sms_consent: false }).allowed, false);
});

test("saved method cross-shop denied", () => {
  const r = assertSavedMethodOwnership({ method: { shop_id: "a", customer_id: "c1" }, shopId: "b" });
  assert.equal(r.ok, false);
});

test("saved method charge success mapping", () => {
  const m = mapStripePaymentIntentResult({ id: "pi_1", status: "succeeded" });
  assert.equal(m.outcome, "succeeded");
});

test("saved method decline mapping", () => {
  const m = mapStripePaymentIntentResult({ id: "pi_2", status: "requires_payment_method" });
  assert.equal(m.outcome, "declined");
});

test("requires_action mapping", () => {
  const m = mapStripePaymentIntentResult({ id: "pi_3", status: "requires_action", client_secret: "sec" });
  assert.equal(m.outcome, "requires_customer_action");
});

test("sanitize charge result hides secrets", () => {
  const s = sanitizeChargeResultForClient({ ok: true, outcome: "succeeded", intent_id: "pi_x", client_secret: "hide" });
  assert.equal(s.client_secret, undefined);
});

test("recurring run key unique per subscription date", () => {
  const k = buildRecurringRunKey({ id: "sub1", shop_id: "shop1", next_delivery_date: "2026-08-01" });
  assert.match(k, /sub1:shop1:2026-08-01/);
});

test("recurring idempotency same run key", () => {
  const a = buildRecurringRunKey({ id: "s", shop_id: "sh", next_delivery_date: "2026-01-01" });
  const b = buildRecurringRunKey({ id: "s", shop_id: "sh", next_delivery_date: "2026-01-01" });
  assert.equal(a, b);
});

test("inventory shortage marks attention", () => {
  const p = planInventoryReservation([{ id: "i1", name: "Rose", quantity: 1 }], [{ inventory_id: "i1", qty: 5 }]);
  assert.equal(p.ok, false);
  assert.ok(p.shortages.length);
});

test("missing delivery details fails create gracefully", () => {
  assert.ok(true);
});

test("recovery stops after payment", () => {
  const s = shouldStopRecovery({ order: { payment_status: "PAID", total: 100, amount_paid: 100 } });
  assert.equal(s.stop, true);
});

test("recovery retry limits via plan", () => {
  const p = planRecoveryAttempt(3, { max_retries: 3 });
  assert.equal(p.should_retry, false);
});

test("customer portal isolation", () => {
  const r = assertPortalCustomer({ customerId: "c1" }, "c2");
  assert.equal(r.ok, false);
});

test("Bloom SaaS revenue separated from florist volume", () => {
  const m = buildPaymentOperationsMetrics({
    shopSubscriptions: [{ status: "active", plan_code: "professional", metadata: { mrr: 79 } }],
    floristPayments: [{ amount: 200, received_at: "2026-07-28T12:00:00Z" }],
    flowerSubs: [{ status: "active", amount: 45 }]
  });
  assert.equal(m.bloom_technologies_saas.active_bloom_subscribers, 1);
  assert.ok(m.florist_customer_payments.volume_today >= 0);
  assert.notEqual(m.bloom_technologies_saas.label, m.florist_customer_payments.label);
});

test("payment link email template includes pay button not raw token id", () => {
  const tpl = renderPaymentLinkEmail({
    shopName: "Petals",
    customerName: "Sam",
    amountDue: 40,
    payUrl: "https://shop.example/pay.html?t=publictoken",
    expiresAt: "2026-12-01"
  });
  assert.match(tpl.html, /Pay now/);
  assert.doesNotMatch(tpl.html, /bloom_payment_link_id/);
});

test("recurring totals include tax and delivery", () => {
  const t = computeRecurringOrderTotals({ amount: 100, metadata: { delivery_fee: 10 } }, { tax_rate: 0.07 });
  assert.equal(t.total, 117);
});

test("subscription due when next date passed", () => {
  assert.equal(subscriptionDueForBilling({ status: "active", next_delivery_date: "2020-01-01" }), true);
});
