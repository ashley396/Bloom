import test from "node:test";
import assert from "node:assert/strict";
import { buildFinanceReport } from "../netlify/functions/finance.js";

/**
 * Money/date audit follow-up: finance.js used to bucket revenue by month
 * using the raw UTC paid_at/created_at timestamp string
 * (String(paid_at).slice(0,7)) instead of the shop's own calendar month.
 * A sale paid late in the evening on the last day of a month, in any US
 * (negative-UTC-offset) timezone, is already the 1st of next month in
 * UTC — that revenue silently landed in the wrong month's bucket and the
 * wrong month's total. Fixed by routing paid_at/created_at through
 * shopDateStr(timezone) before slicing, same as every other "today"/date
 * fix from this audit.
 */

test("a sale paid late on the last day of the month (shop-local) stays in that month, not UTC's next month", () => {
  // 9:30pm Pacific on Aug 31 is 4:30am UTC on Sep 1.
  const orders = [
    { total: 150, payment_status: "PAID", status: "COMPLETED", paid_at: "2026-09-01T04:30:00.000Z" },
  ];
  const report = buildFinanceReport(orders, [], "America/Los_Angeles");
  assert.equal(report.items.length, 1);
  assert.equal(report.items[0].month, "2026-08");
  assert.equal(report.items[0].revenue, 150);
  assert.equal(report.totals.revenue, 150);
});

test("the same instant buckets into September for a shop in an eastward/UTC-matching timezone", () => {
  const orders = [
    { total: 150, payment_status: "PAID", status: "COMPLETED", paid_at: "2026-09-01T04:30:00.000Z" },
  ];
  const report = buildFinanceReport(orders, [], "UTC");
  assert.equal(report.items[0].month, "2026-09");
});

test("falls back to created_at when paid_at is missing, still shop-timezone aware", () => {
  const orders = [
    { total: 80, payment_status: "PAID", status: "PENDING", created_at: "2026-03-01T03:00:00.000Z" },
  ];
  const report = buildFinanceReport(orders, [], "America/New_York");
  // 3:00am UTC on Mar 1 is 10:00pm Eastern on Feb 28.
  assert.equal(report.items[0].month, "2026-02");
});

test("cancelled or unpaid orders are excluded regardless of timezone", () => {
  const orders = [
    { total: 100, payment_status: "PAID", status: "CANCELLED", paid_at: "2026-06-15T12:00:00.000Z" },
    { total: 100, payment_status: "PENDING", status: "COMPLETED", paid_at: "2026-06-15T12:00:00.000Z" },
  ];
  const report = buildFinanceReport(orders, [], "America/Chicago");
  assert.equal(report.items.length, 0);
  assert.equal(report.totals.revenue, 0);
});

test("expense_date (a plain date column) is bucketed as-is, with no timezone conversion needed", () => {
  const expenses = [
    { amount: 42, expense_date: "2026-08-31", category: "Flowers" },
  ];
  const report = buildFinanceReport([], expenses, "America/Los_Angeles");
  assert.equal(report.items[0].month, "2026-08");
  assert.equal(report.items[0].expenses, 42);
  assert.equal(report.categories[0].category, "Flowers");
});

test("missing/invalid shop timezone falls back gracefully instead of throwing", () => {
  const orders = [
    { total: 60, payment_status: "PAID", status: "COMPLETED", paid_at: "2026-08-31T23:00:00.000Z" },
  ];
  assert.doesNotThrow(() => buildFinanceReport(orders, [], undefined));
  assert.doesNotThrow(() => buildFinanceReport(orders, [], "Not/A_Real_Zone"));
});
