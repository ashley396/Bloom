import test from "node:test";
import assert from "node:assert/strict";
import {
  validatePaymentLinkCreate,
  transitionPaymentLinkStatus,
  hashPaymentLinkToken,
  buildSecurePaymentUrl,
  validateSavedMethodToken,
  sanitizeSavedMethodRow,
  planRecoveryAttempt,
  buildRecurringBillingPlan,
  buildExperienceReports,
  buildRefundAuditEntry,
  experienceSecurityChecklist,
  validateWebhookPayload,
  TERMINAL_CATALOG
} from "../netlify/functions/_shared/payment-hub-experience.js";

test("payment link supports partial amount", () => {
  const v = validatePaymentLinkCreate({ orderTotal: 100, amountRequested: 40, allowPartial: true });
  assert.equal(v.valid, true);
  assert.equal(v.partial, true);
  assert.equal(v.amount, 40);
});

test("payment link status viewed from active", () => {
  const t = transitionPaymentLinkStatus("active", "viewed");
  assert.equal(t.ok, true);
  assert.equal(t.status, "viewed");
});

test("payment link token hashes consistently", () => {
  assert.equal(hashPaymentLinkToken("abc"), hashPaymentLinkToken("abc"));
});

test("secure payment url includes token", () => {
  const u = buildSecurePaymentUrl("https://shop.example", "tok123");
  assert.match(u, /pay\.html\?t=tok123/);
});

test("saved method rejects card numbers", () => {
  assert.equal(validateSavedMethodToken({ pan: "4111" }).valid, false);
  assert.equal(validateSavedMethodToken({ payment_method_id: "pm_1" }).valid, true);
});

test("sanitize saved method hides sensitive fields", () => {
  const s = sanitizeSavedMethodRow({ id: "1", provider_token_ref: "secret", last4: "4242", brand: "visa" });
  assert.equal(s.last4, "4242");
  assert.equal(s.provider_token_ref, undefined);
});

test("recovery plan respects max retries", () => {
  const p = planRecoveryAttempt(3, { max_retries: 3 });
  assert.equal(p.should_retry, false);
});

test("recurring billing plan includes automation steps", () => {
  const plan = buildRecurringBillingPlan({ id: "s1", schedule: "weekly", amount: 55 });
  assert.equal(plan.steps.length, 5);
  assert.ok(plan.steps.some((x) => x.step === "process_payment"));
});

test("experience reports compute success rate", () => {
  const r = buildExperienceReports({
    payments: [{ amount: 10 }, { amount: 0, status: "failed", metadata: { status: "failed" } }],
    links: [],
    refunds: [{ amount: 5 }],
    subscriptions: [{ status: "active", amount: 99 }]
  });
  assert.ok(r.payment_success_rate >= 0);
  assert.equal(r.recurring_revenue, 99);
});

test("refund audit entry captures notes", () => {
  const a = buildRefundAuditEntry({ id: "r1", amount: 10, reason: "duplicate", notes: "VIP" }, { userId: "u1" });
  assert.equal(a.notes, "VIP");
});

test("terminals: Stripe Terminal is real (Switching Barrier Register Wave 6); Square/Clover remain coming soon", () => {
  const byId = Object.fromEntries(TERMINAL_CATALOG.map((t) => [t.id, t.status]));
  assert.equal(byId.stripe_terminal, "available");
  assert.equal(byId.square_terminal, "coming_soon");
  assert.equal(byId.clover_terminal, "coming_soon");
});

test("security checklist documents tenant isolation", () => {
  const c = experienceSecurityChecklist();
  assert.match(c.tenant_isolation, /shop_id/);
});

test("webhook validation requires signature when stripe", () => {
  assert.equal(validateWebhookPayload({ providerId: "stripe", signatureHeader: null, secretConfigured: true }).valid, false);
});
