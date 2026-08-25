import test from "node:test";
import assert from "node:assert/strict";
import { ORDER_STATUSES, normalizeOrderStatus, orderStatusLabel, recordOrderStatusChange } from "../netlify/functions/_shared/order-status.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// order-status.js had only 54.4% coverage despite being the vocabulary
// every order-status transition in the app is normalized through — a bug
// here silently mislabels or drops history rows.

test("normalizeOrderStatus: maps the legacy 'NEW' value to the current 'PENDING' status", () => {
  assert.equal(normalizeOrderStatus("NEW"), "PENDING");
  assert.equal(normalizeOrderStatus("new"), "PENDING");
});

test("normalizeOrderStatus: is case-insensitive and passes through an already-current value unchanged", () => {
  assert.equal(normalizeOrderStatus("delivered"), "DELIVERED");
  assert.equal(normalizeOrderStatus("READY"), "READY");
});

test("normalizeOrderStatus: defaults to PENDING when given nothing", () => {
  assert.equal(normalizeOrderStatus(), "PENDING");
  assert.equal(normalizeOrderStatus(null), "PENDING");
  assert.equal(normalizeOrderStatus(""), "PENDING");
});

test("normalizeOrderStatus: an unrecognized value is passed through uppercased rather than silently coerced", () => {
  assert.equal(normalizeOrderStatus("some_future_status"), "SOME_FUTURE_STATUS");
});

test("orderStatusLabel: returns the real display label for every declared status", () => {
  for (const s of ORDER_STATUSES) {
    assert.equal(orderStatusLabel(s.value), s.label);
  }
});

test("orderStatusLabel: normalizes legacy values before labeling", () => {
  assert.equal(orderStatusLabel("NEW"), "Pending");
});

test("orderStatusLabel: an unrecognized status falls back to the normalized raw value, not a blank label", () => {
  assert.equal(orderStatusLabel("weird_status"), "WEIRD_STATUS");
});

test("recordOrderStatusChange: missing shopId, orderId, or toStatus is a silent no-op with zero queries", async () => {
  const client = createFakeSupabaseClient([]);
  await recordOrderStatusChange(client, { shopId: null, orderId: "o1", toStatus: "READY" });
  await recordOrderStatusChange(client, { shopId: "s1", orderId: null, toStatus: "READY" });
  await recordOrderStatusChange(client, { shopId: "s1", orderId: "o1", toStatus: null });
  assert.equal(client.calls.length, 0);
});

test("recordOrderStatusChange: a no-op transition (same status before/after normalization) writes no history row", async () => {
  const client = createFakeSupabaseClient([]);
  await recordOrderStatusChange(client, { shopId: "s1", orderId: "o1", fromStatus: "NEW", toStatus: "PENDING" });
  assert.equal(client.calls.length, 0, "NEW normalizes to PENDING, so this is not a real transition");
});

test("recordOrderStatusChange: a real transition inserts a normalized history row", async () => {
  const client = createFakeSupabaseClient([{ data: { id: 1 }, error: null }]);
  await recordOrderStatusChange(client, {
    shopId: "s1",
    orderId: "o1",
    fromStatus: "new",
    toStatus: "designing",
    userId: "u1",
    note: "started arranging",
  });
  const insertCall = client.calls.find((c) => c.table === "order_status_history");
  assert.deepEqual(insertCall.payload, {
    shop_id: "s1",
    order_id: "o1",
    from_status: "PENDING",
    to_status: "DESIGNING",
    changed_by: "u1",
    note: "started arranging",
  });
});

test("recordOrderStatusChange: no fromStatus (e.g. a brand-new order) records a null from_status", async () => {
  const client = createFakeSupabaseClient([{ data: { id: 1 }, error: null }]);
  await recordOrderStatusChange(client, { shopId: "s1", orderId: "o1", toStatus: "PENDING" });
  const insertCall = client.calls.find((c) => c.table === "order_status_history");
  assert.equal(insertCall.payload.from_status, null);
});

test("recordOrderStatusChange: an insert failure is swallowed, never thrown — history is best-effort, not order-blocking", async () => {
  const client = { from: () => ({ insert: () => Promise.reject(new Error("db unreachable")) }) };
  await assert.doesNotReject(() =>
    recordOrderStatusChange(client, { shopId: "s1", orderId: "o1", toStatus: "READY" })
  );
});
