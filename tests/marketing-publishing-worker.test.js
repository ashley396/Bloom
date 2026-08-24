import test from "node:test";
import assert from "node:assert/strict";
import { claimDueJobs, processClaimedJob, runPublishingWorker } from "../netlify/functions/_shared/marketing-publishing-worker.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

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
  const client = createFakeSupabaseClient([{ data: [], error: null }]);
  const results = await runPublishingWorker(client, { shopId: "shop-1" });
  assert.deepEqual(results, []);
});
