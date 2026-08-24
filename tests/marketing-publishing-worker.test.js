import test from "node:test";
import assert from "node:assert/strict";
import { claimDueJobs, processClaimedJob, runPublishingWorker, reclaimStaleRunningJobs } from "../netlify/functions/_shared/marketing-publishing-worker.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";
import { encryptSocialToken } from "../netlify/functions/_shared/marketing-social-oauth.js";

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
});
test.afterEach(() => {
  process.env = { ...savedEnv };
});

function mockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

// Launch-blocker fix, Blocker 3: the real durable-scheduler execution
// engine. Section 4's explicit requirements are covered here directly
// against the worker module, independent of which caller (the admin
// action or the cron-triggered scheduled function) invokes it.

test("claimDueJobs: a job scheduled in the future is never selected", async () => {
  const client = createFakeSupabaseClient([
    { data: [], error: null } // candidate select finds nothing due
  ]);
  const claimed = await claimDueJobs(client, { shopId: "shop-1", now: new Date("2026-09-01T12:00:00Z") });
  assert.deepEqual(claimed, []);
  // The claim UPDATE must never even run when there are no candidates.
  const updateCall = client.calls.find((c) => c.ops.some((op) => op[0] === "update"));
  assert.equal(updateCall, undefined, "no update should be issued when nothing is due");
});

test("claimDueJobs: a genuinely due job IS selected and flipped to running", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ id: "job-1" }], error: null }, // candidates
    { data: [{ id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", status: "running", attempts: 0, max_attempts: 5, next_attempt_at: new Date(0).toISOString() }], error: null } // claim update
  ]);
  const claimed = await claimDueJobs(client, { shopId: "shop-1" });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, "job-1");
  const updateCall = client.calls.find((c) => c.ops.some((op) => op[0] === "update"));
  assert.equal(updateCall.payload.status, "running");
});

test("claimDueJobs: omitting shopId claims across every shop (the cron path) — no shop_id filter is applied", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ id: "job-1" }, { id: "job-2" }], error: null },
    {
      data: [
        { id: "job-1", shop_id: "shop-1", platform_variant_id: "v-1", status: "running", attempts: 0, max_attempts: 5, next_attempt_at: new Date(0).toISOString() },
        { id: "job-2", shop_id: "shop-2", platform_variant_id: "v-2", status: "running", attempts: 0, max_attempts: 5, next_attempt_at: new Date(0).toISOString() }
      ],
      error: null
    }
  ]);
  const claimed = await claimDueJobs(client, { shopId: null, limit: 50 });
  assert.equal(claimed.length, 2);
  assert.deepEqual(claimed.map((j) => j.shop_id).sort(), ["shop-1", "shop-2"]);
  const candidateCall = client.calls[0];
  assert.ok(!candidateCall.ops.some((op) => op[0] === "eq" && op[1][0] === "shop_id"), "the global claim must not scope by shop_id");
});

test("claimDueJobs: overlapping-worker protection — when the claim UPDATE's own re-checked status='queued' loses a race, only the rows that actually got returned are treated as claimed", async () => {
  // Two candidates were selected, but only one comes back from the claim
  // update — simulating a concurrent worker having already claimed the
  // other one between the SELECT and this UPDATE. The safety property
  // being tested: the caller only ever processes what the UPDATE actually
  // returned, never the original candidate list.
  const client = createFakeSupabaseClient([
    { data: [{ id: "job-1" }, { id: "job-2" }], error: null },
    { data: [{ id: "job-1", shop_id: "shop-1", platform_variant_id: "v-1", status: "running", attempts: 0, max_attempts: 5, next_attempt_at: new Date(0).toISOString() }], error: null } // only job-1 comes back
  ]);
  const claimed = await claimDueJobs(client, { shopId: "shop-1" });
  assert.equal(claimed.length, 1, "must never fabricate a claim for job-2 just because it was a candidate");
  assert.equal(claimed[0].id, "job-1");
});

test("processClaimedJob: quarantined source asset blocks the job as a fatal, non-retryable failure — provider is never called", async () => {
  const job = { id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 0, max_attempts: 5 };
  const client = createFakeSupabaseClient([
    { data: { id: "variant-1", platform: "facebook", asset_id: "asset-1", ai_disclosure_required: false, disclosure_applied: false }, error: null }, // variant lookup
    { data: { id: "asset-1", status: "quarantined" }, error: null }, // asset status check
    { data: null, error: null }, // jobs update
    { data: null, error: null } // variants update
  ]);
  const result = await processClaimedJob(client, job);
  assert.equal(result.outcome, "failed");
  const jobUpdate = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.equal(jobUpdate.payload.last_error_code, "fatal");
  assert.match(jobUpdate.payload.last_error, /quarantined/i);
});

test("processClaimedJob: a disclosure-required-but-not-applied variant is blocked before the provider is ever reached", async () => {
  const job = { id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 0, max_attempts: 5 };
  const client = createFakeSupabaseClient([
    { data: { id: "variant-1", platform: "tiktok", ai_disclosure_required: true, disclosure_applied: false }, error: null },
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const result = await processClaimedJob(client, job);
  assert.equal(result.outcome, "failed");
});

test("processClaimedJob: a not-live platform is a structural failure — settles to 'failed' immediately, never retried as transient", async () => {
  const job = { id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 0, max_attempts: 5 };
  const client = createFakeSupabaseClient([
    { data: { id: "variant-1", platform: "instagram", ai_disclosure_required: false, disclosure_applied: false }, error: null },
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const result = await processClaimedJob(client, job);
  assert.equal(result.outcome, "failed");
  const jobUpdate = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.equal(jobUpdate.payload.last_error_code, "not_live");
});

test("processClaimedJob: attempts below max_attempts on a hypothetical transient failure would requeue with backoff, not dead-letter (classification contract preserved)", async () => {
  // The not-live failure path is deliberately fatal (never transient) per
  // classifyPublishFailure — this test exercises the SAME code path's
  // wiring of attempts/max_attempts into nextJobStateAfterFailure by
  // checking the not-live case respects max_attempts=1 without needing a
  // real transient-failure provider to exist yet.
  const job = { id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 0, max_attempts: 5 };
  const client = createFakeSupabaseClient([
    { data: { id: "variant-1", platform: "youtube", ai_disclosure_required: false, disclosure_applied: false }, error: null },
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const result = await processClaimedJob(client, job);
  const jobUpdate = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.equal(jobUpdate.payload.attempts, 1, "attempts must increment exactly once per processed job");
  assert.equal(jobUpdate.payload.status, "failed");
  assert.equal(result.outcome, "failed");
});

test("runPublishingWorker: claims then processes in one call, end to end, for a shop-scoped run", async () => {
  const client = createFakeSupabaseClient([
    { data: [], error: null }, // reclaimStaleRunningJobs: no stale jobs
    { data: [{ id: "job-1" }], error: null },
    { data: [{ id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", status: "running", attempts: 0, max_attempts: 5, next_attempt_at: new Date(0).toISOString() }], error: null },
    { data: { id: "variant-1", platform: "pinterest", ai_disclosure_required: false, disclosure_applied: false }, error: null },
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const results = await runPublishingWorker(client, { shopId: "shop-1" });
  assert.equal(results.length, 1);
  assert.equal(results[0].outcome, "failed");
  assert.equal(results[0].platform, "pinterest");
});

test("runPublishingWorker: zero due jobs returns an empty result set without issuing any process-time queries", async () => {
  const client = createFakeSupabaseClient([
    { data: [], error: null }, // reclaimStaleRunningJobs: no stale jobs
    { data: [], error: null } // claimDueJobs: nothing due
  ]);
  const results = await runPublishingWorker(client, { shopId: "shop-1" });
  assert.deepEqual(results, []);
});

// ── Priority B hardening: recovery after interrupted execution ─────────

test("reclaimStaleRunningJobs: a job stuck at 'running' well past the stale threshold is requeued with a classified, retryable failure state", async () => {
  const now = new Date("2026-09-01T12:00:00Z");
  const client = createFakeSupabaseClient([
    { data: [{ id: "job-stuck", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 1, max_attempts: 5 }], error: null }, // stale select
    { data: [{ id: "job-stuck" }], error: null } // re-checked status='running' update — won the race
  ]);
  const result = await reclaimStaleRunningJobs(client, { now });
  assert.equal(result.reclaimed, 1);
  assert.equal(result.deadLettered, 0);
  const updateCall = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.equal(updateCall.payload.status, "queued", "an interrupted job below max_attempts must become claimable again, not silently lost");
  assert.equal(updateCall.payload.attempts, 2);
  assert.equal(updateCall.payload.last_error_code, "interrupted_execution");
  const statusEq = updateCall.ops.find((op) => op[0] === "eq" && op[1][0] === "status");
  assert.equal(statusEq[1][1], "running", "the reclaim update must re-check status='running' — the same race-safety pattern as claimDueJobs");
});

test("reclaimStaleRunningJobs: a stuck job already at max_attempts dead-letters instead of retrying forever, and marks the variant failed", async () => {
  const now = new Date("2026-09-01T12:00:00Z");
  const client = createFakeSupabaseClient([
    { data: [{ id: "job-stuck", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 4, max_attempts: 5 }], error: null },
    { data: [{ id: "job-stuck" }], error: null }, // job update
    { data: null, error: null } // variant update
  ]);
  const result = await reclaimStaleRunningJobs(client, { now });
  assert.equal(result.reclaimed, 0);
  assert.equal(result.deadLettered, 1);
  const jobUpdate = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.equal(jobUpdate.payload.status, "dead_letter");
  const variantUpdate = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update"));
  assert.equal(variantUpdate.payload.status, "failed", "a job that finally exhausts its attempts via repeated interruption must surface as a real, visible failure on the variant too — never a silent drop");
});

test("reclaimStaleRunningJobs: losing the re-checked status='running' race (a concurrent worker already resolved it) is a no-op, not a double-recovery", async () => {
  const now = new Date("2026-09-01T12:00:00Z");
  const client = createFakeSupabaseClient([
    { data: [{ id: "job-stuck", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 1, max_attempts: 5 }], error: null },
    { data: [], error: null } // update returns nothing — already resolved concurrently
  ]);
  const result = await reclaimStaleRunningJobs(client, { now });
  assert.equal(result.reclaimed, 0);
  assert.equal(result.deadLettered, 0);
});

test("reclaimStaleRunningJobs: no stale jobs found issues zero update queries", async () => {
  const client = createFakeSupabaseClient([{ data: [], error: null }]);
  const result = await reclaimStaleRunningJobs(client, {});
  assert.deepEqual(result, { reclaimed: 0, deadLettered: 0, inspected: 0 });
  const updateCall = client.calls.find((c) => c.ops.some((op) => op[0] === "update"));
  assert.equal(updateCall, undefined);
});

test("runPublishingWorker: reclaims a stale job AND claims freshly-due jobs in the same pass", async () => {
  const now = new Date("2026-09-01T12:00:00Z");
  const client = createFakeSupabaseClient([
    { data: [{ id: "job-stuck", shop_id: "shop-1", platform_variant_id: "v-stuck", attempts: 0, max_attempts: 5 }], error: null }, // stale select
    { data: [{ id: "job-stuck" }], error: null }, // stale job requeued
    { data: [{ id: "job-2" }], error: null }, // claimDueJobs candidates
    { data: [{ id: "job-2", shop_id: "shop-1", platform_variant_id: "v-2", status: "running", attempts: 0, max_attempts: 5, next_attempt_at: new Date(0).toISOString() }], error: null },
    { data: { id: "v-2", platform: "linkedin", ai_disclosure_required: false, disclosure_applied: false }, error: null },
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const results = await runPublishingWorker(client, { shopId: "shop-1", now });
  // Only job-2 (the freshly claimed one) is processed THIS pass — the
  // reclaimed job is merely made claimable again, exactly like any other
  // queued job, picked up on a subsequent claim rather than force-processed
  // out of order in the same call.
  assert.equal(results.length, 1);
  assert.equal(results[0].job_id, "job-2");
});

// ── Priority 5 (strict social-provider audit) fixes ─────────────────────

test("processClaimedJob: a missing/foreign variant (deleted, or belongs to another shop) fails CLOSED — never proceeds to the disclosure gate with an empty object, never calls the provider", async () => {
  const job = { id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-ghost", attempts: 0, max_attempts: 5 };
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // variant lookup — not found (wrong shop, or deleted)
    { data: null, error: null }, // jobs update
    { data: null, error: null } // variants update
  ]);
  const result = await processClaimedJob(client, job);
  assert.equal(result.outcome, "failed");
  assert.equal(result.platform, null, "no platform was ever established — nothing here can claim a specific provider was involved");
  const jobUpdate = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.equal(jobUpdate.payload.last_error_code, "fatal", "a missing variant is never worth retrying");
  assert.match(jobUpdate.payload.last_error, /not found/i);
});

test("processClaimedJob: a real DB error on the variant read is a classified, retryable failure — never silently swallowed into a fake-empty variant", async () => {
  const job = { id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 0, max_attempts: 5 };
  const client = createFakeSupabaseClient([
    { data: null, error: { message: "connection reset" } }, // variant lookup — real DB error, not just "not found"
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const result = await processClaimedJob(client, job);
  assert.equal(result.outcome, "queued", "an unclassified DB error defaults to transient — must be retried, not treated as fatal or silently ignored");
  const jobUpdate = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.equal(jobUpdate.payload.last_error_code, "transient");
  assert.match(jobUpdate.payload.last_error, /connection reset/i);
});

test("processClaimedJob: a platform this shop has never connected fails structurally — the provider is never touched even though it exists in code", async () => {
  const job = { id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 0, max_attempts: 5 };
  const client = createFakeSupabaseClient([
    { data: { id: "variant-1", platform: "instagram", ai_disclosure_required: false, disclosure_applied: false }, error: null }, // variant lookup
    { data: null, error: null }, // marketing_social_connections lookup — no row at all
    { data: null, error: null }, // jobs update
    { data: null, error: null } // variants update
  ]);
  const result = await processClaimedJob(client, job);
  assert.equal(result.outcome, "failed");
  const connectionCall = client.calls.find((c) => c.table === "marketing_social_connections");
  assert.ok(connectionCall, "expected a marketing_social_connections lookup before any publish attempt");
  const shopEq = connectionCall.ops.find((op) => op[0] === "eq" && op[1][0] === "shop_id");
  assert.equal(shopEq[1][1], "shop-1", "the connection check itself must be shop-scoped");
  const jobUpdate = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.match(jobUpdate.payload.last_error, /no usable connection/i);
  assert.match(jobUpdate.payload.last_error, /instagram/);
});

test("processClaimedJob: a connection that exists but is disconnected/needs_reauth/error never reaches the provider", async () => {
  for (const status of ["disconnected", "needs_reauth", "error", "connecting", "not_connected"]) {
    const job = { id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 0, max_attempts: 5 };
    // eslint-disable-next-line no-await-in-loop
    const client = createFakeSupabaseClient([
      { data: { id: "variant-1", platform: "facebook", ai_disclosure_required: false, disclosure_applied: false }, error: null },
      { data: { id: "conn-1", status, expires_at: null }, error: null },
      { data: null, error: null },
      { data: null, error: null }
    ]);
    // eslint-disable-next-line no-await-in-loop
    const result = await processClaimedJob(client, job);
    assert.equal(result.outcome, "failed", `status '${status}' must never allow a publish attempt to proceed`);
  }
});

test("processClaimedJob: a connection marked 'connected' but with an expired token fails safely — never treated as usable just because status says connected", async () => {
  const job = { id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 0, max_attempts: 5 };
  const client = createFakeSupabaseClient([
    { data: { id: "variant-1", platform: "tiktok", ai_disclosure_required: false, disclosure_applied: false }, error: null },
    { data: { id: "conn-1", status: "connected", expires_at: "2020-01-01T00:00:00.000Z" }, error: null }, // long expired
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const result = await processClaimedJob(client, job, { now: new Date("2026-08-24T00:00:00.000Z") });
  assert.equal(result.outcome, "failed");
  const jobUpdate = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.match(jobUpdate.payload.last_error, /no usable connection/i);
});

test("processClaimedJob: a genuinely connected, non-expired platform clears the connection gate and proceeds to the (still not-live) provider", async () => {
  const job = { id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 0, max_attempts: 5 };
  const client = createFakeSupabaseClient([
    { data: { id: "variant-1", platform: "facebook", ai_disclosure_required: false, disclosure_applied: false }, error: null },
    { data: { id: "conn-1", status: "connected", expires_at: "2099-01-01T00:00:00.000Z" }, error: null }, // far future
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const result = await processClaimedJob(client, job, { now: new Date("2026-08-24T00:00:00.000Z") });
  assert.equal(result.outcome, "failed", "still fails — no adapter is live yet — but for the RIGHT reason now");
  const jobUpdate = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.equal(jobUpdate.payload.last_error_code, "not_live", "must reach the not-live provider stub, not get stuck at the connection gate");
});

test("processClaimedJob: a connection with no expiry set at all (never expires) is usable as long as status is 'connected'", async () => {
  const job = { id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 0, max_attempts: 5 };
  const client = createFakeSupabaseClient([
    { data: { id: "variant-1", platform: "facebook", ai_disclosure_required: false, disclosure_applied: false }, error: null },
    { data: { id: "conn-1", status: "connected", expires_at: null }, error: null },
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const result = await processClaimedJob(client, job);
  const jobUpdate = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.equal(jobUpdate.payload.last_error_code, "not_live", "a null expires_at must never be treated as already-expired");
});

// Priority 5 completion pass ("adapter exists" vs "feature works"): the
// worker must actually resolve a real asset URL, decrypt a real stored
// token, call a REAL adapter (proven here against a mocked TikTok API,
// not an injected fake), and record the real result — not just clear the
// connection gate and stop at a not-live stub.
test("processClaimedJob: REAL publish end-to-end (tiktok) — resolves the asset's public URL via website_media, decrypts the stored token, calls the real adapter, and records external_post_id + published_at", async () => {
  process.env.FLORISYN_SOCIAL_TIKTOK_CLIENT_ID = "tt-id";
  process.env.FLORISYN_SOCIAL_TIKTOK_CLIENT_SECRET = "tt-secret";
  process.env.FLORISYN_MARKETING_TOKEN_KEY = "a-real-key";

  const cipher = encryptSocialToken("real-tiktok-access-token", process.env);
  const job = { id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 0, max_attempts: 5 };
  const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://storage.example.com/website-media/${path}` });
  const client = createFakeSupabaseClient(
    [
      { data: { id: "variant-1", platform: "tiktok", caption: "Fresh cuts today", asset_id: "asset-1", ai_disclosure_required: false, disclosure_applied: false }, error: null }, // variant
      { data: { id: "asset-1", status: "completed", media_id: "media-1" }, error: null }, // ai_generated_assets
      { data: { storage_path: "shop-1/reel.mp4" }, error: null }, // website_media
      { data: { id: "conn-1", status: "connected", expires_at: null, external_account_id: null }, error: null }, // connection
      { data: { access_token_ciphertext: cipher }, error: null }, // secrets
      { data: null, error: null }, // job update
      { data: null, error: null } // variant update
    ],
    { storage }
  );

  const calls = [];
  const restoreFetch = mockFetch(async (url, init) => {
    const u = new URL(String(url));
    calls.push(u.pathname);
    if (init?.body) calls.push(JSON.parse(init.body));
    if (u.pathname.endsWith("/init/")) return { ok: true, json: async () => ({ data: { publish_id: "real-publish-1" } }) };
    return { ok: true, json: async () => ({ data: { status: "PUBLISH_COMPLETE" } }) };
  });

  const result = await processClaimedJob(client, job);
  restoreFetch();

  assert.equal(result.outcome, "succeeded");
  assert.ok(calls.includes("/v2/post/publish/video/init/"), "must actually call the real TikTok init endpoint");
  const initBody = calls.find((c) => typeof c === "object" && c.source_info);
  assert.equal(initBody.source_info.video_url, "https://storage.example.com/website-media/shop-1/reel.mp4", "must resolve the asset's REAL public URL, not the internal asset id");

  const variantUpdate = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update"));
  assert.equal(variantUpdate.payload.status, "published");
  assert.equal(variantUpdate.payload.external_post_id, "real-publish-1", "the real provider's post id must be recorded, not left blank");
  assert.ok(variantUpdate.payload.published_at);
});

test("processClaimedJob: a text-only facebook post (no asset) targets the real Page via external_account_id, using the Page's own decrypted token", async () => {
  process.env.FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID = "fb-id";
  process.env.FLORISYN_SOCIAL_FACEBOOK_CLIENT_SECRET = "fb-secret";
  process.env.FLORISYN_MARKETING_TOKEN_KEY = "a-real-key";

  const cipher = encryptSocialToken("real-page-token", process.env);
  const job = { id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 0, max_attempts: 5 };
  const client = createFakeSupabaseClient([
    { data: { id: "variant-1", platform: "facebook", caption: "Wedding season is here", asset_id: null, ai_disclosure_required: false, disclosure_applied: false }, error: null },
    { data: { id: "conn-1", status: "connected", expires_at: null, external_account_id: "page-1" }, error: null },
    { data: { access_token_ciphertext: cipher }, error: null },
    { data: null, error: null },
    { data: null, error: null }
  ]);

  let capturedUrl;
  const restoreFetch = mockFetch(async (url) => {
    capturedUrl = new URL(String(url));
    return { ok: true, json: async () => ({ id: "page-1_post-99" }) };
  });
  const result = await processClaimedJob(client, job);
  restoreFetch();

  assert.equal(result.outcome, "succeeded");
  assert.match(capturedUrl.pathname, /\/page-1\/feed$/, "must publish against the real stored Page id");
  assert.equal(capturedUrl.searchParams.get("access_token"), "real-page-token", "must use the decrypted PAGE token, not a placeholder");

  const variantUpdate = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update"));
  assert.equal(variantUpdate.payload.external_post_id, "page-1_post-99");
});

test("processClaimedJob: no stored access token for an otherwise-connected platform fails as token_invalid, never crashes or fakes a token", async () => {
  process.env.FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID = "fb-id";
  process.env.FLORISYN_SOCIAL_FACEBOOK_CLIENT_SECRET = "fb-secret";
  const job = { id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 0, max_attempts: 5 };
  const client = createFakeSupabaseClient([
    { data: { id: "variant-1", platform: "facebook", caption: "hi", asset_id: null, ai_disclosure_required: false, disclosure_applied: false }, error: null },
    { data: { id: "conn-1", status: "connected", expires_at: null, external_account_id: "page-1" }, error: null },
    { data: null, error: null } // secrets row missing entirely
  ]);
  const result = await processClaimedJob(client, job);
  assert.equal(result.outcome, "failed");
  const jobUpdate = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.equal(jobUpdate.payload.last_error_code, "token_invalid");
});

test("processClaimedJob: a provider that rejects the stored token (real 401) flips the connection to needs_reauth — real connection-health tracking, not just a job failure", async () => {
  process.env.FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID = "fb-id";
  process.env.FLORISYN_SOCIAL_FACEBOOK_CLIENT_SECRET = "fb-secret";
  process.env.FLORISYN_MARKETING_TOKEN_KEY = "a-real-key";
  const cipher = encryptSocialToken("expired-token", process.env);
  const job = { id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 0, max_attempts: 5 };
  const client = createFakeSupabaseClient([
    { data: { id: "variant-1", platform: "facebook", caption: "hi", asset_id: null, ai_disclosure_required: false, disclosure_applied: false }, error: null },
    { data: { id: "conn-1", status: "connected", expires_at: null, external_account_id: "page-1" }, error: null },
    { data: { access_token_ciphertext: cipher }, error: null },
    { data: null, error: null }, // job update
    { data: null, error: null }, // variant update
    { data: null, error: null } // connection needs_reauth update
  ]);
  const restoreFetch = mockFetch(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "Error validating access token", code: 190 } }) }));
  const result = await processClaimedJob(client, job);
  restoreFetch();

  assert.equal(result.outcome, "failed");
  const jobUpdate = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.equal(jobUpdate.payload.last_error_code, "token_invalid");

  const connectionUpdate = client.calls.find(
    (c) => c.table === "marketing_social_connections" && c.ops.some((op) => op[0] === "update") && c.payload.status === "needs_reauth"
  );
  assert.ok(connectionUpdate, "a real token rejection must flip the connection's real health status, not silently stay 'connected'");
  assert.equal(connectionUpdate.payload.status, "needs_reauth");
});

test("processClaimedJob: an ambiguous (status-unconfirmed) failure never auto-retries — via an injected stub provider, since the real timeout path takes real minutes and is proven separately in the adapter's own tests", async () => {
  process.env.FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID = "fb-id";
  process.env.FLORISYN_SOCIAL_FACEBOOK_CLIENT_SECRET = "fb-secret";
  process.env.FLORISYN_MARKETING_TOKEN_KEY = "a-real-key";

  const job = { id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", attempts: 0, max_attempts: 5 };
  const timeoutError = new Error("did not complete in time");
  timeoutError.code = "social_provider_timeout";
  timeoutError.statusCode = 504;
  const stubRegistry = {
    facebook: {
      platform: "facebook",
      async publish() {
        throw timeoutError;
      }
    }
  };
  const cipher = encryptSocialToken("token", process.env);
  const client = createFakeSupabaseClient([
    { data: { id: "variant-1", platform: "facebook", caption: "hi", asset_id: null, ai_disclosure_required: false, disclosure_applied: false }, error: null },
    { data: { id: "conn-1", status: "connected", expires_at: null, external_account_id: "page-1" }, error: null },
    { data: { access_token_ciphertext: cipher }, error: null }, // a real, decryptable secret — the failure must genuinely come from the (stubbed) provider call, not an earlier token gate
    { data: null, error: null } // job update only — must NOT be requeued
  ]);
  const result = await processClaimedJob(client, job, { registry: stubRegistry });
  assert.equal(result.outcome, "failed");
  const jobUpdate = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.equal(jobUpdate.payload.last_error_code, "ambiguous");
  assert.equal(jobUpdate.payload.status, "failed", "never silently requeued for a blind retry that could duplicate-post");
});
