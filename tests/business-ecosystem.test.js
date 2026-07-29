import test from "node:test";
import assert from "node:assert/strict";
import {
  nextDeliveryDate,
  validateFlowerSubscription,
  computeLoyaltyEarn,
  validatePointsRedeem,
  canTransitionPO,
  buildFinanceCenter,
  buildLilyBusinessCoach,
  membershipDiscountPercent,
  REPORT_CATALOG
} from "../netlify/functions/_shared/business-ecosystem.js";

test("flower subscription schedule advances weekly", () => {
  const n = nextDeliveryDate("weekly", new Date("2026-01-01T12:00:00"));
  assert.equal(n, "2026-01-08");
});

test("validate flower subscription requires customer and amount", () => {
  assert.equal(validateFlowerSubscription({ schedule: "weekly", amount: 50, customer_name: "A" }).valid, true);
  assert.equal(validateFlowerSubscription({ schedule: "bad" }).valid, false);
});

test("loyalty earn applies tier multiplier", () => {
  assert.equal(computeLoyaltyEarn(100, "gold"), 125);
});

test("points redeem validation", () => {
  assert.equal(validatePointsRedeem(100, 50).valid, true);
  assert.equal(validatePointsRedeem(10, 50).valid, false);
});

test("PO status transitions forward only", () => {
  assert.equal(canTransitionPO("draft", "approved"), true);
  assert.equal(canTransitionPO("closed", "draft"), false);
});

test("finance center builds P and L", () => {
  const f = buildFinanceCenter({ revenue: 1000, expenses: 400 });
  assert.equal(f.profit_and_loss.profit, 600);
});

test("membership discount percent", () => {
  assert.equal(membershipDiscountPercent("bloom_platinum"), 15);
});

test("report catalog includes financial and subscription reports", () => {
  const ids = REPORT_CATALOG.map((r) => r.id);
  assert.ok(ids.includes("financial"));
  assert.ok(ids.includes("subscriptions"));
});

test("lily business coach returns suggestions", () => {
  const s = buildLilyBusinessCoach({ low_stock_count: 3, subscription_count: 0, unpaid_total: 200 });
  assert.ok(s.length >= 2);
  assert.ok(s.some((x) => x.id === "reorder"));
});

import { detectIntent } from "../netlify/functions/_shared/lily-ai-engine.js";

test("lily detects business coach intent", () => {
  const i = detectIntent("Help me improve margins this month");
  assert.equal(i.domain, "coach");
});
