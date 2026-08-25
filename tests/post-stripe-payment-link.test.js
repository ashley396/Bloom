import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePaymentLinkSessionMetadata,
  validateStripePaidAmount,
  computeLinkAfterPayment,
  recordWebhookIdempotency,
  findExistingWebhookEvent,
  postStripePaymentLink,
} from "../netlify/functions/_shared/post-stripe-payment-link.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// post-stripe-payment-link.js had only 23.6% coverage despite being the
// Stripe webhook handler that actually applies real money to a payment
// link and order — the amount-validation logic in particular is a real
// fraud/bug surface (never let a webhook apply more than what's owed).

test("parsePaymentLinkSessionMetadata: reads the bloom_-prefixed keys, falling back to the unprefixed ones", () => {
  const meta = parsePaymentLinkSessionMetadata({
    metadata: { payment_link_id: "link-1", shop_id: "shop-1", order_id: "order-1", customer_id: "cust-1" },
  });
  assert.deepEqual(meta, { paymentLinkId: "link-1", shopId: "shop-1", orderId: "order-1", customerId: "cust-1", intendedCents: null });
});

test("parsePaymentLinkSessionMetadata: prefers the bloom_-prefixed keys when both are present", () => {
  const meta = parsePaymentLinkSessionMetadata({
    metadata: { bloom_payment_link_id: "link-real", payment_link_id: "link-legacy" },
  });
  assert.equal(meta.paymentLinkId, "link-real");
});

test("parsePaymentLinkSessionMetadata: no session/metadata at all resolves to all-null, not a crash", () => {
  assert.deepEqual(parsePaymentLinkSessionMetadata(), { paymentLinkId: null, shopId: null, orderId: null, customerId: null, intendedCents: null });
});

test("parsePaymentLinkSessionMetadata: parses the intended-amount cents to a real number", () => {
  const meta = parsePaymentLinkSessionMetadata({ metadata: { bloom_intended_amount_cents: "5000" } });
  assert.equal(meta.intendedCents, 5000);
});

test("validateStripePaidAmount: a zero-amount session is always rejected", () => {
  const result = validateStripePaidAmount({ sessionAmountCents: 0, remainingDue: 100 });
  assert.deepEqual(result, { valid: false, error: "zero_amount", amount: 0 });
});

test("validateStripePaidAmount: paying more than what's actually owed is rejected — never applies more than the real remaining balance", () => {
  const result = validateStripePaidAmount({ sessionAmountCents: 15000, remainingDue: 100 });
  assert.equal(result.valid, false);
  assert.equal(result.error, "exceeds_balance");
});

test("validateStripePaidAmount: paying exactly the remaining balance (within the 2-cent tolerance) is accepted", () => {
  const result = validateStripePaidAmount({ sessionAmountCents: 10001, remainingDue: 100 });
  assert.equal(result.valid, true);
});

test("validateStripePaidAmount: paying MORE than the intended amount (but still within the real balance) is rejected as a mismatch", () => {
  const result = validateStripePaidAmount({ sessionAmountCents: 9000, intendedCents: 5000, remainingDue: 100 });
  assert.equal(result.valid, false);
  assert.equal(result.error, "amount_mismatch");
});

test("validateStripePaidAmount: paying LESS than the intended amount is allowed through as a partial payment, not rejected", () => {
  const result = validateStripePaidAmount({ sessionAmountCents: 3000, intendedCents: 5000, remainingDue: 100 });
  assert.equal(result.valid, true, "underpaying relative to intent must still apply — only overpaying relative to intent is a mismatch");
  assert.equal(result.amount, 30);
});

test("validateStripePaidAmount: applyAmount is capped at the real remaining balance (within the tolerance band), never a stray fraction of a cent over", () => {
  const result = validateStripePaidAmount({ sessionAmountCents: 4001, remainingDue: 40 });
  assert.equal(result.valid, true);
  assert.equal(result.amount, 40, "a 1-cent overage inside the tolerance band must still apply exactly the real remaining balance");
});

test("computeLinkAfterPayment: a payment that reaches the full due amount transitions to paid", () => {
  const result = computeLinkAfterPayment({ amount_due: 100, amount_paid: 0, status: "active" }, 100);
  assert.deepEqual(result, { newPaid: 100, fullyPaid: true, status: "paid" });
});

test("computeLinkAfterPayment: a partial payment transitions to partially_paid, not paid", () => {
  const result = computeLinkAfterPayment({ amount_due: 100, amount_paid: 0, status: "viewed" }, 40);
  assert.deepEqual(result, { newPaid: 40, fullyPaid: false, status: "partially_paid" });
});

test("computeLinkAfterPayment: accumulates on top of a prior partial payment", () => {
  const result = computeLinkAfterPayment({ amount_due: 100, amount_paid: 40, status: "partially_paid" }, 60);
  assert.deepEqual(result, { newPaid: 100, fullyPaid: true, status: "paid" });
});

test("computeLinkAfterPayment: an invalid state transition (e.g. an already-expired link) keeps the original status rather than forcing an illegal one", () => {
  const result = computeLinkAfterPayment({ amount_due: 100, amount_paid: 0, status: "expired" }, 100);
  assert.equal(result.status, "expired");
});

test("recordWebhookIdempotency: a real duplicate-key conflict is reported as duplicate:true, not thrown", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { code: "23505" } }]);
  const result = await recordWebhookIdempotency(client, { providerEventId: "evt_1", shopId: "shop-1", eventType: "x" });
  assert.deepEqual(result, { duplicate: true });
});

test("recordWebhookIdempotency: a not-yet-migrated table degrades gracefully instead of blocking the webhook", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { code: "42P01" } }]);
  const result = await recordWebhookIdempotency(client, { providerEventId: "evt_1", shopId: "shop-1", eventType: "x" });
  assert.deepEqual(result, { duplicate: false, skipped_table: true });
});

test("recordWebhookIdempotency: any other database error is thrown, not swallowed", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { code: "500", message: "db down" } }]);
  await assert.rejects(() => recordWebhookIdempotency(client, { providerEventId: "evt_1", shopId: "shop-1", eventType: "x" }));
});

test("findExistingWebhookEvent: a not-yet-migrated table returns null (no prior event), not a thrown error", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { code: "42P01" } }]);
  assert.equal(await findExistingWebhookEvent(client, "evt_1"), null);
});

test("postStripePaymentLink: an unpaid session is a clean no-op", async () => {
  const client = createFakeSupabaseClient([]);
  const result = await postStripePaymentLink(client, { payment_status: "unpaid" }, "evt_1");
  assert.deepEqual(result, { paid: false, skipped: "not_paid" });
  assert.equal(client.calls.length, 0);
});

test("postStripePaymentLink: a webhook event already processed is idempotent — never re-applies the payment", async () => {
  const client = createFakeSupabaseClient([{ data: { id: "idem-1", result: { amount: 50 } }, error: null }]);
  const result = await postStripePaymentLink(client, { payment_status: "paid" }, "evt_1");
  assert.deepEqual(result, { paid: true, duplicate: true, prior: { amount: 50 } });
  assert.equal(client.calls.length, 1);
});

test("postStripePaymentLink: missing required bloom metadata is a hard failure, never silently ignored", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  await assert.rejects(
    () => postStripePaymentLink(client, { payment_status: "paid", metadata: {} }, "evt_1"),
    /missing bloom_payment_link_id or bloom_shop_id/
  );
});

test("postStripePaymentLink: a payment link that doesn't exist is a hard failure", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // no existing webhook event
    { data: null, error: null }, // link lookup: not found
  ]);
  await assert.rejects(
    () => postStripePaymentLink(client, { payment_status: "paid", metadata: { bloom_payment_link_id: "link-1", bloom_shop_id: "shop-1" } }, "evt_1"),
    /Payment link not found/
  );
});

test("postStripePaymentLink: a link that's already paid or canceled is reported idempotently, never double-applied", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // no existing webhook event
    { data: { id: "link-1", shop_id: "shop-1", status: "paid" }, error: null }, // link already paid
    { data: { id: "idem-1" }, error: null }, // recordWebhookIdempotency insert
  ]);
  const result = await postStripePaymentLink(
    client,
    { payment_status: "paid", metadata: { bloom_payment_link_id: "link-1", bloom_shop_id: "shop-1" } },
    "evt_1"
  );
  assert.deepEqual(result, { paid: true, duplicate: true, link_status: "paid" });
});

test("postStripePaymentLink: a rejected amount (exceeds the real balance) throws and never updates the link", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // no existing webhook event
    { data: { id: "link-1", shop_id: "shop-1", status: "active", amount_due: 50, amount_paid: 0 }, error: null }, // link
    { data: null, error: null }, // payment_hub_provider_events insert (amount rejected)
  ]);
  await assert.rejects(
    () =>
      postStripePaymentLink(
        client,
        { payment_status: "paid", amount_total: 20000, metadata: { bloom_payment_link_id: "link-1", bloom_shop_id: "shop-1" } },
        "evt_1"
      ),
    /Payment link amount rejected: exceeds_balance/
  );
  const linkUpdateCall = client.calls.find((c) => c.table === "payment_hub_payment_links" && c.payload);
  assert.equal(linkUpdateCall, undefined, "a rejected amount must never reach the link update");
});

test("postStripePaymentLink: a full successful payment updates the link, posts the order payment, updates the matching invoice, and records the audit + idempotency rows", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // 1. no existing webhook event
    { data: { id: "link-1", shop_id: "shop-1", status: "active", amount_due: 100, amount_paid: 0, order_id: "order-1", metadata: {} }, error: null }, // 2. link lookup
    { data: null, error: null }, // 3. payment_hub_payment_links update
    { data: { ok: true }, error: null }, // 4. rpc post_order_payment
    { data: [{ id: "inv-1", total: 100, amount_paid: 0 }], error: null }, // 5. invoices select
    { data: null, error: null }, // 6. invoices update
    { data: null, error: null }, // 7. audit_events insert
    { data: null, error: null }, // 8. payment_hub_provider_events insert (paid)
    { data: { id: "idem-1" }, error: null }, // 9. recordWebhookIdempotency insert
  ]);
  const session = {
    id: "cs_1",
    payment_status: "paid",
    amount_total: 10000,
    payment_intent: "pi_1",
    metadata: { bloom_payment_link_id: "link-1", bloom_shop_id: "shop-1", bloom_order_id: "order-1" },
  };
  const result = await postStripePaymentLink(client, session, "evt_1");
  assert.deepEqual(result, { paid: true, duplicate: false, amount: 100, fully_paid: true, link_id: "link-1" });

  const linkUpdateCall = client.calls.find((c) => c.table === "payment_hub_payment_links" && c.payload);
  assert.equal(linkUpdateCall.payload.amount_paid, 100);
  assert.equal(linkUpdateCall.payload.status, "paid");
  assert.equal(linkUpdateCall.payload.metadata.last_payment_intent_id, "pi_1");

  const invoiceUpdateCall = client.calls.find((c) => c.table === "invoices" && c.payload);
  assert.equal(invoiceUpdateCall.payload.status, "paid");
});
