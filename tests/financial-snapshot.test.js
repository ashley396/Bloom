import test from "node:test";
import assert from "node:assert/strict";
import { buildFinancialSnapshot, loadFinancialSnapshot } from "../netlify/functions/_shared/financial-snapshot.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Phase 8 ("Sales/Business intelligence — never fabricate financial
// figures") of the Lily Connected Intelligence pass — real sales/unpaid
// totals computed from real payment/order rows, never guessed or invented
// by a model.

const TODAY = "2026-08-25";

test("buildFinancialSnapshot: sums today's real successful payments only", () => {
  const payments = [
    { amount: 50, received_at: `${TODAY}T14:00:00Z`, refunded_amount: 0 },
    { amount: 30, received_at: `${TODAY}T18:00:00Z`, refunded_amount: 0 },
    { amount: 99, received_at: "2026-08-24T14:00:00Z", refunded_amount: 0 }
  ];
  const result = buildFinancialSnapshot(payments, [], { todayStr: TODAY });
  assert.equal(result.todaySales, 80);
});

test("buildFinancialSnapshot: a refund reduces the net amount counted, never the gross", () => {
  const payments = [{ amount: 100, received_at: `${TODAY}T14:00:00Z`, refunded_amount: 40 }];
  const result = buildFinancialSnapshot(payments, [], { todayStr: TODAY });
  assert.equal(result.todaySales, 60);
});

test("buildFinancialSnapshot: weekSales sums exactly the trailing 7 shop-local days, nothing older", () => {
  const payments = [
    { amount: 10, received_at: `${TODAY}T12:00:00Z`, refunded_amount: 0 }, // day 0
    { amount: 10, received_at: "2026-08-19T12:00:00Z", refunded_amount: 0 }, // day -6 (in window)
    { amount: 999, received_at: "2026-08-18T12:00:00Z", refunded_amount: 0 } // day -7 (out of window)
  ];
  const result = buildFinancialSnapshot(payments, [], { todayStr: TODAY });
  assert.equal(result.weekSales, 20);
});

test("buildFinancialSnapshot: unpaidTotal is the real outstanding balance, never the full order total when partially paid", () => {
  const unpaidOrders = [
    { total: 100, amount_paid: 40 },
    { total: 50, amount_paid: 0 }
  ];
  const result = buildFinancialSnapshot([], unpaidOrders, { todayStr: TODAY });
  assert.equal(result.unpaidTotal, 110);
});

test("buildFinancialSnapshot: never goes negative on an overpaid/refund-adjusted order", () => {
  const unpaidOrders = [{ total: 50, amount_paid: 80 }];
  const result = buildFinancialSnapshot([], unpaidOrders, { todayStr: TODAY });
  assert.equal(result.unpaidTotal, 0);
});

test("buildFinancialSnapshot: an honestly empty shop reports real zeros, never fabricated activity", () => {
  const result = buildFinancialSnapshot([], [], { todayStr: TODAY });
  assert.deepEqual(result, { asOfDate: TODAY, todaySales: 0, weekSales: 0, unpaidTotal: 0 });
});

test("loadFinancialSnapshot: loads real, shop-scoped, bounded rows and computes the real snapshot", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ amount: 25, received_at: `${TODAY}T10:00:00Z`, refunded_amount: 0 }], error: null }, // payments
    { data: [{ total: 20, amount_paid: 0 }], error: null } // unpaid orders
  ]);
  const result = await loadFinancialSnapshot(client, "shop-1", { todayStr: TODAY });
  assert.equal(result.available, true);
  assert.equal(result.todaySales, 25);
  assert.equal(result.unpaidTotal, 20);

  const paymentsCall = client.calls.find((c) => c.table === "payments");
  assert.ok(paymentsCall.ops.some((op) => op[0] === "eq" && op[1][0] === "shop_id" && op[1][1] === "shop-1"));
  assert.ok(paymentsCall.ops.some((op) => op[0] === "eq" && op[1][0] === "status" && op[1][1] === "SUCCEEDED"));
});

test("loadFinancialSnapshot: a real DB error degrades to an honestly unavailable result, never a zeroed-out fake one", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: new Error("connection reset") },
    { data: [], error: null }
  ]);
  const result = await loadFinancialSnapshot(client, "shop-1", { todayStr: TODAY });
  assert.equal(result.available, false);
  assert.equal(result.todaySales, null);
  assert.equal(result.weekSales, null);
  assert.equal(result.unpaidTotal, null);
});
