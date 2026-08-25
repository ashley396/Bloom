import test from "node:test";
import assert from "node:assert/strict";
import { buildOrderWorkloadSummary, buildWorkloadSummaryText } from "../netlify/functions/_shared/order-workload-intelligence.js";

// Phase 6 ("Do not fabricate urgency") of the Lily Connected Intelligence
// pass — real, checkable workload buckets computed from real order fields
// (delivery_date, status, designer, driver, fulfillment), never guessed.

const TODAY = "2026-08-25";

test("buildOrderWorkloadSummary: a past delivery_date on a still-open order is overdue", () => {
  const result = buildOrderWorkloadSummary(
    [{ id: "o1", order_number: "1001", customer_name: "A", status: "DESIGNING", delivery_date: "2026-08-23", fulfillment: "PICKUP" }],
    { todayStr: TODAY }
  );
  assert.equal(result.counts.overdue, 1);
  assert.equal(result.overdue[0].id, "o1");
  assert.equal(result.counts.dueSoon, 0);
});

test("buildOrderWorkloadSummary: a delivery_date within soonDays counts as due soon, not overdue", () => {
  const result = buildOrderWorkloadSummary(
    [{ id: "o1", status: "DESIGNING", delivery_date: "2026-08-26", fulfillment: "PICKUP" }],
    { todayStr: TODAY, soonDays: 2 }
  );
  assert.equal(result.counts.dueSoon, 1);
  assert.equal(result.counts.overdue, 0);
});

test("buildOrderWorkloadSummary: a delivery_date beyond soonDays counts in neither bucket", () => {
  const result = buildOrderWorkloadSummary(
    [{ id: "o1", status: "DESIGNING", delivery_date: "2026-09-10", fulfillment: "PICKUP" }],
    { todayStr: TODAY, soonDays: 2 }
  );
  assert.equal(result.counts.overdue, 0);
  assert.equal(result.counts.dueSoon, 0);
});

test("buildOrderWorkloadSummary: COMPLETED/DELIVERED/CANCELLED orders are never counted, even with a past delivery_date", () => {
  const orders = [
    { id: "o1", status: "COMPLETED", delivery_date: "2026-08-01", fulfillment: "PICKUP" },
    { id: "o2", status: "DELIVERED", delivery_date: "2026-08-01", fulfillment: "DELIVERY" },
    { id: "o3", status: "CANCELLED", delivery_date: "2026-08-01", fulfillment: "PICKUP" }
  ];
  const result = buildOrderWorkloadSummary(orders, { todayStr: TODAY });
  assert.deepEqual(result.counts, { overdue: 0, dueSoon: 0, notDesigned: 0, notReady: 0, deliveryApproaching: 0, missingAssignment: 0 });
});

test("buildOrderWorkloadSummary: PENDING/CONFIRMED near delivery is not-designed AND not-ready", () => {
  const result = buildOrderWorkloadSummary(
    [{ id: "o1", status: "PENDING", delivery_date: "2026-08-26", fulfillment: "PICKUP" }],
    { todayStr: TODAY }
  );
  assert.equal(result.counts.notDesigned, 1);
  assert.equal(result.counts.notReady, 1);
});

test("buildOrderWorkloadSummary: DESIGNING near delivery is not-ready but NOT not-designed — it already started", () => {
  const result = buildOrderWorkloadSummary(
    [{ id: "o1", status: "DESIGNING", delivery_date: "2026-08-26", fulfillment: "PICKUP" }],
    { todayStr: TODAY }
  );
  assert.equal(result.counts.notDesigned, 0);
  assert.equal(result.counts.notReady, 1);
});

test("buildOrderWorkloadSummary: READY status far from delivery is neither not-designed nor not-ready", () => {
  const result = buildOrderWorkloadSummary(
    [{ id: "o1", status: "READY", delivery_date: "2026-08-26", fulfillment: "PICKUP" }],
    { todayStr: TODAY }
  );
  assert.equal(result.counts.notDesigned, 0);
  assert.equal(result.counts.notReady, 0);
});

test("buildOrderWorkloadSummary: a READY delivery order due today/overdue for dispatch is delivery-approaching", () => {
  const result = buildOrderWorkloadSummary(
    [{ id: "o1", status: "READY", delivery_date: TODAY, fulfillment: "DELIVERY" }],
    { todayStr: TODAY }
  );
  assert.equal(result.counts.deliveryApproaching, 1);
});

test("buildOrderWorkloadSummary: a READY PICKUP order is never delivery-approaching — that bucket is delivery-fulfillment only", () => {
  const result = buildOrderWorkloadSummary(
    [{ id: "o1", status: "READY", delivery_date: TODAY, fulfillment: "PICKUP" }],
    { todayStr: TODAY }
  );
  assert.equal(result.counts.deliveryApproaching, 0);
});

test("buildOrderWorkloadSummary: a delivery-approaching order with no driver assigned yet is also missing-assignment", () => {
  const result = buildOrderWorkloadSummary(
    [{ id: "o1", status: "READY", delivery_date: TODAY, fulfillment: "DELIVERY", driver: "" }],
    { todayStr: TODAY }
  );
  assert.equal(result.counts.missingAssignment, 1);
  assert.equal(result.missingAssignment[0].needs_driver, true);
  assert.equal(result.missingAssignment[0].needs_designer, false);
});

test("buildOrderWorkloadSummary: an assigned driver clears the missing-assignment flag", () => {
  const result = buildOrderWorkloadSummary(
    [{ id: "o1", status: "READY", delivery_date: TODAY, fulfillment: "DELIVERY", driver: "Sam" }],
    { todayStr: TODAY }
  );
  assert.equal(result.counts.missingAssignment, 0);
});

test("buildOrderWorkloadSummary: a near-delivery order with no designer assigned yet is missing-assignment", () => {
  const result = buildOrderWorkloadSummary(
    [{ id: "o1", status: "CONFIRMED", delivery_date: "2026-08-26", fulfillment: "PICKUP", designer: "" }],
    { todayStr: TODAY }
  );
  assert.equal(result.counts.missingAssignment, 1);
  assert.equal(result.missingAssignment[0].needs_designer, true);
});

test("buildOrderWorkloadSummary: an order with no delivery_date is never counted in any date-based bucket", () => {
  const result = buildOrderWorkloadSummary([{ id: "o1", status: "PENDING", delivery_date: null, fulfillment: "PICKUP" }], { todayStr: TODAY });
  assert.deepEqual(result.counts, { overdue: 0, dueSoon: 0, notDesigned: 0, notReady: 0, deliveryApproaching: 0, missingAssignment: 0 });
});

test("buildOrderWorkloadSummary: never throws on malformed/missing fields", () => {
  assert.doesNotThrow(() => buildOrderWorkloadSummary([{}, null, undefined, { status: null }], { todayStr: TODAY }));
  assert.doesNotThrow(() => buildOrderWorkloadSummary(undefined, { todayStr: TODAY }));
});

test("buildWorkloadSummaryText: an honestly empty backlog says so, never invents urgency", () => {
  assert.equal(buildWorkloadSummaryText({ overdue: 0, dueSoon: 0, notDesigned: 0, missingAssignment: 0 }), "No open orders are behind right now.");
});

test("buildWorkloadSummaryText: composes only the real, non-zero buckets", () => {
  const text = buildWorkloadSummaryText({ overdue: 2, dueSoon: 0, notDesigned: 1, missingAssignment: 0 });
  assert.match(text, /2 orders are overdue/);
  assert.match(text, /1 not started yet/);
  assert.doesNotMatch(text, /due in the next/);
});

test("buildWorkloadSummaryText: singular phrasing for exactly one overdue order", () => {
  const text = buildWorkloadSummaryText({ overdue: 1, dueSoon: 0, notDesigned: 0, missingAssignment: 0 });
  assert.match(text, /1 order is overdue/);
});
