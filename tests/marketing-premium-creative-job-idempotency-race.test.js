import test from "node:test";
import assert from "node:assert/strict";
import { createRacyFakeSupabaseClient } from "./helpers/racy-fake-supabase-client.mjs";
import {
  createOrContinuePremiumJob,
  buildPlannedAttemptStep,
  addPremiumJobAttempt,
  claimPremiumJobForExecution,
  settlePremiumJobFailed,
  PREMIUM_JOB_MAX_ATTEMPTS,
  buildPremiumIdempotencyKey,
  buildPremiumOperationId,
  uuidV5
} from "../netlify/functions/_shared/marketing-premium-creative-job.js";
import { reservePremiumCreativeGeneration } from "../netlify/functions/_shared/marketing-premium-creative-orchestrator.js";
import { reserveProviderCall } from "../netlify/functions/_shared/marketing-provider-usage.js";

// Hybrid Marketing Studio Batch 4.1 ("close the premium job idempotency
// race") — these tests use createRacyFakeSupabaseClient (a real, if
// tiny, in-memory store enforcing the SAME partial unique constraints
// the real migration adds), NOT the ordinary scripted-response fake
// client — see that helper's own doc for exactly why a sequential
// find-then-insert mock cannot prove anything about a real race.

const STAGING_OPENAI_ENV = Object.freeze({ FLORISYN_ENV: "staging", OPENAI_API_KEY: "sk-test-not-a-real-key" });
const CANONICAL_CONCEPT = Object.freeze({
  occasionCategory: "everyday_floral",
  sympathyClassification: "not_sympathy",
  promotionIntent: "not_promotion",
  factRequirements: [],
  objective: "sell",
  creativeFamily: "designed_flyer"
});
const CREATIVE_DIRECTION = Object.freeze({
  compositionFamily: "photo_dominant",
  imageScale: "dominant",
  paletteMood: "soft_pastel",
  visualMood: "bright_joyful",
  typographyPersonality: "clean_sans",
  ornamentalDensity: "light"
});
const FACT_SAFE_COPY_PLAN = Object.freeze({ headline: "Spring is here!", body: "Fresh seasonal blooms, arranged with care.", cta: "Order now" });
const VERIFIED_SHOP_BRAND_DATA = Object.freeze({ name: "Lilies in Bloom" });

/** Mirrors exactly what marketing-studio.js's premium branch does for
 * ONE logical request: create-or-continue the job, and (only when this
 * request actually owns a fresh attempt) reserve usage and append it.
 * Returns enough to assert every Part 8 invariant without needing to
 * drive the entire generate_content pipeline twice concurrently. */
async function simulatePremiumGenerateRequest(client, { shopId, contentItemId, userId = "user-1" }) {
  const jobResult = await createOrContinuePremiumJob(client, { shopId, userId, contentItemId, title: "Everyday post", traceId: "trace-1" });
  if (!jobResult.ok) return { ok: false, error: jobResult.error };
  if (jobResult.mode === "active_duplicate" || jobResult.mode === "already_completed") {
    return { ok: true, mode: jobResult.mode, jobId: jobResult.job.id, dispatched: false };
  }
  if (jobResult.mode === "max_attempts_reached") {
    return { ok: true, mode: jobResult.mode, jobId: jobResult.job.id, dispatched: false };
  }
  const reserved = await reservePremiumCreativeGeneration({
    client,
    shopId,
    contentItemId,
    jobId: jobResult.job.id,
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    factSafeCopyPlan: FACT_SAFE_COPY_PLAN,
    verifiedShopBrandData: VERIFIED_SHOP_BRAND_DATA,
    aspectRatio: "1:1",
    traceId: "trace-1",
    attemptIndex: jobResult.attemptIndex,
    env: STAGING_OPENAI_ENV
  });
  if (!reserved.ok) {
    if (jobResult.mode === "fresh") await settlePremiumJobFailed(client, jobResult.job.id, { reason: reserved.diagnostic?.orchestrator?.reason || "reservation_failed" });
    return { ok: false, mode: jobResult.mode, jobId: jobResult.job.id, error: reserved.reason };
  }
  if (reserved.alreadyExisted) {
    return { ok: true, mode: jobResult.mode, jobId: reserved.jobId, dispatched: false, alreadyExisted: true };
  }
  const step = buildPlannedAttemptStep({ attemptIndex: jobResult.attemptIndex, reservationId: reserved.reservation.usageId });
  await addPremiumJobAttempt(client, jobResult.job.id, step, {});
  return { ok: true, mode: jobResult.mode, jobId: jobResult.job.id, usageId: reserved.reservation.usageId, dispatched: true };
}

test("Part 8 #1/#2/#3/#4: two simultaneous attempt-0 requests for the SAME content item produce exactly one job, exactly one reservation, both callers get the same job, and only one dispatches", async () => {
  const client = createRacyFakeSupabaseClient();
  const [a, b] = await Promise.all([
    simulatePremiumGenerateRequest(client, { shopId: "shop-1", contentItemId: "item-1" }),
    simulatePremiumGenerateRequest(client, { shopId: "shop-1", contentItemId: "item-1" })
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.jobId, b.jobId, "both callers must receive the SAME authoritative job — never two separate jobs for one content item");
  assert.equal(client._tables.ai_execution_jobs.size, 1, "exactly one job row must exist, even though two requests raced to create it");
  assert.equal(client._tables.marketing_generation_usage.size, 1, "exactly one usage reservation must exist — no double OpenAI spend");
  const dispatchedCount = [a, b].filter((r) => r.dispatched).length;
  assert.equal(dispatchedCount, 1, "exactly one of the two requests should proceed to dispatch the Background Function — the other must recognize the duplicate and do nothing further");
  const usageRow = [...client._tables.marketing_generation_usage.values()][0];
  assert.equal(usageRow.job_id, a.jobId, "the one real reservation must be linked to the one real job");
});

test("Part 8 #5: two worker executions for the same job atomically claim once — the second sees claimed:false and must never call the provider", async () => {
  const client = createRacyFakeSupabaseClient();
  client._tables.ai_execution_jobs.set("job-1", {
    id: "job-1",
    shop_id: "shop-1",
    job_type: "marketing_premium_creative_image",
    status: "planned",
    idempotency_key: buildPremiumIdempotencyKey("item-1", 0),
    plan: [{ id: "attempt-0", attempt_index: 0, usage_id: "usage-1", status: "planned" }],
    result: { content_item_id: "item-1" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  const [claimA, claimB] = await Promise.all([claimPremiumJobForExecution(client, "job-1"), claimPremiumJobForExecution(client, "job-1")]);
  const claimedCount = [claimA, claimB].filter((c) => c.claimed).length;
  assert.equal(claimedCount, 1, "exactly one worker invocation may win the planned->running claim");
  assert.equal(client._tables.ai_execution_jobs.get("job-1").status, "running");
});

test("Part 8 #6/#7: two simultaneous Retry requests for the same failed job create exactly one attempt-1 reservation, and attempt 0 / attempt 1 remain distinct", async () => {
  const client = createRacyFakeSupabaseClient();
  const attempt0UsageId = "usage-attempt0";
  client._tables.marketing_generation_usage.set(attempt0UsageId, {
    id: attempt0UsageId,
    shop_id: "shop-1",
    job_id: "job-1",
    provider: "openai",
    operation: "premium_creative_image",
    operation_id: buildPremiumOperationId("item-1", 0),
    attempt_index: 0,
    status: "failed"
  });
  client._tables.ai_execution_jobs.set("job-1", {
    id: "job-1",
    shop_id: "shop-1",
    job_type: "marketing_premium_creative_image",
    status: "failed",
    idempotency_key: buildPremiumIdempotencyKey("item-1", 0),
    plan: [{ id: "attempt-0", attempt_index: 0, usage_id: attempt0UsageId, status: "failed" }],
    result: { content_item_id: "item-1" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  async function simulateRetry() {
    const job = client._tables.ai_execution_jobs.get("job-1");
    const nextAttemptIndex = job.plan.length;
    const reserved = await reservePremiumCreativeGeneration({
      client,
      shopId: "shop-1",
      contentItemId: "item-1",
      jobId: "job-1",
      canonicalConcept: CANONICAL_CONCEPT,
      creativeDirection: CREATIVE_DIRECTION,
      factSafeCopyPlan: FACT_SAFE_COPY_PLAN,
      verifiedShopBrandData: VERIFIED_SHOP_BRAND_DATA,
      aspectRatio: "1:1",
      traceId: "retry-trace",
      attemptIndex: nextAttemptIndex,
      env: STAGING_OPENAI_ENV
    });
    if (!reserved.ok) return { ok: false };
    const step = buildPlannedAttemptStep({ attemptIndex: nextAttemptIndex, reservationId: reserved.reservation.usageId });
    await addPremiumJobAttempt(client, "job-1", step, {});
    return { ok: true, usageId: reserved.reservation.usageId, alreadyExisted: Boolean(reserved.alreadyExisted) };
  }

  const [retryA, retryB] = await Promise.all([simulateRetry(), simulateRetry()]);
  assert.equal(retryA.ok, true);
  assert.equal(retryB.ok, true);
  assert.equal(retryA.usageId, retryB.usageId, "both Retry clicks must resolve to the SAME single attempt-1 reservation");

  const attempt1Rows = [...client._tables.marketing_generation_usage.values()].filter((r) => r.attempt_index === 1);
  assert.equal(attempt1Rows.length, 1, "exactly one attempt-1 reservation must exist regardless of how many Retry clicks raced for it");

  const finalJob = client._tables.ai_execution_jobs.get("job-1");
  const attempt0Entries = finalJob.plan.filter((p) => p.attempt_index === 0);
  const attempt1Entries = finalJob.plan.filter((p) => p.attempt_index === 1);
  assert.equal(attempt0Entries.length, 1, "attempt-0's history must survive untouched");
  // Batch 4.2: addPremiumJobAttempt's own compare-and-swap now makes
  // this an EXACT invariant, not just "at least one" — see
  // marketing-premium-creative-job-plan-append-race.test.js for the
  // dedicated test exercising this specific mechanism directly.
  assert.equal(attempt1Entries.length, 1, "exactly one attempt-1 plan entry must exist — never a duplicate array entry even under two racing Retry clicks");
  assert.notEqual(attempt0Entries[0].usage_id, attempt1Entries[0].usage_id, "attempt 0 and attempt 1 must reference distinct usage rows");
});

test("Part 8 #8: a reservation failure on a FRESH job settles it failed rather than leaving an unrecoverable active job — a subsequent request can continue it", async () => {
  const client = createRacyFakeSupabaseClient();
  // No OPENAI_API_KEY / no FLORISYN_ENV: reservePremiumCreativeGeneration
  // fails closed at the environment guard, before ever reserving usage.
  const badEnv = {};
  const jobResult = await createOrContinuePremiumJob(client, { shopId: "shop-1", contentItemId: "item-1", title: "t" });
  assert.equal(jobResult.mode, "fresh");
  const reserved = await reservePremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    contentItemId: "item-1",
    jobId: jobResult.job.id,
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    factSafeCopyPlan: FACT_SAFE_COPY_PLAN,
    verifiedShopBrandData: VERIFIED_SHOP_BRAND_DATA,
    env: badEnv
  });
  assert.equal(reserved.ok, false);
  await settlePremiumJobFailed(client, jobResult.job.id, { reason: reserved.diagnostic?.orchestrator?.reason });
  assert.equal(client._tables.ai_execution_jobs.get(jobResult.job.id).status, "failed");

  // A subsequent request for the SAME content item must be able to
  // continue — never permanently blocked by the dead attempt-0 job.
  // nextAttemptIndex is derived from the job's own real plan LENGTH, not
  // from a counter — since the first reservation failed at the
  // environment guard BEFORE ever reaching reserveProviderCall (no usage
  // row, no plan entry was ever written), the job's plan is still
  // genuinely empty, so continuing at attemptIndex 0 is the honest,
  // correct answer here — attempt 0's operation_id was never actually
  // consumed, so reusing it is safe (see the distinct "Part 8 #6/#7"
  // test above for the case where attempt 0 DOES leave a real row and
  // continuation correctly advances to attempt 1 instead).
  const secondAttempt = await createOrContinuePremiumJob(client, { shopId: "shop-1", contentItemId: "item-1", title: "t" });
  assert.equal(secondAttempt.ok, true);
  assert.equal(secondAttempt.mode, "continue_failed", "the failed job must be recoverable via a new attempt, never orphaned forever");
  assert.equal(secondAttempt.attemptIndex, 0);
});

test("Part 8 #9: reserveProviderCall's existing non-Premium callers (no operationId) are completely unaffected by the new partial unique index", async () => {
  const client = createRacyFakeSupabaseClient();
  const [r1, r2] = await Promise.all([
    reserveProviderCall(client, { shopId: "shop-1", provider: "cloudflare", purpose: "image", operation: "image_generation" }),
    reserveProviderCall(client, { shopId: "shop-1", provider: "cloudflare", purpose: "image", operation: "image_generation" })
  ]);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true, "two ordinary Cloudflare reservations with no operationId must never conflict with each other");
  assert.equal(client._tables.marketing_generation_usage.size, 2, "both rows must be written — this migration's constraint only ever applies to non-null operation_id");
});

test("uuidV5 matches Postgres's own uuid_generate_v5() output for the same (name, namespace) — proven directly against the real staging database", () => {
  // Cross-checked live: `select uuid_generate_v5('6f1c1c1a-8b1e-4e6a-9d1a-2f6b9c7a4e10'::uuid, 'premium_creative:item-1:0')`
  // on the real staging Postgres (lnarliipmqimkpdoitoa) returned exactly
  // this value — pinned here so this module's own deterministic UUID
  // derivation can never silently drift from what Postgres itself would
  // compute for the same inputs.
  const result = uuidV5("premium_creative:item-1:0", "6f1c1c1a-8b1e-4e6a-9d1a-2f6b9c7a4e10");
  assert.equal(result, "b08a5a52-9792-5a8c-97eb-302211645d64");
});

test("buildPremiumOperationId is a stable, deterministic function of (contentItemId, attemptIndex) — never random, and attempt 0 vs 1 never collide", () => {
  const a0 = buildPremiumOperationId("item-1", 0);
  const a0Again = buildPremiumOperationId("item-1", 0);
  const a1 = buildPremiumOperationId("item-1", 1);
  const otherItem = buildPremiumOperationId("item-2", 0);
  assert.equal(a0, a0Again, "the same content item + attempt must always derive the identical operation_id");
  assert.notEqual(a0, a1, "attempt 0 and attempt 1 must never derive the same operation_id");
  assert.notEqual(a0, otherItem, "two different content items must never derive the same operation_id");
  assert.match(a0, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "must be a syntactically valid RFC4122 v5 UUID");
});

test("PREMIUM_JOB_MAX_ATTEMPTS caps createOrContinuePremiumJob's own continuation, independent of any single request's own view of the job", async () => {
  const client = createRacyFakeSupabaseClient();
  client._tables.ai_execution_jobs.set("job-1", {
    id: "job-1",
    shop_id: "shop-1",
    job_type: "marketing_premium_creative_image",
    status: "failed",
    idempotency_key: buildPremiumIdempotencyKey("item-1", 0),
    plan: Array.from({ length: PREMIUM_JOB_MAX_ATTEMPTS }, (_, i) => ({ id: `attempt-${i}`, attempt_index: i, status: "failed" })),
    result: { content_item_id: "item-1" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  const result = await createOrContinuePremiumJob(client, { shopId: "shop-1", contentItemId: "item-1", title: "t" });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "max_attempts_reached");
});
