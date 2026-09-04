import test from "node:test";
import assert from "node:assert/strict";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";
import {
  PREMIUM_JOB_TYPE,
  PREMIUM_JOB_ACTIVE_STATUSES,
  PREMIUM_JOB_MAX_ATTEMPTS,
  PREMIUM_JOB_RECOVERY_STATES,
  classifyPremiumJobRecoveryState,
  findActivePremiumJobForContentItem,
  findLatestPremiumJobForContentItem,
  createPremiumJob,
  buildPlannedAttemptStep,
  addPremiumJobAttempt,
  claimPremiumJobForExecution,
  markPremiumAttemptProviderStarting,
  markPremiumAttemptProviderFinished,
  settlePremiumJobCompleted,
  settlePremiumJobFailed,
  reconcileStuckPremiumJob,
  invokePremiumCreativeBackgroundFunction
} from "../netlify/functions/_shared/marketing-premium-creative-job.js";

// Hybrid Marketing Studio Batch 4 ("async job architecture") — the
// durable job model's own unit tests, isolated from the giant
// generate_content dispatch (see marketing-studio-premium-creative-
// async-job.test.js for the real end-to-end integration coverage).

test("createPremiumJob inserts a planned ai_execution_jobs row with the exact durable shape — no new table, no migration", async () => {
  const client = createFakeSupabaseClient([{ data: { id: "job-1", status: "planned" }, error: null }]);
  const result = await createPremiumJob(client, { shopId: "shop-1", userId: "user-1", contentItemId: "item-1", title: "Everyday post", traceId: "trace-1" });
  assert.equal(result.ok, true);
  assert.equal(result.job.id, "job-1");
  const insertCall = client.calls.find((c) => c.table === "ai_execution_jobs" && c.ops.some((op) => op[0] === "insert"));
  const inserted = insertCall.ops.find((op) => op[0] === "insert")[1][0];
  assert.equal(inserted.job_type, PREMIUM_JOB_TYPE);
  assert.equal(inserted.status, "planned");
  assert.deepEqual(inserted.plan, []);
  assert.equal(inserted.result.content_item_id, "item-1");
  assert.equal(inserted.result.trace_id, "trace-1");
});

test("createPremiumJob requires shopId and contentItemId, never inserts otherwise", async () => {
  const client = createFakeSupabaseClient([]);
  const result = await createPremiumJob(client, { shopId: null, contentItemId: "item-1" });
  assert.equal(result.ok, false);
  assert.deepEqual(client.calls, []);
});

test("findActivePremiumJobForContentItem (Part B idempotency): finds the shop's own active job for this content item among several", async () => {
  const client = createFakeSupabaseClient([
    {
      data: [
        { id: "job-other", status: "planned", result: { content_item_id: "item-other" } },
        { id: "job-1", status: "running", result: { content_item_id: "item-1" } }
      ],
      error: null
    }
  ]);
  const result = await findActivePremiumJobForContentItem(client, { shopId: "shop-1", contentItemId: "item-1" });
  assert.equal(result.ok, true);
  assert.equal(result.job.id, "job-1");
  const call = client.calls[0];
  const inCall = call.ops.find((op) => op[0] === "in");
  assert.deepEqual(inCall[1], ["status", PREMIUM_JOB_ACTIVE_STATUSES]);
});

test("findActivePremiumJobForContentItem returns null (not an error) when no active job matches — a fresh generation is free to proceed", async () => {
  const client = createFakeSupabaseClient([{ data: [{ id: "job-x", status: "planned", result: { content_item_id: "item-other" } }], error: null }]);
  const result = await findActivePremiumJobForContentItem(client, { shopId: "shop-1", contentItemId: "item-1" });
  assert.equal(result.ok, true);
  assert.equal(result.job, null);
});

test("buildPlannedAttemptStep + addPremiumJobAttempt (Part J): a retry APPENDS a new attempt, never overwrites attempt-0's history", async () => {
  const existingAttempt0 = { id: "attempt-0", attempt_index: 0, status: "failed", usage_id: "usage-0" };
  const client = createFakeSupabaseClient([
    { data: { plan: [existingAttempt0], result: { content_item_id: "item-1" }, updated_at: "2026-01-01T00:00:00.000Z" }, error: null }, // read
    { data: [{ id: "job-1", plan: [existingAttempt0, { id: "attempt-1" }] }], error: null } // update (Batch 4.2: CAS — no .single(), returns an array)
  ]);
  const step = buildPlannedAttemptStep({ attemptIndex: 1, reservationId: "usage-1" });
  assert.equal(step.attempt_index, 1);
  assert.equal(step.status, "planned");
  const result = await addPremiumJobAttempt(client, "job-1", step, {});
  assert.equal(result.ok, true);
  const updateCall = client.calls.find((c) => c.ops.some((op) => op[0] === "update"));
  const updatedPlan = updateCall.ops.find((op) => op[0] === "update")[1][0].plan;
  assert.equal(updatedPlan.length, 2, "attempt-0 must survive alongside the new attempt-1");
  assert.deepEqual(updatedPlan[0], existingAttempt0, "attempt-0's history must never be overwritten");
  assert.equal(updatedPlan[1].attempt_index, 1);
});

test("claimPremiumJobForExecution (Part D idempotency): the atomic planned->running UPDATE — a second concurrent/retried invocation for the SAME job never wins twice", async () => {
  const client = createFakeSupabaseClient([{ data: [{ id: "job-1", status: "running" }], error: null }]);
  const first = await claimPremiumJobForExecution(client, "job-1");
  assert.equal(first.claimed, true);
  assert.equal(first.job.id, "job-1");
  const call = client.calls[0];
  assert.ok(call.ops.some((op) => op[0] === "eq" && op[1][0] === "status" && op[1][1] === "planned"), "must re-check status=planned inside the single atomic UPDATE");
});

test("claimPremiumJobForExecution: zero rows matched means claimed:false — a duplicate Background Function invocation must never call the provider a second time", async () => {
  const client = createFakeSupabaseClient([{ data: [], error: null }]);
  const result = await claimPremiumJobForExecution(client, "job-1");
  assert.equal(result.ok, true);
  assert.equal(result.claimed, false);
  assert.equal(result.job, null);
});

test("markPremiumAttemptProviderStarting (Part E): commits provider_generate_entered=true onto the LATEST attempt before the outbound fetch", async () => {
  const client = createFakeSupabaseClient([
    { data: { plan: [{ id: "attempt-0", status: "planned", marker: null }] }, error: null }, // read
    { data: { id: "job-1" }, error: null } // update
  ]);
  const result = await markPremiumAttemptProviderStarting(client, "job-1", { provider: "openai", model: "gpt-image-2" });
  assert.equal(result.ok, true);
  const updateCall = client.calls.find((c) => c.ops.some((op) => op[0] === "update"));
  const plan = updateCall.ops.find((op) => op[0] === "update")[1][0].plan;
  assert.equal(plan[0].status, "running");
  assert.equal(plan[0].marker.provider_generate_entered, true);
  assert.ok(plan[0].marker.provider_request_started_at);
  assert.equal(plan[0].marker.provider_request_finished_at, null);
});

test("markPremiumAttemptProviderFinished (Part E): merges onto the starting marker, never replacing provider_request_started_at", async () => {
  const client = createFakeSupabaseClient([
    { data: { plan: [{ id: "attempt-0", marker: { provider_generate_entered: true, provider_request_started_at: "2026-01-01T00:00:00.000Z" } }] }, error: null },
    { data: { id: "job-1" }, error: null }
  ]);
  const result = await markPremiumAttemptProviderFinished(client, "job-1", { provider_http_status: 200, provider_result_ok: true });
  assert.equal(result.ok, true);
  const updateCall = client.calls.find((c) => c.ops.some((op) => op[0] === "update"));
  const plan = updateCall.ops.find((op) => op[0] === "update")[1][0].plan;
  assert.equal(plan[0].marker.provider_request_started_at, "2026-01-01T00:00:00.000Z", "must not lose the earlier marker's own start time");
  assert.equal(plan[0].marker.provider_result_ok, true);
  assert.ok(plan[0].marker.provider_request_finished_at);
});

test("settlePremiumJobCompleted (Part G): the ONE state a completed Premium Design entitlement count actually reaches", async () => {
  const client = createFakeSupabaseClient([
    { data: { plan: [{ id: "attempt-0" }], result: { content_item_id: "item-1" } }, error: null },
    { data: { id: "job-1", status: "completed" }, error: null }
  ]);
  const result = await settlePremiumJobCompleted(client, "job-1", { assetId: "asset-1", backgroundImageUrl: "https://x/y.png" });
  assert.equal(result.ok, true);
  const updateCall = client.calls.find((c) => c.ops.some((op) => op[0] === "update"));
  const payload = updateCall.ops.find((op) => op[0] === "update")[1][0];
  assert.equal(payload.status, "completed");
  assert.equal(payload.error, null);
  assert.equal(payload.plan[0].status, "completed");
  assert.equal(payload.result.asset_id, "asset-1");
});

test("settlePremiumJobFailed: never marks 'completed' — a failed attempt must never count as a used Premium Design", async () => {
  const client = createFakeSupabaseClient([{ data: { plan: [{ id: "attempt-0" }] }, error: null }, { data: { id: "job-1", status: "failed" }, error: null }]);
  const result = await settlePremiumJobFailed(client, "job-1", { reason: "provider_request_failed" });
  assert.equal(result.ok, true);
  const updateCall = client.calls.find((c) => c.ops.some((op) => op[0] === "update"));
  const payload = updateCall.ops.find((op) => op[0] === "update")[1][0];
  assert.equal(payload.status, "failed");
  assert.equal(payload.error, "provider_request_failed");
  assert.equal(payload.plan[0].status, "failed");
});

// Part E/F: the five recovery states, derived purely from what's already
// durably persisted — never a live provider call, never a guess.
test("classifyPremiumJobRecoveryState: a completed job is SETTLED", () => {
  assert.equal(classifyPremiumJobRecoveryState({ status: "completed" }), PREMIUM_JOB_RECOVERY_STATES.SETTLED);
});
test("classifyPremiumJobRecoveryState: a job with no attempt at all is RESERVED_NOT_STARTED", () => {
  assert.equal(classifyPremiumJobRecoveryState({ status: "planned", plan: [] }), PREMIUM_JOB_RECOVERY_STATES.RESERVED_NOT_STARTED);
});
test("classifyPremiumJobRecoveryState: an attempt whose marker never entered provider.generate() is RESERVED_NOT_STARTED — safe to release, no spend occurred", () => {
  const job = { status: "running", plan: [{ marker: null }] };
  assert.equal(classifyPremiumJobRecoveryState(job), PREMIUM_JOB_RECOVERY_STATES.RESERVED_NOT_STARTED);
});
test("classifyPremiumJobRecoveryState: entered but no result recorded is PROVIDER_STARTED_UNKNOWN_RESULT — never free, never charged", () => {
  const job = { status: "running", plan: [{ marker: { provider_generate_entered: true, provider_result_ok: null } }] };
  assert.equal(classifyPremiumJobRecoveryState(job), PREMIUM_JOB_RECOVERY_STATES.PROVIDER_STARTED_UNKNOWN_RESULT);
});
test("classifyPremiumJobRecoveryState: a known failed result is PROVIDER_FAILED", () => {
  const job = { status: "running", plan: [{ marker: { provider_generate_entered: true, provider_result_ok: false } }] };
  assert.equal(classifyPremiumJobRecoveryState(job), PREMIUM_JOB_RECOVERY_STATES.PROVIDER_FAILED);
});
test("classifyPremiumJobRecoveryState: a known success that never reached 'completed' is PROVIDER_SUCCEEDED", () => {
  const job = { status: "running", plan: [{ marker: { provider_generate_entered: true, provider_result_ok: true } }] };
  assert.equal(classifyPremiumJobRecoveryState(job), PREMIUM_JOB_RECOVERY_STATES.PROVIDER_SUCCEEDED);
});

// Part H: staging-safe reconciliation.
test("reconcileStuckPremiumJob: RESERVED_NOT_STARTED settles the job failed and releases the linked usage row — no fabricated cost, no provider_confirmed", async () => {
  const job = { id: "job-1", status: "planned", plan: [{ usage_id: "usage-1", marker: null }] };
  const failCalls = [];
  const failProviderCallFn = async (client, usageId, opts) => {
    failCalls.push({ usageId, opts });
    return { ok: true };
  };
  const client = createFakeSupabaseClient([{ data: { plan: job.plan }, error: null }, { data: { id: "job-1", status: "failed" }, error: null }]);
  const result = await reconcileStuckPremiumJob(client, job, failProviderCallFn);
  assert.equal(result.action, "settled_failed");
  assert.equal(result.reason, "reconciliation_reserved_never_started");
  assert.equal(failCalls.length, 1);
  assert.equal(failCalls[0].usageId, "usage-1");
  assert.equal(failCalls[0].opts.metadata.reconciliation, true);
  assert.equal("actual_cost_cents" in failCalls[0].opts, false, "must never fabricate a cost figure for an unknown/never-started attempt");
});

test("reconcileStuckPremiumJob: PROVIDER_STARTED_UNKNOWN_RESULT settles as reconciliation-required, never treated as free or confirmed-charged", async () => {
  const job = { id: "job-1", status: "running", plan: [{ usage_id: "usage-1", marker: { provider_generate_entered: true, provider_result_ok: null } }] };
  const failProviderCallFn = async () => ({ ok: true });
  const client = createFakeSupabaseClient([{ data: { plan: job.plan }, error: null }, { data: { id: "job-1", status: "failed" }, error: null }]);
  const result = await reconcileStuckPremiumJob(client, job, failProviderCallFn);
  assert.equal(result.reason, "reconciliation_required_unknown_provider_result");
});

test("reconcileStuckPremiumJob: a real success that never reached settlement is flagged for manual review — NEVER auto-fabricated as completed", async () => {
  const job = { id: "job-1", status: "running", plan: [{ usage_id: "usage-1", marker: { provider_generate_entered: true, provider_result_ok: true } }] };
  const client = createFakeSupabaseClient([]);
  const result = await reconcileStuckPremiumJob(client, job, async () => ({ ok: true }));
  assert.equal(result.action, "needs_manual_review");
  assert.deepEqual(client.calls, [], "must never write anything automatically for an unsettled real success");
});

test("reconcileStuckPremiumJob: an already-settled job is a true no-op", async () => {
  const job = { id: "job-1", status: "completed", plan: [] };
  const client = createFakeSupabaseClient([]);
  const result = await reconcileStuckPremiumJob(client, job, async () => ({ ok: true }));
  assert.equal(result.action, "none");
  assert.deepEqual(client.calls, []);
});

test("PREMIUM_JOB_MAX_ATTEMPTS is a real, finite cap — Retry must not be allowed to re-spend indefinitely", () => {
  assert.equal(typeof PREMIUM_JOB_MAX_ATTEMPTS, "number");
  assert.ok(PREMIUM_JOB_MAX_ATTEMPTS >= 1 && PREMIUM_JOB_MAX_ATTEMPTS <= 5);
});

test("findLatestPremiumJobForContentItem (Part J): finds the shop's most recent job for a content item REGARDLESS of status, for an explicit Retry to continue", async () => {
  const client = createFakeSupabaseClient([
    {
      data: [
        { id: "job-2", status: "failed", result: { content_item_id: "item-1" } },
        { id: "job-1", status: "completed", result: { content_item_id: "item-other" } }
      ],
      error: null
    }
  ]);
  const result = await findLatestPremiumJobForContentItem(client, { shopId: "shop-1", contentItemId: "item-1" });
  assert.equal(result.ok, true);
  assert.equal(result.job.id, "job-2");
});

test("invokePremiumCreativeBackgroundFunction fails closed (never throws, never crashes the caller) when unconfigured", async () => {
  const result = await invokePremiumCreativeBackgroundFunction({ jobId: "job-1", env: {} });
  assert.equal(result.ok, false);
  assert.match(result.error, /not configured/);
});

test("invokePremiumCreativeBackgroundFunction posts the job id with the shared secret header when configured", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 202 };
  };
  const result = await invokePremiumCreativeBackgroundFunction({
    jobId: "job-1",
    env: { URL: "https://example.netlify.app", MARKETING_PREMIUM_JOB_SECRET: "s3cret" },
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/\.netlify\/functions\/marketing-premium-creative-background$/);
  assert.equal(calls[0].options.headers["X-Premium-Job-Secret"], "s3cret");
  assert.deepEqual(JSON.parse(calls[0].options.body), { jobId: "job-1" });
});

test("invokePremiumCreativeBackgroundFunction never throws even if the fetch itself rejects — the synchronous caller must never crash on an enqueue failure", async () => {
  const fetchImpl = async () => {
    throw new Error("network unreachable");
  };
  const result = await invokePremiumCreativeBackgroundFunction({
    jobId: "job-1",
    env: { URL: "https://example.netlify.app", MARKETING_PREMIUM_JOB_SECRET: "s3cret" },
    fetchImpl
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /network unreachable/);
});
