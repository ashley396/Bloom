import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Launch-blocker engineering pass, Blocker 2 (migration + RLS/tenant-
// isolation review). marketing-studio.js's handlers run on the SERVICE-
// ROLE client (platformAdmin()'s default buildServerClient), which
// bypasses RLS entirely — so for every query these handlers issue, tenant
// isolation is enforced ONLY by an explicit .eq("shop_id", shopId) filter
// in the query itself, never by the database's RLS policies (those are
// real defense-in-depth for a direct/browser-side query path, but are not
// what protects this admin API). These tests assert that filter is
// actually present on the two query paths this review found missing it.

function superAdminRow() {
  return { data: { user_id: "u1", role: "super_admin", active: true }, error: null };
}

function baseDeps(client) {
  return {
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client
  };
}

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
  process.env.FLORISYN_FLAG_MARKETING_STUDIO = "true";
});
test.after(() => {
  process.env = { ...savedEnv };
});

function event(action, body, { method = "POST", qs = {} } = {}) {
  return {
    httpMethod: method,
    queryStringParameters: { action, ...qs },
    headers: {},
    body: JSON.stringify({ action, ...body })
  };
}

test("evaluate_ab_experiment: a variant lookup keyed off caller-supplied content_item_id is still scoped to the requesting shop (forged content_item_id cannot pull another shop's variants)", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    {
      // The experiment itself is real and belongs to shop-1, but its
      // variants[].content_item_id values are exactly what a caller wrote
      // at create_ab_experiment time — never independently verified to
      // belong to shop-1. A forged/foreign id here must not leak data.
      data: {
        id: "exp-1",
        variants: [
          { label: "A", content_item_id: "shop1-item" },
          { label: "B", content_item_id: "OTHER-SHOP-item" }
        ],
        metric: "impressions",
        status: "running",
        started_at: new Date().toISOString()
      },
      error: null
    },
    { data: [], error: null } // marketing_platform_variants select
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  await handler(event("evaluate_ab_experiment", { shop_id: "shop-1", experiment_id: "exp-1" }));

  const variantsCall = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "select"));
  assert.ok(variantsCall, "expected a marketing_platform_variants select");
  const shopEq = variantsCall.ops.find((op) => op[0] === "eq" && op[1][0] === "shop_id");
  assert.ok(shopEq, "the variants lookup must filter by shop_id — the query bypasses RLS (service-role client), so this filter IS the tenant boundary");
  assert.equal(shopEq[1][1], "shop-1");
});

test("evaluate_ab_experiment: the performance-metrics lookup is also scoped to the requesting shop, not just the platform_variant_id list", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    {
      data: {
        id: "exp-1",
        variants: [{ label: "A", content_item_id: "item-1" }, { label: "B", content_item_id: "item-2" }],
        metric: "impressions",
        status: "running",
        started_at: new Date().toISOString()
      },
      error: null
    },
    { data: [{ id: "variant-1", content_item_id: "item-1" }], error: null }, // marketing_platform_variants select
    { data: [], error: null } // marketing_performance_metrics select
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  await handler(event("evaluate_ab_experiment", { shop_id: "shop-1", experiment_id: "exp-1" }));

  const metricsCall = client.calls.find((c) => c.table === "marketing_performance_metrics" && c.ops.some((op) => op[0] === "select"));
  assert.ok(metricsCall, "expected a marketing_performance_metrics select");
  const shopEq = metricsCall.ops.find((op) => op[0] === "eq" && op[1][0] === "shop_id");
  assert.ok(shopEq, "the metrics lookup must filter by shop_id too — platform_variant_id alone is not a tenant boundary once RLS is bypassed");
  assert.equal(shopEq[1][1], "shop-1");
});

test("run_publishing_queue: the variant read that decides disclosure/provider dispatch is scoped to the requesting shop, not just the job's platform_variant_id", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: [{ id: "job-1" }], error: null }, // claimDueJobs: candidate select
    {
      data: [{ id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", status: "running", attempts: 0, max_attempts: 5, next_attempt_at: new Date(0).toISOString() }],
      error: null
    }, // claimDueJobs: atomic claim update
    { data: { id: "variant-1", platform: "facebook", caption: "hi", scheduled_at: null }, error: null }, // variant lookup
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  await handler(event("run_publishing_queue", { shop_id: "shop-1" }));

  const variantCall = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "select"));
  assert.ok(variantCall, "expected a marketing_platform_variants select");
  const shopEq = variantCall.ops.find((op) => op[0] === "eq" && op[1][0] === "shop_id");
  assert.ok(shopEq, "the publish-time variant read must be scoped to shop_id as defense-in-depth, even though today it's only ever reached via an already shop-scoped job");
  assert.equal(shopEq[1][1], "shop-1");
});

// ── schedule_content_item (Launch-blocker fix, Blocker 3/4) ────────────

test("schedule_content_item: converts the shop's local wall-clock pick to the correct UTC instant using the shop's OWN real timezone, never a hardcoded one", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { timezone: "America/Los_Angeles" }, error: null }, // shops lookup
    { data: [{ id: "v-1", platform: "facebook", scheduled_at: "2026-01-15T16:00:00.000Z" }], error: null }, // variants update
    { data: null, error: null }, // marketing_publishing_jobs resync (Priority 10) — no queued job for this variant
    { data: null, error: null } // writeCommandAudit insert
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("schedule_content_item", { shop_id: "shop-1", content_item_id: "item-1", scheduled_at_local: "2026-01-15T08:00" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  // 8 AM PST (UTC-8) -> 4 PM UTC.
  assert.equal(body.scheduled_at_utc, "2026-01-15T16:00:00.000Z");
  const updateCall = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update"));
  assert.equal(updateCall.payload.scheduled_at, "2026-01-15T16:00:00.000Z");
});

test("schedule_content_item: rejects an unparseable scheduled_at_local with a clear 400 rather than writing a bad timestamp", async () => {
  const client = createFakeSupabaseClient([superAdminRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("schedule_content_item", { shop_id: "shop-1", content_item_id: "item-1", scheduled_at_local: "not-a-real-time" }));
  assert.equal(res.statusCode, 400);
});

test("schedule_content_item: falls back to America/New_York only when the shop truly has no timezone on file, not as a silent default override", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { timezone: null }, error: null },
    { data: [{ id: "v-1", platform: "facebook", scheduled_at: "2026-01-15T13:00:00.000Z" }], error: null },
    { data: null, error: null }, // marketing_publishing_jobs resync (Priority 10) — no queued job for this variant
    { data: null, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("schedule_content_item", { shop_id: "shop-1", content_item_id: "item-1", scheduled_at_local: "2026-01-15T08:00" }));
  const body = JSON.parse(res.body);
  assert.equal(body.scheduled_at_utc, "2026-01-15T13:00:00.000Z");
  assert.equal(body.timezone, "America/New_York");
});

// Priority 10 (scheduling hardening): rescheduling a content item AFTER
// enqueue_publish has already created its marketing_publishing_jobs row is
// a real, legal call order — schedule_content_item has no guard preventing
// it. Without the fix below, the already-queued job's next_attempt_at
// would silently stay pinned to the OLD time, so the real publish attempt
// would still fire when the shop just moved it away from.
test("schedule_content_item: resyncs an already-queued publishing job's next_attempt_at to the new schedule, scoped to only still-queued jobs for the rescheduled variants", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { timezone: "America/Los_Angeles" }, error: null }, // shops lookup
    { data: [{ id: "v-1", platform: "facebook", scheduled_at: "2026-01-15T16:00:00.000Z" }], error: null }, // variants update
    { data: null, error: null }, // marketing_publishing_jobs resync
    { data: null, error: null } // writeCommandAudit insert
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("schedule_content_item", { shop_id: "shop-1", content_item_id: "item-1", scheduled_at_local: "2026-01-15T08:00" }));
  assert.equal(res.statusCode, 200);

  const jobSyncCall = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.ok(jobSyncCall, "expected a marketing_publishing_jobs update after the variant reschedule succeeded");
  assert.equal(jobSyncCall.payload.next_attempt_at, "2026-01-15T16:00:00.000Z", "the queued job must be moved to the SAME new UTC instant just written onto the variant");

  const statusEq = jobSyncCall.ops.find((op) => op[0] === "eq" && op[1][0] === "status");
  assert.ok(statusEq, "must only touch jobs still in status='queued' — an in-flight or already-settled attempt must never be rewritten out from under itself");
  assert.equal(statusEq[1][1], "queued");

  const variantIn = jobSyncCall.ops.find((op) => op[0] === "in" && op[1][0] === "platform_variant_id");
  assert.ok(variantIn, "must scope the resync to only the variants that were actually just rescheduled");
  assert.deepEqual(variantIn[1][1], ["v-1"]);
});
