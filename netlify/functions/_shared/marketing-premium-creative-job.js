/**
 * Premium AI Creative — durable async job model (Hybrid Marketing Studio
 * Batch 4, "async job architecture").
 *
 * REAL PROVEN FAILURE THIS EXISTS TO FIX: a real staging Premium Creative
 * request 504'd (Netlify's own synchronous Function execution limit is
 * shorter than GPT-Image-2's real generation latency, especially stacked
 * behind the ~7s of grounding/copy/routing work generate_content already
 * does first). The florist saw "Request failed (504)", retried three
 * times, and ended up with three orphaned content items (stuck at
 * "generating" forever) and three orphaned OpenAI usage reservations
 * (stuck at "estimated" forever) — see docs on Batch 4's own
 * investigation for the full trace.
 *
 * Reuses the EXISTING ai_execution_jobs table (created in
 * 20260820020000_ai_operating_system_v1.sql for exactly this shape: a
 * multi-step AI task with real execution state) — no new table, no
 * migration. Every Premium-specific detail lives inside that table's own
 * existing jsonb columns (`plan`, `result`) rather than new columns:
 *
 *   job_type = PREMIUM_JOB_TYPE
 *   status   = 'planned' | 'running' | 'completed' | 'failed'
 *              (the table's own existing enum — 'waiting_for_user' /
 *              'waiting_for_approval' / 'partially_completed' are real
 *              values this job type simply never uses)
 *   plan     = [ { id, tool, attempt_index, status, usage_id, marker,
 *                  result, error, started_at, finished_at }, ... ]
 *              — one entry per ATTEMPT (a Retry per Part J appends a new
 *              entry rather than overwriting attempt-0's history; the
 *              job itself stays the one durable record of "this content
 *              item's premium generation," across every attempt).
 *   result   = { content_item_id, trace_id, canonical_concept,
 *                creative_direction, fact_safe_copy_plan,
 *                verified_shop_brand_data, aspect_ratio, quality_tier,
 *                filename, asset_id, background_image_url }
 *              — everything a SEPARATE process (the Background Function)
 *              needs to finish this job, since it shares no memory with
 *              the synchronous request that created it. No secret ever
 *              lives here (no API key, no auth header, no session token).
 *
 * marketing_generation_usage.job_id already has a real FK to this table
 * (added well before this batch) — every Premium reservation now uses it,
 * closing the exact gap Part A/G called out.
 *
 * Batch 4.1 ("close the premium job idempotency race"): the original
 * findActivePremiumJobForContentItem() -> createPremiumJob() sequence
 * was a plain check-then-insert with a real TOCTOU window — two
 * concurrent requests for the same content item could both observe "no
 * active job" and both create their own job + reservation (proven by
 * direct schema inspection: ai_execution_jobs had no unique constraint
 * beyond `id`). This is now closed with a DATABASE-ENFORCED deterministic
 * idempotency key (see 20260904000000_premium_creative_job_idempotency.sql):
 *
 *   ai_execution_jobs.idempotency_key (new column, partial unique index)
 *     = buildPremiumIdempotencyKey(contentItemId, attemptIndex)
 *     = "premium_creative:<content_item_id>:<attempt_index>"
 *
 *   marketing_generation_usage.operation_id (existing column, uuid —
 *   narrower partial unique index added alongside the existing one)
 *     = buildPremiumOperationId(contentItemId, attemptIndex), a
 *       deterministic RFC4122 v5 UUID derived from that SAME string
 *       (operation_id is uuid-typed, so the literal string can't be
 *       stored directly).
 *
 * createOrContinuePremiumJob() is the one authoritative create-or-get
 * entry point marketing-studio.js now calls instead of the old two-step
 * check-then-insert — the database conflict, not a client-side read, is
 * what makes "at most one active job/reservation per content item
 * attempt" true under real concurrency.
 */

import crypto from "node:crypto";
import { classifyDatabaseErrorCode } from "./marketing-provider-usage.js";

export const PREMIUM_JOB_TYPE = "marketing_premium_creative_image";

// A fixed, arbitrary namespace UUID for this codebase's own deterministic
// v5 UUIDs — never meant to resolve to anything; it just needs to stay
// constant so the same (name) always derives the same UUID. Matches
// RFC4122 exactly (verified byte-for-byte against Postgres's own
// uuid_generate_v5() on the same inputs — see this module's own tests).
const PREMIUM_OPERATION_NAMESPACE = "6f1c1c1a-8b1e-4e6a-9d1a-2f6b9c7a4e10";

/**
 * A pure RFC4122 version-5 (SHA-1, namespace-based) UUID — deterministic:
 * the same (name, namespaceUuid) pair always produces the same UUID, with
 * no randomness and no database round trip. Used to derive a valid
 * uuid-typed `operation_id` from a literal idempotency-key string this
 * codebase already builds elsewhere (marketing_generation_usage.operation_id
 * cannot hold an arbitrary string directly). Exported so its correctness
 * can be tested directly against Postgres's own uuid_generate_v5() output
 * for the same inputs, rather than trusted on faith.
 */
export function uuidV5(name, namespaceUuid) {
  const namespaceBytes = Buffer.from(String(namespaceUuid).replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(String(name), "utf8");
  const hash = crypto.createHash("sha1").update(Buffer.concat([namespaceBytes, nameBytes])).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The one literal identity string for "this content item's Premium
 * generation attempt N" — never a random value (Part 1: "Do not use a
 * random value as the idempotency key"). Stored verbatim in
 * ai_execution_jobs.idempotency_key. */
export function buildPremiumIdempotencyKey(contentItemId, attemptIndex = 0) {
  return `premium_creative:${contentItemId}:${attemptIndex}`;
}

/** The SAME logical identity, represented as a valid UUID for
 * marketing_generation_usage.operation_id (uuid-typed) — always exactly
 * uuidV5(buildPremiumIdempotencyKey(...), PREMIUM_OPERATION_NAMESPACE),
 * so the job-level and reservation-level idempotency keys can never
 * silently drift apart for the same logical attempt. */
export function buildPremiumOperationId(contentItemId, attemptIndex = 0) {
  return uuidV5(buildPremiumIdempotencyKey(contentItemId, attemptIndex), PREMIUM_OPERATION_NAMESPACE);
}

// Only these two of ai_execution_jobs' own real status values are ever
// "in flight" for this job type — used both for the idempotency query
// (Part B) and the recovery classifier below.
export const PREMIUM_JOB_ACTIVE_STATUSES = Object.freeze(["planned", "running"]);

// Part J: no existing "max retry" limit anywhere in this codebase applies
// to a paid, per-attempt OpenAI image spend, so this is a new, deliberately
// conservative cap — at most 2 real provider attempts total per content
// item (attempt_index 0 and 1). An explicit user Retry beyond that is
// refused rather than silently allowed to keep re-spending; a florist who
// needs a third try starts a fresh content item instead.
export const PREMIUM_JOB_MAX_ATTEMPTS = 2;

// Part E/F: the honest states a hard process death can leave a Premium
// job's LATEST attempt in — derived purely from what's already durably
// persisted, never guessed. Exported so both the Background Function and
// any future reconciliation code (Part H) share one vocabulary.
export const PREMIUM_JOB_RECOVERY_STATES = Object.freeze({
  // A usage reservation exists (or the job itself is merely 'planned'
  // with no attempt yet started) but provider.generate() was never
  // entered — safe to release/fail the reservation; no spend occurred.
  RESERVED_NOT_STARTED: "reserved_not_started",
  // provider.generate() was entered and never finished (no result_ok
  // recorded) — genuinely unknown whether OpenAI was ever reached or
  // billed. MUST NOT be treated as free, MUST NOT be treated as charged.
  PROVIDER_STARTED_UNKNOWN_RESULT: "provider_started_unknown_result",
  // The provider call finished with a known failure.
  PROVIDER_FAILED: "provider_failed",
  // The provider call finished with a known success, but the job hasn't
  // reached 'completed' yet (e.g. died between success and asset
  // persistence/usage settlement).
  PROVIDER_SUCCEEDED: "provider_succeeded",
  // The job's own status is 'completed' — fully settled, asset persisted,
  // usage reconciled.
  SETTLED: "settled"
});

function nowIso() {
  return new Date().toISOString();
}

function latestAttempt(job) {
  const plan = Array.isArray(job?.plan) ? job.plan : [];
  return plan.length ? plan[plan.length - 1] : null;
}

/** Part E/F: pure — never queries anything, only reads what's already on
 * the job row. This is the ONE place "what actually happened" is decided
 * for a Premium job that didn't finish normally. */
export function classifyPremiumJobRecoveryState(job) {
  if (!job) return null;
  if (job.status === "completed") return PREMIUM_JOB_RECOVERY_STATES.SETTLED;
  const attempt = latestAttempt(job);
  if (!attempt) return PREMIUM_JOB_RECOVERY_STATES.RESERVED_NOT_STARTED;
  const marker = attempt.marker || null;
  if (!marker || !marker.provider_generate_entered) return PREMIUM_JOB_RECOVERY_STATES.RESERVED_NOT_STARTED;
  if (marker.provider_result_ok === true) return PREMIUM_JOB_RECOVERY_STATES.PROVIDER_SUCCEEDED;
  if (marker.provider_result_ok === false) return PREMIUM_JOB_RECOVERY_STATES.PROVIDER_FAILED;
  return PREMIUM_JOB_RECOVERY_STATES.PROVIDER_STARTED_UNKNOWN_RESULT;
}

/**
 * Part B idempotency: the shop's own already-active Premium job for this
 * exact content item, if one exists. Filtered client-side on
 * `result.content_item_id` rather than a Postgres JSONB containment
 * operator — at Florisyn's real volume (~90 pieces/month per shop) a
 * shop has at most a small handful of active jobs at once, so this stays
 * fast without needing a new indexed column or a query operator the
 * disposable-Postgres test harness would need to additionally support.
 */
export async function findActivePremiumJobForContentItem(client, { shopId, contentItemId }) {
  if (!shopId || !contentItemId) return { ok: false, job: null, error: "findActivePremiumJobForContentItem requires shopId and contentItemId." };
  try {
    const result = await client
      .from("ai_execution_jobs")
      .select("*")
      .eq("shop_id", shopId)
      .eq("job_type", PREMIUM_JOB_TYPE)
      .in("status", PREMIUM_JOB_ACTIVE_STATUSES);
    if (result.error) return { ok: false, job: null, error: result.error.message };
    const rows = Array.isArray(result.data) ? result.data : [];
    const match = rows.find((row) => row?.result?.content_item_id === contentItemId) || null;
    return { ok: true, job: match };
  } catch (error) {
    return { ok: false, job: null, error: String(error?.message || error).slice(0, 300) };
  }
}

/**
 * Part J: the shop's own most recent Premium job for this content item,
 * REGARDLESS of status — unlike findActivePremiumJobForContentItem above,
 * this is how an explicit Retry finds the failed job it's continuing
 * (appending attempt_index 1 onto), not whether one is currently in
 * flight. Same client-side filter reasoning as the active-only lookup.
 */
export async function findLatestPremiumJobForContentItem(client, { shopId, contentItemId }) {
  if (!shopId || !contentItemId) return { ok: false, job: null, error: "findLatestPremiumJobForContentItem requires shopId and contentItemId." };
  try {
    const result = await client
      .from("ai_execution_jobs")
      .select("*")
      .eq("shop_id", shopId)
      .eq("job_type", PREMIUM_JOB_TYPE)
      .order("created_at", { ascending: false });
    if (result.error) return { ok: false, job: null, error: result.error.message };
    const rows = Array.isArray(result.data) ? result.data : [];
    const match = rows.find((row) => row?.result?.content_item_id === contentItemId) || null;
    return { ok: true, job: match };
  } catch (error) {
    return { ok: false, job: null, error: String(error?.message || error).slice(0, 300) };
  }
}

/**
 * Creates the durable job row itself (status 'planned', no attempts
 * yet). `context` carries everything a Background Function will need to
 * reconstruct the exact same request later — no secret, ever.
 *
 * Batch 4.1: the insert always carries a deterministic
 * `idempotency_key` (buildPremiumIdempotencyKey(contentItemId,
 * attemptIndex)) — the database's own partial unique index on that
 * column is what makes this call SAFE under real concurrency. A
 * duplicate-key conflict is NOT an error here: it means some other
 * request already won creating this exact attempt's job, so this call
 * loads and returns THAT row instead (`created: false`) — the caller
 * creates no second reservation and dispatches no second Background
 * Function invocation. Prefer createOrContinuePremiumJob() below for
 * the full create-or-get/continue-a-failed-attempt flow; this function
 * is the lower-level, single-attempt primitive it's built on.
 */
export async function createPremiumJob(client, { shopId, userId = null, contentItemId, title = "", traceId = null, attemptIndex = 0, context = {} }) {
  if (!shopId || !contentItemId) return { ok: false, job: null, created: false, error: "createPremiumJob requires shopId and contentItemId." };
  const idempotencyKey = buildPremiumIdempotencyKey(contentItemId, attemptIndex);
  try {
    const result = await client
      .from("ai_execution_jobs")
      .insert({
        shop_id: shopId,
        created_by: userId,
        persona: "Lily",
        job_type: PREMIUM_JOB_TYPE,
        title: String(title || "").slice(0, 200),
        status: "planned",
        plan: [],
        idempotency_key: idempotencyKey,
        result: { content_item_id: contentItemId, trace_id: traceId, ...context }
      })
      .select()
      .single();
    if (result.error) {
      if (classifyDatabaseErrorCode(result.error) === "duplicate") {
        // Part 3: the database conflict is the authoritative gate — load
        // and return the row that actually won, rather than erroring.
        const existing = await client.from("ai_execution_jobs").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
        if (existing.error) return { ok: false, job: null, created: false, error: existing.error.message };
        if (!existing.data) return { ok: false, job: null, created: false, error: "Premium job idempotency conflict, but the winning row could not be loaded." };
        return { ok: true, job: existing.data, created: false };
      }
      return { ok: false, job: null, created: false, error: result.error.message };
    }
    return { ok: true, job: result.data, created: true };
  } catch (error) {
    return { ok: false, job: null, created: false, error: String(error?.message || error).slice(0, 300) };
  }
}

/**
 * Part 3/4/6: the ONE authoritative create-or-get/continue entry point
 * marketing-studio.js calls for both a fresh "Ask Lily to create it"
 * click and an explicit Retry — replacing the old, race-prone
 * "findActivePremiumJobForContentItem() then createPremiumJob()"
 * sequence with a single call whose correctness rests on the database's
 * own unique index, not on client-side timing.
 *
 * Returns one of five `mode`s:
 *   "fresh"              — a brand-new attempt-0 job was created. Caller
 *                           proceeds to reserve usage, add the attempt,
 *                           and dispatch the Background Function.
 *   "active_duplicate"   — a concurrent/duplicate request already has an
 *                           active (planned/running) job for this exact
 *                           attempt. Caller returns the pending response
 *                           referencing it; creates nothing new.
 *   "continue_failed"    — the existing job for this content item is
 *                           terminal-failed with room left under
 *                           PREMIUM_JOB_MAX_ATTEMPTS. Caller reserves a
 *                           NEW attempt (attemptIndex = job.plan.length)
 *                           onto this SAME job — covers both an explicit
 *                           Retry and an ordinary "Generate" click after
 *                           the content item was reverted to 'idea'
 *                           following a real failure; either way it is
 *                           still, correctly, the same one job.
 *   "max_attempts_reached" — the existing job is terminal-failed with no
 *                           attempts left. Caller falls through to Exact
 *                           Layout, never spends again.
 *   "already_completed"  — the existing job already succeeded. Should not
 *                           normally be reachable (a completed job means
 *                           the content item is no longer 'idea'), kept
 *                           as a defensive, honest fallback rather than a
 *                           crash.
 */
export async function createOrContinuePremiumJob(client, { shopId, userId = null, contentItemId, title = "", traceId = null, context = {} }) {
  const created = await createPremiumJob(client, { shopId, userId, contentItemId, title, traceId, attemptIndex: 0, context });
  if (!created.ok) return { ok: false, mode: null, job: null, attemptIndex: null, error: created.error };
  if (created.created) return { ok: true, mode: "fresh", job: created.job, attemptIndex: 0 };

  // Lost the create race (or this content item already has a job from an
  // earlier attempt) — decide what "continuing" means from the winning
  // row's own real, durable status.
  const job = created.job;
  if (PREMIUM_JOB_ACTIVE_STATUSES.includes(job.status)) {
    return { ok: true, mode: "active_duplicate", job, attemptIndex: null };
  }
  if (job.status === "completed") {
    return { ok: true, mode: "already_completed", job, attemptIndex: null };
  }
  // status === "failed": room for another attempt?
  const nextAttemptIndex = Array.isArray(job.plan) ? job.plan.length : 0;
  if (nextAttemptIndex >= PREMIUM_JOB_MAX_ATTEMPTS) {
    return { ok: true, mode: "max_attempts_reached", job, attemptIndex: null };
  }
  return { ok: true, mode: "continue_failed", job, attemptIndex: nextAttemptIndex };
}

/** One fresh 'planned' attempt entry — appended to the job's `plan`
 * array, never overwriting a prior attempt's history (Part J). */
export function buildPlannedAttemptStep({ attemptIndex, reservationId }) {
  return {
    id: `attempt-${attemptIndex}`,
    tool: "premium_creative_image",
    attempt_index: attemptIndex,
    status: "planned",
    usage_id: reservationId,
    marker: null,
    result: null,
    error: null,
    started_at: null,
    finished_at: null
  };
}

/**
 * Appends a new attempt step to the job's plan. Also merges any
 * additional job-level context (e.g. the real canonicalConcept/
 * creativeDirection/factSafeCopyPlan a Background Function will need)
 * into `result`.
 *
 * Batch 4.1: idempotent against `step.attempt_index` already being
 * present — this fetch-modify-write is no longer the SOLE guard against
 * a duplicate attempt (the reservation-level operation_id unique index
 * is the authoritative one — see createOrContinuePremiumJob's own doc),
 * but two callers racing to continue the SAME failed job could still
 * both compute the identical next attemptIndex before either writes; if
 * the job's plan already has an entry for that attempt_index, this is a
 * safe no-op that returns the job as-is rather than appending a second,
 * duplicate array entry for what the reservation layer already resolved
 * down to one real usage row.
 */
export async function addPremiumJobAttempt(client, jobId, step, { context = {} } = {}) {
  if (!jobId) return { ok: false, job: null, error: "addPremiumJobAttempt requires jobId." };
  try {
    const current = await client.from("ai_execution_jobs").select("plan,result").eq("id", jobId).maybeSingle();
    if (current.error) return { ok: false, job: null, error: current.error.message };
    if (!current.data) return { ok: false, job: null, error: "Premium job not found." };
    const existingPlan = Array.isArray(current.data.plan) ? current.data.plan : [];
    if (existingPlan.some((entry) => entry?.attempt_index === step.attempt_index)) {
      return { ok: true, job: { ...current.data, id: jobId }, alreadyAppended: true };
    }
    const plan = [...existingPlan, step];
    const nextResult = { ...(current.data.result || {}), ...context };
    const result = await client.from("ai_execution_jobs").update({ plan, result: nextResult, status: "planned" }).eq("id", jobId).select().single();
    if (result.error) return { ok: false, job: null, error: result.error.message };
    return { ok: true, job: result.data, alreadyAppended: false };
  } catch (error) {
    return { ok: false, job: null, error: String(error?.message || error).slice(0, 300) };
  }
}

/**
 * Part D idempotency: the SAME proven atomic-UPDATE-WHERE pattern
 * marketing-studio.js's own content-item claim already uses (see its own
 * doc there) — whichever invocation's UPDATE actually lands first is the
 * only one that can ever see its own row come back. A second (or Nth)
 * concurrent/retried Background Function invocation for the SAME job_id
 * gets `claimed:false` and MUST NOT call the provider a second time.
 */
export async function claimPremiumJobForExecution(client, jobId) {
  if (!jobId) return { ok: false, claimed: false, job: null, error: "claimPremiumJobForExecution requires jobId." };
  try {
    const result = await client.from("ai_execution_jobs").update({ status: "running" }).eq("id", jobId).eq("status", "planned").select("*");
    if (result.error) return { ok: false, claimed: false, job: null, error: result.error.message };
    if (!result.data || result.data.length !== 1) return { ok: true, claimed: false, job: null };
    return { ok: true, claimed: true, job: result.data[0] };
  } catch (error) {
    return { ok: false, claimed: false, job: null, error: String(error?.message || error).slice(0, 300) };
  }
}

/** Part E: the durable pre-call marker, committed to the job's LATEST
 * attempt BEFORE the outbound fetch to OpenAI. Read-modify-write is safe
 * here because it only ever runs from inside the SAME invocation that
 * just won claimPremiumJobForExecution()'s atomic claim above — no other
 * writer can be touching this job's `plan` concurrently. */
export async function markPremiumAttemptProviderStarting(client, jobId, marker) {
  if (!jobId) return { ok: false, job: null, error: "markPremiumAttemptProviderStarting requires jobId." };
  try {
    const current = await client.from("ai_execution_jobs").select("plan").eq("id", jobId).maybeSingle();
    if (current.error) return { ok: false, job: null, error: current.error.message };
    const plan = Array.isArray(current.data?.plan) ? [...current.data.plan] : [];
    if (!plan.length) return { ok: false, job: null, error: "Premium job has no attempt to mark." };
    const idx = plan.length - 1;
    plan[idx] = {
      ...plan[idx],
      status: "running",
      started_at: nowIso(),
      marker: { ...marker, provider_generate_entered: true, provider_request_started_at: nowIso(), provider_request_finished_at: null }
    };
    const result = await client.from("ai_execution_jobs").update({ plan }).eq("id", jobId).select().single();
    if (result.error) return { ok: false, job: null, error: result.error.message };
    return { ok: true, job: result.data };
  } catch (error) {
    return { ok: false, job: null, error: String(error?.message || error).slice(0, 300) };
  }
}

/** Part E: the "provider call finished" marker — merged onto whatever
 * markPremiumAttemptProviderStarting already wrote, never replacing it
 * (provider_request_started_at survives). */
export async function markPremiumAttemptProviderFinished(client, jobId, markerUpdates) {
  if (!jobId) return { ok: false, job: null, error: "markPremiumAttemptProviderFinished requires jobId." };
  try {
    const current = await client.from("ai_execution_jobs").select("plan").eq("id", jobId).maybeSingle();
    if (current.error) return { ok: false, job: null, error: current.error.message };
    const plan = Array.isArray(current.data?.plan) ? [...current.data.plan] : [];
    if (!plan.length) return { ok: false, job: null, error: "Premium job has no attempt to mark." };
    const idx = plan.length - 1;
    plan[idx] = { ...plan[idx], marker: { ...(plan[idx].marker || {}), ...markerUpdates, provider_request_finished_at: nowIso() } };
    const result = await client.from("ai_execution_jobs").update({ plan }).eq("id", jobId).select().single();
    if (result.error) return { ok: false, job: null, error: result.error.message };
    return { ok: true, job: result.data };
  } catch (error) {
    return { ok: false, job: null, error: String(error?.message || error).slice(0, 300) };
  }
}

/** Settles a job as fully completed — the ONE state Part G's entitlement
 * count (see countPremiumDesignsUsedThisMonth) actually counts. */
export async function settlePremiumJobCompleted(client, jobId, { assetId, backgroundImageUrl }) {
  if (!jobId) return { ok: false, job: null, error: "settlePremiumJobCompleted requires jobId." };
  try {
    const current = await client.from("ai_execution_jobs").select("plan,result").eq("id", jobId).maybeSingle();
    if (current.error) return { ok: false, job: null, error: current.error.message };
    const plan = Array.isArray(current.data?.plan) ? [...current.data.plan] : [];
    if (plan.length) {
      const idx = plan.length - 1;
      plan[idx] = { ...plan[idx], status: "completed", finished_at: nowIso(), result: { asset_id: assetId, background_image_url: backgroundImageUrl } };
    }
    const nextResult = { ...(current.data?.result || {}), asset_id: assetId, background_image_url: backgroundImageUrl };
    const result = await client.from("ai_execution_jobs").update({ plan, result: nextResult, status: "completed", error: null }).eq("id", jobId).select().single();
    if (result.error) return { ok: false, job: null, error: result.error.message };
    return { ok: true, job: result.data };
  } catch (error) {
    return { ok: false, job: null, error: String(error?.message || error).slice(0, 300) };
  }
}

/** Settles a job's LATEST attempt (and the job itself, unless the caller
 * says a further Retry is still expected) as failed. Never marks
 * 'completed' — a failed attempt must never count as a used Premium
 * Design (Part G). */
export async function settlePremiumJobFailed(client, jobId, { reason = null, jobStatus = "failed" } = {}) {
  if (!jobId) return { ok: false, job: null, error: "settlePremiumJobFailed requires jobId." };
  try {
    const current = await client.from("ai_execution_jobs").select("plan").eq("id", jobId).maybeSingle();
    if (current.error) return { ok: false, job: null, error: current.error.message };
    const plan = Array.isArray(current.data?.plan) ? [...current.data.plan] : [];
    if (plan.length) {
      const idx = plan.length - 1;
      plan[idx] = { ...plan[idx], status: "failed", finished_at: nowIso(), error: reason };
    }
    const result = await client.from("ai_execution_jobs").update({ plan, status: jobStatus, error: reason }).eq("id", jobId).select().single();
    if (result.error) return { ok: false, job: null, error: result.error.message };
    return { ok: true, job: result.data };
  } catch (error) {
    return { ok: false, job: null, error: String(error?.message || error).slice(0, 300) };
  }
}

/**
 * Part H: staging-safe, targeted reconciliation for a job stuck in a
 * non-terminal recovery state (used both for the three known historical
 * staging rows and for any future stuck job a reconciliation pass finds).
 * Never fabricates actual_cost_cents, never marks provider_confirmed —
 * only ever moves a genuinely-unknown/unstarted attempt to an honest
 * terminal 'failed' state and fails the linked usage row the same way
 * a known provider failure already would.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {object} job - the real job row.
 * @param {(usageId: string, opts: object) => Promise<object>} failProviderCallFn -
 *   injected so this stays testable without a live DB (defaults to the
 *   real failProviderCall from marketing-provider-usage.js).
 */
export async function reconcileStuckPremiumJob(client, job, failProviderCallFn) {
  const state = classifyPremiumJobRecoveryState(job);
  if (state === PREMIUM_JOB_RECOVERY_STATES.SETTLED) return { ok: true, action: "none", state };
  if (state === PREMIUM_JOB_RECOVERY_STATES.PROVIDER_SUCCEEDED) {
    // A real success that never reached settlement — never invent a
    // fabricated asset here; a human must decide (Part H: "do not
    // fabricate actual_cost_cents, do not mark provider_confirmed").
    return { ok: true, action: "needs_manual_review", state };
  }
  const attempt = Array.isArray(job?.plan) && job.plan.length ? job.plan[job.plan.length - 1] : null;
  const usageId = attempt?.usage_id || null;
  const reason =
    state === PREMIUM_JOB_RECOVERY_STATES.PROVIDER_STARTED_UNKNOWN_RESULT
      ? "reconciliation_required_unknown_provider_result"
      : "reconciliation_reserved_never_started";
  if (usageId) {
    await failProviderCallFn(client, usageId, { error: reason, metadata: { reconciliation: true, reason } });
  }
  await settlePremiumJobFailed(client, job.id, { reason });
  return { ok: true, action: "settled_failed", state, reason, usageId };
}

/**
 * Part D: fire-and-forget invocation of the Premium Creative Background
 * Function. A real Netlify Background Function (file name suffixed
 * `-background`) responds 202 almost immediately and does its real work
 * out of band — this call is expected to be fast (enqueuing only, never
 * the actual OpenAI latency), so the synchronous generate_content request
 * can safely await it without risking a second 504.
 *
 * Never lets a failure to ENQUEUE crash the synchronous request: the job
 * row itself (status 'planned') is the durable source of truth, so if
 * this particular invocation attempt fails, the florist still sees an
 * honest "generating" state rather than a 500 — a future reconciliation
 * pass (Part H) is what catches a job that never got its worker fired.
 */
export async function invokePremiumCreativeBackgroundFunction({ jobId, env = process.env, fetchImpl = null }) {
  const doFetch = fetchImpl || globalThis.fetch;
  const baseUrl = String(env.URL || env.SITE_URL || "").replace(/\/$/, "");
  const secret = String(env.MARKETING_PREMIUM_JOB_SECRET || "").trim();
  if (!baseUrl || !secret || !doFetch) {
    return { ok: false, error: "Premium Creative Background Function is not configured (missing URL/secret)." };
  }
  try {
    await doFetch(`${baseUrl}/.netlify/functions/marketing-premium-creative-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Premium-Job-Secret": secret },
      body: JSON.stringify({ jobId })
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
}
