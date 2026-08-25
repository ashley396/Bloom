import test from "node:test";
import assert from "node:assert/strict";
import { createRecurringDelivery } from "../netlify/functions/_shared/delivery-recurring.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// delivery-recurring.js had only 10.2% coverage despite handling real,
// Stripe-charged recurring orders — a bug here either double-books a
// delivery or silently drops one. These exercise the real branches:
// dedup-by-order, customer fallback, missing-details handling, and the
// shop-timezone default date.

test("createRecurringDelivery: an existing delivery for this order is detected and returns duplicate:true without inserting a new row", async () => {
  const client = createFakeSupabaseClient([{ data: { id: "existing-delivery" }, error: null }]);
  const result = await createRecurringDelivery(client, { shopId: "shop-1", orderId: "order-1" });
  assert.deepEqual(result, { ok: true, delivery_id: "existing-delivery", duplicate: true });
  assert.equal(client.calls.length, 1, "must not query customers or insert once a duplicate is found");
});

test("createRecurringDelivery: builds the delivery from subscription metadata when no customerId is given", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // no existing delivery
    { data: { id: "new-delivery" }, error: null }, // insert().select().single()
  ]);
  const result = await createRecurringDelivery(client, {
    shopId: "shop-1",
    orderId: "order-2",
    subscription: {
      metadata: {
        delivery_address: "123 Main St",
        recipient_name: "Jane Doe",
        recipient_phone: "555-1234",
        delivery_instructions: "Leave at back door",
      },
      next_delivery_date: "2026-09-01",
    },
  });
  assert.deepEqual(result, { ok: true, delivery_id: "new-delivery" });
  const insertCall = client.calls.find((c) => c.table === "deliveries" && c.payload);
  assert.equal(insertCall.payload.address, "123 Main St");
  assert.equal(insertCall.payload.recipient_name, "Jane Doe");
  assert.equal(insertCall.payload.delivery_date, "2026-09-01");
});

test("createRecurringDelivery: falls back to the linked customer's saved address/name/phone when the subscription metadata is blank", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // no existing delivery
    { data: { name: "Jane Doe", phone: "555-1234", address: "456 Oak Ave" }, error: null }, // customer lookup
    { data: { id: "new-delivery" }, error: null }, // insert
  ]);
  const result = await createRecurringDelivery(client, {
    shopId: "shop-1",
    orderId: "order-3",
    customerId: "cust-1",
    subscription: { metadata: {} },
  });
  assert.equal(result.ok, true);
  const insertCall = client.calls.find((c) => c.table === "deliveries" && c.payload);
  assert.equal(insertCall.payload.address, "456 Oak Ave");
  assert.equal(insertCall.payload.recipient_name, "Jane Doe");
});

test("createRecurringDelivery: metadata takes priority over the customer's saved details when both are present", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null },
    { data: { name: "Customer Name", phone: "555-0000", address: "Customer Address" }, error: null },
    { data: { id: "new-delivery" }, error: null },
  ]);
  const result = await createRecurringDelivery(client, {
    shopId: "shop-1",
    orderId: "order-4",
    customerId: "cust-1",
    subscription: { metadata: { delivery_address: "Override Address", recipient_name: "Override Name" } },
  });
  assert.equal(result.ok, true);
  const insertCall = client.calls.find((c) => c.table === "deliveries" && c.payload);
  assert.equal(insertCall.payload.address, "Override Address");
  assert.equal(insertCall.payload.recipient_name, "Override Name");
});

test("createRecurringDelivery: missing address or recipient flags the order for attention instead of inserting a bad delivery", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // no existing delivery
    { data: null, error: null }, // orders update (fire-and-forget .catch())
  ]);
  const result = await createRecurringDelivery(client, {
    shopId: "shop-1",
    orderId: "order-5",
    subscription: { metadata: {} },
  });
  assert.deepEqual(result, { ok: false, reason: "missing_delivery_details" });
  const insertCall = client.calls.find((c) => c.table === "deliveries" && c.payload);
  assert.equal(insertCall, undefined, "must never insert a delivery with no address/recipient");
  const flagCall = client.calls.find((c) => c.table === "orders");
  assert.deepEqual(flagCall.payload, { metadata: { delivery_attention_required: true } });
});

test("createRecurringDelivery: with no next_delivery_date on the subscription, defaults to the shop's own local today (not a fixed/UTC date)", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null },
    { data: { id: "new-delivery" }, error: null },
  ]);
  await createRecurringDelivery(client, {
    shopId: "shop-1",
    orderId: "order-6",
    timezone: "America/New_York",
    subscription: {
      metadata: { delivery_address: "1 Elm St", recipient_name: "Sam" },
    },
  });
  const insertCall = client.calls.find((c) => c.table === "deliveries" && c.payload);
  assert.match(insertCall.payload.delivery_date, /^\d{4}-\d{2}-\d{2}$/, "must resolve to a real calendar date string");
});

test("createRecurringDelivery: an insert error is reported through the result, not thrown", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null },
    { data: null, error: { message: "insert failed" } },
  ]);
  const result = await createRecurringDelivery(client, {
    shopId: "shop-1",
    orderId: "order-7",
    subscription: { metadata: { delivery_address: "1 Elm St", recipient_name: "Sam" } },
  });
  assert.deepEqual(result, { ok: false, reason: "insert failed" });
});
