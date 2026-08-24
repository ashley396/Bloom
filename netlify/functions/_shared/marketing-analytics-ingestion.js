/**
 * Priority 6 ("as far as technically possible" pass): real analytics
 * ingestion. Before this pass, marketing-analytics.js/marketing-insights.js
 * could only ever SUMMARIZE whatever rows already sat in
 * marketing_performance_metrics — nothing in the codebase ever tried to
 * actually fetch fresh metrics from a platform. This is that missing
 * ingestion job.
 *
 * Reuses rather than duplicates: the provider interface's own
 * fetchAnalytics(externalPostId) method (marketing-social-providers.js —
 * the SAME registry Stage E's publishing worker already uses for
 * publish()), never a second per-platform analytics client. NOT LIVE
 * today for the identical reason publishing is not live (Priority 5's
 * audit): zero providers are configured. Everything up to that boundary —
 * the ingestion job, metric normalization, tenant scoping, the "don't
 * hammer a live API" refetch window, and reconciliation of repeated
 * snapshots into one current value — is real and tested now.
 *
 * Anti-fabrication guardrails (Section 40 / "no fake metrics"):
 *   - source is ALWAYS 'platform_api' — matches the DB's own CHECK
 *     constraint (marketing_performance_metrics.source), so there is no
 *     code path here that could even attempt to write a modeled/estimated
 *     metric into this table.
 *   - a provider failure (today: always SOCIAL_NOT_LIVE) is recorded only
 *     as a per-item ingestion RESULT (outcome/error), never as a metric
 *     row — a failed fetch produces zero rows, not zeroed-out ones.
 *   - METRIC_NAMES is a closed vocabulary; a provider response key
 *     outside it is silently ignored rather than persisted under an
 *     invented metric name.
 */

import { notLiveSocialProvider } from "./marketing-social-providers.js";

/** The normalized metric vocabulary every platform adapter's
 * fetchAnalytics() response is expected to map onto — one shared shape
 * regardless of what each platform calls its own numbers natively (a real
 * adapter's job is translating ITS field names into these, not the other
 * way around). */
export const METRIC_NAMES = Object.freeze([
  "impressions",
  "reach",
  "views",
  "likes",
  "comments",
  "shares",
  "saves",
  "clicks",
  "watch_time_seconds",
  "completion_rate",
  "follower_delta",
  "engagement_rate"
]);

// A metric that's already a ratio/rate — normalized_value mirrors
// raw_value for these; everything else (raw counts) has no separate
// "normalized" form yet, so normalized_value stays null rather than a
// guessed transformation.
const RATE_METRICS = new Set(["completion_rate", "engagement_rate"]);

// Courteous default refetch cadence — real per-platform rate limits would
// refine this once a live adapter exists; until then this is what keeps a
// repeated ingestion tick from hammering a (future) live API for metrics
// that were only just fetched.
export const MIN_REFETCH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function isFreshEnough(lastFetchedAt, now) {
  if (!lastFetchedAt) return false;
  const last = new Date(lastFetchedAt).getTime();
  if (Number.isNaN(last)) return false;
  return now.getTime() - last < MIN_REFETCH_INTERVAL_MS;
}

/**
 * Turns one provider fetchAnalytics() response into real
 * marketing_performance_metrics row(s) — never invents a metric name
 * outside METRIC_NAMES, never accepts a non-finite value, never sets
 * source to anything but 'platform_api'.
 */
export function normalizeAnalyticsResponse({ shopId, platformVariantId, platform, raw, fetchedAt = new Date() } = {}) {
  if (!raw || typeof raw !== "object") return [];
  const rows = [];
  for (const metricName of METRIC_NAMES) {
    const value = raw[metricName];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    rows.push({
      shop_id: shopId,
      platform_variant_id: platformVariantId,
      platform,
      metric_name: metricName,
      raw_value: value,
      normalized_value: RATE_METRICS.has(metricName) ? value : null,
      source: "platform_api",
      fetched_at: fetchedAt.toISOString()
    });
  }
  return rows;
}

/**
 * Reconciliation: marketing_performance_metrics is an append-only time
 * series — a variant that's been ingested 5 times has 5 rows per metric,
 * each a real snapshot, not a duplicate to discard. But "current stats"
 * (what buildEngagementSummary/list_insights/evaluate_ab_experiment show)
 * must reflect the LATEST snapshot per (platform_variant_id, metric_name)
 * — averaging every historical snapshot together would silently skew the
 * number by how often ingestion happened to run, not by genuine per-post
 * variance. This is that reconciliation step, applied once, shared by
 * every reader rather than three copies of the same dedup logic.
 */
export function reconcileLatestMetricSnapshots(metricRows = []) {
  const latestByKey = new Map();
  for (const row of metricRows) {
    if (row.source !== "platform_api") continue; // same real-API-only guardrail buildEngagementSummary already applies
    if (!row.platform_variant_id || !row.metric_name || !row.fetched_at) continue; // can't reconcile what we can't key/order
    const key = `${row.platform_variant_id}::${row.metric_name}`;
    const existing = latestByKey.get(key);
    if (!existing || new Date(row.fetched_at).getTime() > new Date(existing.fetched_at).getTime()) {
      latestByKey.set(key, row);
    }
  }
  return [...latestByKey.values()];
}

/**
 * One variant's ingestion attempt: skip if recently fetched, otherwise
 * call the provider and persist real rows (or record why nothing was
 * written). Never throws — every outcome is a returned result so one
 * variant's failure can never stop the batch.
 */
async function ingestOneVariant(client, variant, now) {
  const lastFetchResult = await client
    .from("marketing_performance_metrics")
    .select("fetched_at")
    .eq("platform_variant_id", variant.id)
    .eq("shop_id", variant.shop_id)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastFetchResult.error) {
    return { platform_variant_id: variant.id, platform: variant.platform, outcome: "error", error: lastFetchResult.error.message };
  }
  if (isFreshEnough(lastFetchResult.data?.fetched_at, now)) {
    return { platform_variant_id: variant.id, platform: variant.platform, outcome: "skipped_fresh" };
  }

  const provider = notLiveSocialProvider(variant.platform);
  let raw;
  try {
    raw = await provider.fetchAnalytics(variant.external_post_id);
  } catch (error) {
    return {
      platform_variant_id: variant.id,
      platform: variant.platform,
      outcome: "provider_error",
      error: String(error?.message || error).slice(0, 300),
      code: error?.code || null
    };
  }

  const rows = normalizeAnalyticsResponse({ shopId: variant.shop_id, platformVariantId: variant.id, platform: variant.platform, raw, fetchedAt: now });
  if (!rows.length) {
    return { platform_variant_id: variant.id, platform: variant.platform, outcome: "no_metrics_returned" };
  }
  const inserted = await client.from("marketing_performance_metrics").insert(rows).select("id");
  if (inserted.error) {
    return { platform_variant_id: variant.id, platform: variant.platform, outcome: "db_error", error: inserted.error.message };
  }
  return { platform_variant_id: variant.id, platform: variant.platform, outcome: "ingested", metricsWritten: inserted.data?.length || 0 };
}

/**
 * Finds published, externally-confirmed variants (real external_post_id —
 * never attempts to fetch analytics for something that was never actually
 * published) for a shop (or every shop, mirroring the publishing worker's
 * own shop-scoped/global split for the admin action vs. a future
 * scheduled job) and attempts to refresh their metrics.
 */
export async function runAnalyticsIngestion(client, { shopId = null, limit = 25, now = new Date() } = {}) {
  let query = client
    .from("marketing_platform_variants")
    .select("id,shop_id,platform,external_post_id,status")
    .eq("status", "published")
    .order("published_at", { ascending: true })
    .limit(Math.min(200, Math.max(1, Number(limit) || 25)));
  if (shopId) query = query.eq("shop_id", shopId);
  const variantsResult = await query;
  if (variantsResult.error) throw variantsResult.error;
  // external_post_id filtered in JS rather than a second .not(...) query
  // clause — keeps this compatible with the project's existing thin
  // Supabase-query test double without widening it for one caller.
  const variants = (variantsResult.data || []).filter((v) => v.external_post_id);

  const results = [];
  for (const variant of variants) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await ingestOneVariant(client, variant, now));
  }
  return results;
}
