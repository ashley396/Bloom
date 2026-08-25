import test from "node:test";
import assert from "node:assert/strict";
import { shouldStopRecovery, runPaymentRecovery, notifyPaymentFailed } from "../netlify/functions/_shared/payment-recovery-automation.js";

// payment-recovery-automation.js had only 24% coverage despite being the
// logic that decides whether to keep chasing an unpaid order — a bug here
// either nags a customer who already paid, or silently gives up on one
// who hasn't. Every test passes env:{} explicitly (never process.env) so
// no real email/SMS provider call can ever fire, matching the codebase's
// own "not configured" degrade path.

test("shouldStopRecovery: stops once the order itself shows PAID", () => {
  const result = shouldStopRecovery({ order: { payment_status: "PAID", total: 50 } });
  assert.deepEqual(result, { stop: true, reason: "order_paid" });
});

test("shouldStopRecovery: stops once the subscription is cancelled, even if the order still shows a balance", () => {
  const result = shouldStopRecovery({ order: { total: 50, amount_paid: 0 }, subscription: { status: "cancelled" } });
  assert.deepEqual(result, { stop: true, reason: "subscription_canceled" });
});

test("shouldStopRecovery: stops once the payment link itself is marked paid", () => {
  const result = shouldStopRecovery({ order: { total: 50, amount_paid: 0 }, link: { status: "paid" } });
  assert.deepEqual(result, { stop: true, reason: "link_paid" });
});

test("shouldStopRecovery: stops on an effectively-zero remaining balance (rounding dust), not just an exact zero", () => {
  const result = shouldStopRecovery({ order: { total: 50, amount_paid: 49.999 } });
  assert.deepEqual(result, { stop: true, reason: "zero_balance" });
});

test("shouldStopRecovery: a real unpaid balance with no stop condition continues recovery", () => {
  const result = shouldStopRecovery({ order: { total: 50, amount_paid: 10, payment_status: "unpaid" } });
  assert.deepEqual(result, { stop: false });
});

test("runPaymentRecovery: an already-paid order stops immediately without planning an attempt", async () => {
  const result = await runPaymentRecovery({ order: { payment_status: "PAID", total: 50 }, env: {} });
  assert.deepEqual(result, { stopped: true, reason: "order_paid" });
});

test("runPaymentRecovery: exhausting the retry budget reports exhausted instead of stopped", async () => {
  const result = await runPaymentRecovery({
    order: { total: 50, amount_paid: 0, payment_status: "unpaid" },
    attemptNumber: 5,
    config: { max_retries: 3 },
    env: {},
  });
  assert.equal(result.exhausted, true);
  assert.equal(result.plan.should_retry, false);
});

test("runPaymentRecovery: with a real customer email and no email provider configured, attempts email and reports the honest not-configured result", async () => {
  const result = await runPaymentRecovery({
    order: { total: 50, amount_paid: 10, payment_status: "unpaid" },
    customer: { email: "florist-customer@example.com" },
    shop: { name: "Bloom & Co" },
    attemptNumber: 0,
    payUrl: "https://florisyn.com/pay/abc",
    env: {},
  });
  const emailResult = result.results.channels.find((c) => c.channel === "email");
  assert.ok(emailResult, "email channel must be attempted when send_email and a customer email exist");
  assert.equal(emailResult.code, "provider_not_configured");
});

test("runPaymentRecovery: with no customer email at all, the email channel is never attempted", async () => {
  const result = await runPaymentRecovery({
    order: { total: 50, amount_paid: 10, payment_status: "unpaid" },
    customer: {},
    attemptNumber: 0,
    env: {},
  });
  assert.equal(result.results.channels.find((c) => c.channel === "email"), undefined);
});

test("runPaymentRecovery: sms is skipped with a clear no_consent code when the customer opted out, never silently dropped", async () => {
  const result = await runPaymentRecovery({
    order: { total: 50, amount_paid: 10, payment_status: "unpaid" },
    customer: { phone: "5551234567", sms_consent: false },
    attemptNumber: 0,
    config: { sms_reminders: true },
    env: {},
  });
  const smsResult = result.results.channels.find((c) => c.channel === "sms");
  assert.deepEqual(smsResult, { channel: "sms", ok: false, code: "no_consent" });
});

test("runPaymentRecovery: sms is attempted (and honestly reports not-configured) when consent is given and reminders are enabled", async () => {
  const result = await runPaymentRecovery({
    order: { total: 50, amount_paid: 10, payment_status: "unpaid" },
    customer: { phone: "5551234567" },
    attemptNumber: 0,
    config: { sms_reminders: true },
    env: {},
  });
  const smsResult = result.results.channels.find((c) => c.channel === "sms");
  assert.equal(smsResult.code, "provider_not_configured");
});

test("runPaymentRecovery: carries the florist-notify flag and the real payment link through to the caller", async () => {
  const result = await runPaymentRecovery({
    order: { total: 50, amount_paid: 10, payment_status: "unpaid" },
    customer: {},
    attemptNumber: 0,
    payUrl: "https://florisyn.com/pay/xyz",
    env: {},
  });
  assert.equal(result.results.notify_florist, true);
  assert.equal(result.results.payment_link, "https://florisyn.com/pay/xyz");
});

test("notifyPaymentFailed: with both a real email and phone, attempts both channels", async () => {
  const result = await notifyPaymentFailed({
    customer: { email: "a@example.com", phone: "5551234567" },
    shop: { name: "Bloom & Co" },
    payUrl: "https://florisyn.com/pay/abc",
    amountDue: 25,
    env: {},
  });
  assert.equal(result.email.code, "provider_not_configured");
  assert.equal(result.sms.code, "provider_not_configured");
});

test("notifyPaymentFailed: with no email or phone on file, attempts nothing and returns an empty result", async () => {
  const result = await notifyPaymentFailed({ customer: {}, env: {} });
  assert.deepEqual(result, {});
});

test("notifyPaymentFailed: respects sms opt-out the same way runPaymentRecovery does", async () => {
  const result = await notifyPaymentFailed({
    customer: { phone: "5551234567", sms_consent: false },
    env: {},
  });
  assert.equal(result.sms, undefined, "an opted-out customer must not even be attempted, not just reported as failed");
});
