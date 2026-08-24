import test from "node:test";
import assert from "node:assert/strict";
import {
  METRIC_NAMES,
  normalizeAnalyticsResponse,
  reconcileLatestMetricSnapshots,
  runAnalyticsIngestion
} from "../netlify/functions/_shared/marketing-analytics-ingestion.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Priority 6 ("as far as technically possible" pass): real analytics
// ingestion. "No fake metrics" is the load-bearing contract throughout —
// these tests focus on: never writing a metric outside the closed
// vocabulary, never writing source anything but 'platform_api', never
// writing a row when the provider call fails, and the reconciliation step
// that keeps repeated ingestion runs from silently skewing "current"
// numbers.

test("normalizeAnalyticsResponse: only known metric names with finite numeric values become rows; everything else is silently dropped, not coerced", () => {
  const rows = normalizeAnalyticsResponse({
    shopId: "shop-1",
    platformVariantId: "variant-1",
    platform: "facebook",
    raw: {
      likes: 42,
      comments: "not a number", // must be dropped, not coerced to 0/NaN
      shares: Infinity, // non-finite — must be dropped
      made_up_metric_name: 999, // outside METRIC_NAMES — must be dropped
      engagement_rate: 0.083
    },
    fetchedAt: new Date("2026-08-24T00:00:00.000Z")
  });
  const names = rows.map((r) => r.metric_name).sort();
  assert.deepEqual(names, ["engagement_rate", "likes"]);
  assert.equal(rows.every((r) => r.source === "platform_api"), true, "source must always be platform_api — the only value the DB itself allows");
  assert.equal(rows.every((r) => r.shop_id === "shop-1" && r.platform_variant_id === "variant-1" && r.platform === "facebook"), true);
  const engagement = rows.find((r) => r.metric_name === "engagement_rate");
  assert.equal(engagement.normalized_value, 0.083, "a rate metric's normalized_value mirrors raw_value");
  const likes = rows.find((r) => r.metric_name === "likes");
  assert.equal(likes.normalized_value, null, "a raw count has no normalized form yet — null, not a guess");
});

test("normalizeAnalyticsResponse: a non-object/null response produces zero rows, never a placeholder metric", () => {
  assert.deepEqual(normalizeAnalyticsResponse({ shopId: "s", platformVariantId: "v", platform: "facebook", raw: null }), []);
  assert.deepEqual(normalizeAnalyticsResponse({ shopId: "s", platformVariantId: "v", platform: "facebook", raw: "garbage" }), []);
});

test("reconcileLatestMetricSnapshots: keeps only the newest row per (platform_variant_id, metric_name) — repeated ingestion never dilutes the current value", () => {
  const rows = [
    { platform_variant_id: "v-1", metric_name: "likes", raw_value: 10, source: "platform_api", fetched_at: "2026-08-01T00:00:00.000Z", platform: "facebook" },
    { platform_variant_id: "v-1", metric_name: "likes", raw_value: 50, source: "platform_api", fetched_at: "2026-08-20T00:00:00.000Z", platform: "facebook" }, // latest
    { platform_variant_id: "v-2", metric_name: "likes", raw_value: 5, source: "platform_api", fetched_at: "2026-08-15T00:00:00.000Z", platform: "facebook" }
  ];
  const reconciled = reconcileLatestMetricSnapshots(rows);
  assert.equal(reconciled.length, 2);
  const v1 = reconciled.find((r) => r.platform_variant_id === "v-1");
  assert.equal(v1.raw_value, 50, "the OLDER snapshot must not survive alongside the newer one for the same variant+metric");
});

test("reconcileLatestMetricSnapshots: a non-platform_api row is dropped, same guardrail buildEngagementSummary already applies", () => {
  const rows = [{ platform_variant_id: "v-1", metric_name: "likes", raw_value: 999, source: "manual_estimate", fetched_at: "2026-08-20T00:00:00.000Z" }];
  assert.deepEqual(reconcileLatestMetricSnapshots(rows), []);
});

test("reconcileLatestMetricSnapshots: a row missing platform_variant_id/metric_name/fetched_at is dropped rather than crashing the comparison", () => {
  const rows = [
    { metric_name: "likes", raw_value: 1, source: "platform_api", fetched_at: "2026-08-20T00:00:00.000Z" }, // no platform_variant_id
    { platform_variant_id: "v-1", raw_value: 1, source: "platform_api", fetched_at: "2026-08-20T00:00:00.000Z" } // no metric_name
  ];
  assert.deepEqual(reconcileLatestMetricSnapshots(rows), []);
});

test("METRIC_NAMES: the closed vocabulary covers every metric the priority spec names", () => {
  for (const name of ["impressions", "reach", "views", "likes", "comments", "shares", "saves", "clicks", "watch_time_seconds", "completion_rate", "follower_delta", "engagement_rate"]) {
    assert.ok(METRIC_NAMES.includes(name), `missing required metric: ${name}`);
  }
});

test("runAnalyticsIngestion: a published variant with no prior metrics attempts a real fetch, which fails honestly (not-live) and writes ZERO metric rows", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ id: "variant-1", shop_id: "shop-1", platform: "facebook", external_post_id: "ext-123", status: "published" }], error: null }, // variants select
    { data: null, error: null } // last-fetch lookup — never fetched before
  ]);
  const results = await runAnalyticsIngestion(client, { shopId: "shop-1" });
  assert.equal(results.length, 1);
  assert.equal(results[0].outcome, "provider_error");
  assert.equal(results[0].code, "social_provider_not_live");
  const insertCall = client.calls.find((c) => c.table === "marketing_performance_metrics" && c.ops.some((op) => op[0] === "insert"));
  assert.equal(insertCall, undefined, "a failed provider call must never reach an insert — zero fabricated rows");
});

test("runAnalyticsIngestion: a variant with no external_post_id at all is skipped before any fetch is attempted — it was never really published", async () => {
  const client = createFakeSupabaseClient([{ data: [{ id: "variant-1", shop_id: "shop-1", platform: "facebook", external_post_id: null, status: "published" }], error: null }]);
  const results = await runAnalyticsIngestion(client, { shopId: "shop-1" });
  assert.deepEqual(results, []);
});

test("runAnalyticsIngestion: a variant fetched within the last hour is skipped as fresh — never hammers the (future) live API on every tick", async () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  const client = createFakeSupabaseClient([
    { data: [{ id: "variant-1", shop_id: "shop-1", platform: "facebook", external_post_id: "ext-1", status: "published" }], error: null },
    { data: { fetched_at: "2026-08-24T11:30:00.000Z" }, error: null } // fetched 30 min ago
  ]);
  const results = await runAnalyticsIngestion(client, { shopId: "shop-1", now });
  assert.equal(results[0].outcome, "skipped_fresh");
});

test("runAnalyticsIngestion: a variant last fetched over an hour ago is treated as stale and a real refetch is attempted", async () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  const client = createFakeSupabaseClient([
    { data: [{ id: "variant-1", shop_id: "shop-1", platform: "facebook", external_post_id: "ext-1", status: "published" }], error: null },
    { data: { fetched_at: "2026-08-24T09:00:00.000Z" }, error: null } // 3 hours ago
  ]);
  const results = await runAnalyticsIngestion(client, { shopId: "shop-1", now });
  assert.equal(results[0].outcome, "provider_error", "stale metrics must trigger a real refetch attempt, not another skip");
});

test("runAnalyticsIngestion: scopes the variant lookup to the requesting shop, and omitting shopId claims across every shop (mirrors the publishing worker's own split)", async () => {
  const scoped = createFakeSupabaseClient([{ data: [], error: null }]);
  await runAnalyticsIngestion(scoped, { shopId: "shop-1" });
  const call = scoped.calls[0];
  assert.ok(call.ops.some((op) => op[0] === "eq" && op[1][0] === "shop_id" && op[1][1] === "shop-1"));

  const global = createFakeSupabaseClient([{ data: [], error: null }]);
  await runAnalyticsIngestion(global, { shopId: null });
  const globalCall = global.calls[0];
  assert.ok(!globalCall.ops.some((op) => op[0] === "eq" && op[1][0] === "shop_id"), "a global (cron-style) ingestion run must not scope by shop_id");
});

test("runAnalyticsIngestion: only 'published' variants are ever considered — a draft/scheduled/failed variant is never queried for analytics", async () => {
  const client = createFakeSupabaseClient([{ data: [], error: null }]);
  await runAnalyticsIngestion(client, { shopId: "shop-1" });
  const call = client.calls[0];
  assert.ok(call.ops.some((op) => op[0] === "eq" && op[1][0] === "status" && op[1][1] === "published"));
});

// Priority 5 completion pass: a configured, real-adapter platform must
// actually decrypt its stored token and call the real fetchAnalytics
// endpoint — reusing the exact same registry/token pattern as the
// publishing worker, never a second parallel implementation.
test("runAnalyticsIngestion: a configured platform (facebook) decrypts the real stored token and calls the REAL adapter's fetchAnalytics against a mocked Graph API — real metrics get written", async () => {
  const { encryptSocialToken } = await import("../netlify/functions/_shared/marketing-social-oauth.js");
  const savedEnv = { ...process.env };
  process.env.FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID = "fb-id";
  process.env.FLORISYN_SOCIAL_FACEBOOK_CLIENT_SECRET = "fb-secret";
  process.env.FLORISYN_MARKETING_TOKEN_KEY = "a-real-key";
  const cipher = encryptSocialToken("real-page-token", process.env);

  const client = createFakeSupabaseClient([
    { data: [{ id: "variant-1", shop_id: "shop-1", platform: "facebook", external_post_id: "page-1_post-1", status: "published" }], error: null }, // variants
    { data: null, error: null }, // last-fetch lookup
    { data: { id: "conn-1", external_account_id: "page-1" }, error: null }, // connection
    { data: { access_token_ciphertext: cipher }, error: null } // secrets
  ]);

  let capturedUrl;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    capturedUrl = new URL(String(url));
    return { ok: true, json: async () => ({ likes: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } } }) };
  };
  let results;
  try {
    results = await runAnalyticsIngestion(client, { shopId: "shop-1" });
  } finally {
    globalThis.fetch = originalFetch;
    process.env = savedEnv;
  }

  assert.equal(results[0].outcome, "ingested");
  assert.match(capturedUrl.pathname, /\/page-1_post-1$/);
  assert.equal(capturedUrl.searchParams.get("access_token"), "real-page-token", "must use the real decrypted token, not a placeholder");
});

test("runAnalyticsIngestion: a configured platform with no real connection yet reports 'no_connection', never crashes or fetches with a fake token", async () => {
  const savedEnv = { ...process.env };
  process.env.FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID = "fb-id";
  process.env.FLORISYN_SOCIAL_FACEBOOK_CLIENT_SECRET = "fb-secret";
  const client = createFakeSupabaseClient([
    { data: [{ id: "variant-1", shop_id: "shop-1", platform: "facebook", external_post_id: "post-1", status: "published" }], error: null },
    { data: null, error: null }, // last-fetch lookup
    { data: null, error: null } // connection lookup — none found
  ]);
  let results;
  try {
    results = await runAnalyticsIngestion(client, { shopId: "shop-1" });
  } finally {
    process.env = savedEnv;
  }
  assert.equal(results[0].outcome, "no_connection");
});
