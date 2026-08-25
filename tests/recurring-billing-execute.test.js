import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRecurringRunKey,
  subscriptionDueForBilling,
  computeRecurringOrderTotals,
  executeRecurringSubscriptionRun,
} from "../netlify/functions/_shared/recurring-billing-execute.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// recurring-billing-execute.js had only 21.9% coverage despite being the
// code that actually charges a florist's customer on a recurring
// schedule — a bug here means a double charge, a silently skipped
// billing cycle, or a charge with no delivery ever created for it.

test("buildRecurringRunKey: a real billingDate takes priority over the subscription's own next_delivery_date", () => {
  const key = buildRecurringRunKey({ id: "sub-1", shop_id: "shop-1", next_delivery_date: "2026-05-01" }, "2026-05-15");
  assert.equal(key, "sub-1:shop-1:2026-05-15");
});

test("buildRecurringRunKey: falls back to the subscription's next_delivery_date when no explicit billingDate is given", () => {
  const key = buildRecurringRunKey({ id: "sub-1", shop_id: "shop-1", next_delivery_date: "2026-05-01" }, null);
  assert.equal(key, "sub-1:shop-1:2026-05-01");
});

test("buildRecurringRunKey: with neither, resolves a real shop-local date string, never leaving the key with an empty date segment", () => {
  const key = buildRecurringRunKey({ id: "sub-1", shop_id: "shop-1" }, null, "America/New_York");
  assert.match(key, /^sub-1:shop-1:\d{4}-\d{2}-\d{2}$/);
});

test("subscriptionDueForBilling: an inactive/paused subscription is never due, regardless of its date", () => {
  assert.equal(subscriptionDueForBilling({ status: "paused", next_delivery_date: "2020-01-01" }), false);
});

test("subscriptionDueForBilling: no next_delivery_date at all on an active subscription is due immediately (first run)", () => {
  assert.equal(subscriptionDueForBilling({ status: "active" }), true);
});

test("subscriptionDueForBilling: a future due date is not yet due", () => {
  const asOf = new Date("2026-05-01T12:00:00Z");
  assert.equal(subscriptionDueForBilling({ status: "active", next_delivery_date: "2026-06-01" }, asOf), false);
});

test("subscriptionDueForBilling: a past or today due date is due", () => {
  const asOf = new Date("2026-05-01T12:00:00Z");
  assert.equal(subscriptionDueForBilling({ status: "active", next_delivery_date: "2026-05-01" }, asOf), true);
  assert.equal(subscriptionDueForBilling({ status: "active", next_delivery_date: "2026-04-01" }, asOf), true);
});

test("computeRecurringOrderTotals: computes tax from the shop's real tax rate and rounds to the cent", () => {
  const totals = computeRecurringOrderTotals({ amount: 50 }, { tax_rate: 0.0825 });
  assert.equal(totals.subtotal, 50);
  assert.equal(totals.tax, 4.13);
  assert.equal(totals.total, 54.13);
});

test("computeRecurringOrderTotals: the subscription's own delivery_fee override wins over the shop's default", () => {
  const totals = computeRecurringOrderTotals({ amount: 30, metadata: { delivery_fee: 12 } }, { default_delivery_fee: 5 });
  assert.equal(totals.deliveryFee, 12);
  assert.equal(totals.total, 42);
});

test("computeRecurringOrderTotals: falls back to the shop's default delivery fee when the subscription has none", () => {
  const totals = computeRecurringOrderTotals({ amount: 30 }, { default_delivery_fee: 5 });
  assert.equal(totals.deliveryFee, 5);
});

test("computeRecurringOrderTotals: with no shop settings and no metadata at all, defaults to zero tax and zero delivery fee, not NaN", () => {
  const totals = computeRecurringOrderTotals({ amount: 20 });
  assert.deepEqual(totals, { subtotal: 20, tax: 0, deliveryFee: 0, total: 20 });
});

test("executeRecurringSubscriptionRun: a duplicate run (already running or completed) is skipped without creating a second order", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "run-1", status: "completed", order_id: "order-existing" }, error: null },
  ]);
  const result = await executeRecurringSubscriptionRun({
    client,
    stripe: null,
    shop: { id: "shop-1", timezone: "America/New_York" },
    sub: { id: "sub-1", shop_id: "shop-1", customer_id: "cust-1", amount: 40 },
    settings: {},
  });
  assert.equal(result.outcome, "skipped");
  assert.equal(result.reason, "duplicate_run");
  assert.equal(result.order_id, "order-existing");
  assert.equal(client.calls.length, 1, "a duplicate run must short-circuit before any order/charge work");
});

test("executeRecurringSubscriptionRun: an order-create failure stops the run cleanly, without attempting to charge anything", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // no existing run
    { data: null, error: { message: "create_order_atomic failed" } }, // rpc create_order_atomic
  ]);
  const result = await executeRecurringSubscriptionRun({
    client,
    stripe: null,
    shop: { id: "shop-1" },
    sub: { id: "sub-1", shop_id: "shop-1", customer_id: "cust-1", amount: 40 },
    settings: {},
  });
  assert.deepEqual(result, { outcome: "failed", reason: "order_create_failed", run_key: result.run_key });
  assert.equal(client.calls.length, 2);
});

test("executeRecurringSubscriptionRun: a full successful run reserves inventory, schedules delivery, charges the saved card, and rolls the subscription forward", async () => {
  let capturedIntentParams = null;
  const stripe = {
    paymentMethods: { retrieve: async () => ({ customer: "cus_123" }) },
    paymentIntents: {
      create: async (params) => {
        capturedIntentParams = params;
        return { id: "pi_success", status: "succeeded" };
      },
    },
  };
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // 1. no existing run
    { data: { item: { id: "order-1" } }, error: null }, // 2. rpc create_order_atomic
    { data: [{ id: "inv-1", name: "Design stems", quantity: 100 }], error: null }, // 3. inventory select
    { data: null, error: null }, // 4. inventory update (reservation)
    { data: null, error: null }, // 5. deliveries select (no existing)
    { data: { name: "Jane Doe", phone: "555-1234", address: "456 Existing Ave" }, error: null }, // 6. customers select (sub.customer_id is set)
    { data: { id: "delivery-1" }, error: null }, // 7. deliveries insert
    { data: [{ id: "method-1", provider_token_ref: "pm_123", stripe_customer_id: "cus_123", shop_id: "shop-1", customer_id: "cust-1" }], error: null }, // 8. saved methods select
    { data: null, error: null }, // 9. rpc post_order_payment
    { data: null, error: null }, // 10. payment_hub_recurring_runs insert
    { data: null, error: null }, // 11. bloom_customer_subscriptions update (next_delivery_date)
  ]);
  const result = await executeRecurringSubscriptionRun({
    client,
    stripe,
    shop: { id: "shop-1", timezone: "America/New_York" },
    sub: {
      id: "sub-1",
      shop_id: "shop-1",
      customer_id: "cust-1",
      amount: 40,
      schedule: "monthly",
      metadata: { delivery_address: "123 Main St", recipient_name: "Jane Doe" },
    },
    settings: {},
  });

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.order_id, "order-1");
  assert.equal(result.payment.ok, true);
  assert.equal(result.payment.outcome, "succeeded");
  assert.equal(result.payment.intent_id, "pi_success");
  assert.equal(result.inventory.ok, true);
  assert.equal(result.delivery.ok, true);
  assert.equal(result.notify_customer, true);
  assert.equal(result.notify_staff, true);
  assert.equal(capturedIntentParams.amount, 4000, "must charge the real computed total in cents, not a stale/hardcoded amount");

  const runInsertCall = client.calls.find((c) => c.table === "payment_hub_recurring_runs" && c.payload);
  assert.equal(runInsertCall.payload.status, "completed");

  const subUpdateCall = client.calls.find((c) => c.table === "bloom_customer_subscriptions" && c.payload);
  assert.ok(subUpdateCall, "a successful charge must roll the subscription's next_delivery_date forward");
});

test("executeRecurringSubscriptionRun: with no saved payment method at all, the order/inventory/delivery still complete but payment is honestly reported as failed", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // no existing run
    { data: { item: { id: "order-2" } }, error: null }, // rpc create_order_atomic
    { data: [{ id: "inv-1", name: "Design stems", quantity: 100 }], error: null }, // inventory select
    { data: null, error: null }, // inventory update
    { data: null, error: null }, // deliveries select
    { data: { id: "delivery-2" }, error: null }, // deliveries insert
    { data: [], error: null }, // saved methods select — none on file
    { data: null, error: null }, // payment_hub_recurring_runs insert
  ]);
  const result = await executeRecurringSubscriptionRun({
    client,
    stripe: { paymentIntents: { create() { throw new Error("must not be called with no saved method"); } } },
    shop: { id: "shop-1", timezone: "America/New_York" },
    sub: {
      id: "sub-2",
      shop_id: "shop-1",
      customer_id: "cust-2",
      amount: 40,
      metadata: { delivery_address: "123 Main St", recipient_name: "Jane Doe" },
    },
    settings: {},
  });
  assert.equal(result.outcome, "payment_failed");
  assert.equal(result.payment.outcome, "payment_failed");
  assert.equal(result.notify_customer, false, "a failed charge must never tell the customer it succeeded");
  const subUpdateCall = client.calls.find((c) => c.table === "bloom_customer_subscriptions");
  assert.equal(subUpdateCall, undefined, "a failed payment must not roll the subscription's next delivery date forward");
});
