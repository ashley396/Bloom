/**
 * Marketing Studio analytics — Section 26 of the build directive.
 *
 * Same honesty discipline as lib/marketing/analytics-summary.js: separate
 * what's REALLY knowable (content funnel, publishing job health, the cost
 * ledger — all derived from Florisyn's own tables) from what depends on a
 * live platform connection (engagement metrics). Until Stage E has a real,
 * approved adapter and Stage G's beta actually publishes something, there
 * is zero real engagement data — engagement.dataAvailable is honestly
 * false rather than showing a chart full of zeros that looks like real
 * "no engagement" instead of "no data collected yet".
 */

const CONTENT_ITEM_STATUSES = Object.freeze(["idea", "generating", "draft", "in_review", "approved", "scheduled", "published", "failed", "archived"]);
const PUBLISHING_JOB_STATUSES = Object.freeze(["queued", "running", "succeeded", "failed", "dead_letter", "canceled"]);

function countByField(rows, field, allowed) {
  const counts = Object.fromEntries(allowed.map((s) => [s, 0]));
  for (const row of rows || []) {
    const value = row?.[field];
    if (value in counts) counts[value] += 1;
  }
  return counts;
}

export function buildContentFunnelSummary(contentItems = []) {
  return { byStatus: countByField(contentItems, "status", CONTENT_ITEM_STATUSES), total: contentItems.length };
}

export function buildPublishingHealthSummary(jobs = []) {
  const byStatus = countByField(jobs, "status", PUBLISHING_JOB_STATUSES);
  const settled = byStatus.succeeded + byStatus.failed + byStatus.dead_letter;
  return {
    byStatus,
    total: jobs.length,
    // null (not 0) when nothing has settled yet — a 0% success rate with
    // zero attempts is a different, misleading claim from "no data yet".
    successRate: settled > 0 ? byStatus.succeeded / settled : null
  };
}

export function buildCostSummary(usageRows = []) {
  let estimatedCents = 0;
  let actualCents = 0;
  for (const row of usageRows) {
    if (row.status === "estimated") estimatedCents += row.estimated_cost_cents || 0;
    if (row.status === "actual") actualCents += row.actual_cost_cents || 0;
  }
  return { estimatedCents, actualCents, hasActualCostData: usageRows.some((r) => r.status === "actual") };
}

/** Real-API-only guardrail applied a second time here (belt-and-suspenders
 * over the DB check constraint on marketing_performance_metrics.source) —
 * a metric row from anywhere other than a real platform API is silently
 * excluded rather than trusted. */
export function buildEngagementSummary(metricRows = []) {
  const real = metricRows.filter((r) => r.source === "platform_api");
  if (real.length === 0) {
    return {
      dataAvailable: false,
      byPlatform: {},
      note: "No real platform metrics collected yet — this fills in once a platform is actually connected (Stage E) and analytics are fetched from that platform's own API."
    };
  }
  const byPlatform = {};
  for (const row of real) {
    const platform = (byPlatform[row.platform] ||= {});
    const metric = (platform[row.metric_name] ||= { count: 0, sum: 0 });
    metric.count += 1;
    metric.sum += Number(row.raw_value) || 0;
  }
  for (const platform of Object.values(byPlatform)) {
    for (const metric of Object.values(platform)) metric.average = metric.count ? metric.sum / metric.count : 0;
  }
  return { dataAvailable: true, byPlatform };
}

export function buildMarketingStudioAnalyticsSummary({ contentItems = [], jobs = [], usageRows = [], metricRows = [] } = {}) {
  return {
    contentFunnel: buildContentFunnelSummary(contentItems),
    publishingHealth: buildPublishingHealthSummary(jobs),
    cost: buildCostSummary(usageRows),
    engagement: buildEngagementSummary(metricRows)
  };
}
