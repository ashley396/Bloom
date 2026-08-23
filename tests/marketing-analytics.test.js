import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContentFunnelSummary,
  buildPublishingHealthSummary,
  buildCostSummary,
  buildEngagementSummary,
  buildMarketingStudioAnalyticsSummary
} from "../netlify/functions/_shared/marketing-analytics.js";

test("buildContentFunnelSummary counts every real content status, zero for statuses with no items", () => {
  const summary = buildContentFunnelSummary([{ status: "idea" }, { status: "idea" }, { status: "draft" }, { status: "published" }]);
  assert.equal(summary.total, 4);
  assert.equal(summary.byStatus.idea, 2);
  assert.equal(summary.byStatus.draft, 1);
  assert.equal(summary.byStatus.published, 1);
  assert.equal(summary.byStatus.archived, 0);
});

test("buildContentFunnelSummary on an empty list never throws, all counts zero", () => {
  const summary = buildContentFunnelSummary([]);
  assert.equal(summary.total, 0);
  assert.ok(Object.values(summary.byStatus).every((n) => n === 0));
});

test("buildPublishingHealthSummary: successRate is null with zero settled jobs — never a misleading 0%", () => {
  const summary = buildPublishingHealthSummary([{ status: "queued" }]);
  assert.equal(summary.successRate, null);
});

test("buildPublishingHealthSummary: successRate is computed only over settled (succeeded+failed+dead_letter) jobs", () => {
  const summary = buildPublishingHealthSummary([
    { status: "succeeded" }, { status: "succeeded" }, { status: "failed" }, { status: "queued" }, { status: "running" }
  ]);
  assert.equal(summary.total, 5);
  assert.equal(summary.successRate, 2 / 3);
});

test("buildCostSummary: separates estimated from actual, and hasActualCostData is honest about which exist", () => {
  const summary = buildCostSummary([
    { status: "estimated", estimated_cost_cents: 4 },
    { status: "estimated", estimated_cost_cents: 8 }
  ]);
  assert.equal(summary.estimatedCents, 12);
  assert.equal(summary.actualCents, 0);
  assert.equal(summary.hasActualCostData, false);
});

test("buildCostSummary: real actual-cost rows are summed and flagged available", () => {
  const summary = buildCostSummary([{ status: "actual", actual_cost_cents: 50 }, { status: "actual", actual_cost_cents: 25 }]);
  assert.equal(summary.actualCents, 75);
  assert.equal(summary.hasActualCostData, true);
});

test("buildEngagementSummary: with zero metric rows, dataAvailable is false — never fabricates zero-engagement charts", () => {
  const summary = buildEngagementSummary([]);
  assert.equal(summary.dataAvailable, false);
  assert.deepEqual(summary.byPlatform, {});
});

test("buildEngagementSummary: excludes any row whose source isn't 'platform_api', even if it slipped through", () => {
  const summary = buildEngagementSummary([{ platform: "facebook", metric_name: "likes", raw_value: 100, source: "estimated" }]);
  assert.equal(summary.dataAvailable, false, "a non-platform_api row must never count as real data");
});

test("buildEngagementSummary: real rows are averaged per platform per metric", () => {
  const summary = buildEngagementSummary([
    { platform: "facebook", metric_name: "likes", raw_value: 10, source: "platform_api" },
    { platform: "facebook", metric_name: "likes", raw_value: 20, source: "platform_api" },
    { platform: "instagram", metric_name: "likes", raw_value: 100, source: "platform_api" }
  ]);
  assert.equal(summary.dataAvailable, true);
  assert.equal(summary.byPlatform.facebook.likes.count, 2);
  assert.equal(summary.byPlatform.facebook.likes.average, 15);
  assert.equal(summary.byPlatform.instagram.likes.average, 100);
});

test("buildMarketingStudioAnalyticsSummary composes all four sub-summaries and degrades gracefully with no data at all", () => {
  const summary = buildMarketingStudioAnalyticsSummary({});
  assert.equal(summary.contentFunnel.total, 0);
  assert.equal(summary.publishingHealth.total, 0);
  assert.equal(summary.cost.estimatedCents, 0);
  assert.equal(summary.engagement.dataAvailable, false);
});
