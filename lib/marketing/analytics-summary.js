/**
 * Marketing Command Center — honest analytics summary.
 *
 * Deliberately limited to what's actually knowable today: real counts by
 * status across campaigns, promotions, and holiday peaks, plus the real
 * marketing-subscriber count. There is no order-to-campaign attribution
 * link anywhere in the schema (orders carries no campaign_id), so this
 * never computes or displays revenue, ROI, conversion rate, or "best
 * product/channel" — those would all be fabricated. attributionAvailable
 * is always false today; it exists so the UI (and this function's own
 * test coverage) states that honestly instead of a caller silently
 * assuming numbers exist.
 */

function countByStatus(items, statuses) {
  const out = {};
  for (const s of statuses) out[s] = 0;
  for (const item of items || []) {
    const s = item?.status;
    if (s in out) out[s] += 1;
  }
  return out;
}

const CAMPAIGN_STATUSES = ["draft", "ready", "scheduled", "active", "completed", "paused"];
const PROMOTION_STATUSES = ["draft", "active", "ended"];

export function buildMarketingAnalyticsSummary({ campaigns = [], promotions = [], holidayPeaks = [], subscriberCount = 0 } = {}) {
  return {
    campaignsByStatus: countByStatus(campaigns, CAMPAIGN_STATUSES),
    campaignsTotal: campaigns.length,
    promotionsByStatus: countByStatus(promotions, PROMOTION_STATUSES),
    promotionsTotal: promotions.length,
    holidayPeaksTotal: (holidayPeaks || []).length,
    subscriberCount,
    // Always false today — see file header. Kept explicit rather than
    // omitted so nothing downstream has to assume it's true.
    attributionAvailable: false,
  };
}
