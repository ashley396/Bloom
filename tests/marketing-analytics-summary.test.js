import test from "node:test";
import assert from "node:assert/strict";
import { buildMarketingAnalyticsSummary } from "../lib/marketing/analytics-summary.js";

test("counts real items by status without fabricating revenue or ROI", () => {
  const summary = buildMarketingAnalyticsSummary({
    campaigns: [
      { status: "active" },
      { status: "active" },
      { status: "draft" },
      { status: "completed" },
    ],
    promotions: [{ status: "active" }, { status: "ended" }],
    holidayPeaks: [{}, {}, {}],
    subscriberCount: 42,
  });
  assert.equal(summary.campaignsTotal, 4);
  assert.equal(summary.campaignsByStatus.active, 2);
  assert.equal(summary.campaignsByStatus.draft, 1);
  assert.equal(summary.campaignsByStatus.completed, 1);
  assert.equal(summary.promotionsTotal, 2);
  assert.equal(summary.promotionsByStatus.active, 1);
  assert.equal(summary.holidayPeaksTotal, 3);
  assert.equal(summary.subscriberCount, 42);
  // The whole point of this module: never claim attribution exists.
  assert.equal(summary.attributionAvailable, false);
  assert.ok(!("revenue" in summary));
  assert.ok(!("roi" in summary));
  assert.ok(!("bestProduct" in summary));
  assert.ok(!("bestChannel" in summary));
});

test("handles empty input without throwing and reports zero counts", () => {
  const summary = buildMarketingAnalyticsSummary({});
  assert.equal(summary.campaignsTotal, 0);
  assert.equal(summary.promotionsTotal, 0);
  assert.equal(summary.holidayPeaksTotal, 0);
  assert.equal(summary.subscriberCount, 0);
  assert.equal(summary.attributionAvailable, false);
});

test("an unrecognized status is not silently counted under a known bucket", () => {
  const summary = buildMarketingAnalyticsSummary({ campaigns: [{ status: "made_up_status" }] });
  assert.equal(summary.campaignsTotal, 1);
  assert.equal(Object.values(summary.campaignsByStatus).reduce((a, b) => a + b, 0), 0);
});
