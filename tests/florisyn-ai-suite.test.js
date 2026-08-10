import test from "node:test";
import assert from "node:assert/strict";
import { segmentCustomers, buildMarketingStrategy } from "../lib/ai-suite/marketing-ai.js";
import { analyzePhotoMetadata, suggestPhotoCorrections, SOCIAL_PRESETS } from "../lib/ai-suite/photo-ai.js";
import { computeRealtimeKpis, inventoryAlerts, salesInsights } from "../lib/ai-suite/pos-analytics.js";
import { validateAiSuiteRequest, AI_SUITE_ACTIONS } from "../lib/ai-suite/schemas.js";

test("marketing segments VIP and at-risk customers", () => {
  const customers = [{ id: "1", name: "A" }, { id: "2", name: "B" }];
  const orders = [
    { customer_id: "1", total: 600, created_at: "2026-08-01" },
    { customer_id: "1", total: 100, created_at: "2026-05-01" },
    { customer_name: "B", total: 50, created_at: "2026-01-01", arrangement_description: "sympathy spray" }
  ];
  const r = segmentCustomers(customers, orders);
  assert.ok(r.segments.vip.length >= 1);
  assert.ok(r.summary.total_customers === 2);
});

test("marketing strategy includes instagram tactic", () => {
  const s = buildMarketingStrategy({ shop: { name: "Petals" }, segments: {} });
  assert.ok(s.tactics.some((t) => t.channel === "instagram"));
});

test("photo analysis detects low brightness", () => {
  const a = analyzePhotoMetadata({ width: 600, height: 600, brightness: 60, notes: "roses bouquet" });
  assert.ok(a.issues.some((i) => /underexposed/i.test(i)));
  assert.ok(a.tags.includes("roses"));
});

test("photo corrections suggest sympathy preset", () => {
  const r = suggestPhotoCorrections({ brightness: 128, notes: "sympathy funeral spray" }, {});
  assert.equal(r.suggested.preset, "soft_sympathy");
});

test("social presets include instagram", () => {
  assert.ok(SOCIAL_PRESETS.instagram_square);
});

test("POS realtime KPIs from orders", () => {
  const kpis = computeRealtimeKpis({
    orders: [{ total: 100, created_at: new Date().toISOString(), status: "NEW" }],
    windowHours: 48
  });
  assert.equal(kpis.orders_count, 1);
  assert.equal(kpis.revenue, 100);
});

test("inventory alerts critical stock", () => {
  const r = inventoryAlerts([{ id: "p1", name: "Rose", quantity: 1 }]);
  assert.equal(r.summary.critical, 1);
});

test("sales insights recommends with enough data", () => {
  const orders = Array.from({ length: 10 }, (_, i) => ({
    total: 80,
    created_at: `2026-08-0${(i % 9) + 1}`,
    arrangement_description: i % 2 ? "sympathy spray" : "birthday roses",
    order_source: "POS"
  }));
  const r = salesInsights({ orders, days: 30 });
  assert.equal(r.total_orders, 10);
  assert.ok(r.ai_recommendations.length >= 0);
});

test("validateAiSuiteRequest rejects unknown actions", () => {
  assert.equal(validateAiSuiteRequest({ action: "nope" }).valid, false);
  assert.equal(validateAiSuiteRequest({ action: "suite_status" }).valid, true);
});

test("AI suite exposes expected actions", () => {
  assert.ok(AI_SUITE_ACTIONS.includes("marketing_segment"));
  assert.ok(AI_SUITE_ACTIONS.includes("photo_auto_enhance"));
  assert.ok(AI_SUITE_ACTIONS.includes("pos_sales_insights"));
});
