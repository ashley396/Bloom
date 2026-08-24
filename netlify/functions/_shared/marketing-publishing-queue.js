/**
 * Reliable-publishing queue mechanics — Section 24 of the build directive.
 * Pure functions only; marketing-studio.js is the only caller that touches
 * the database (marketing_publishing_jobs / marketing_platform_variants).
 *
 * The one thing every function here has to get right today: EVERY real
 * publish attempt currently fails, because zero social platform adapters
 * are live (see marketing-social-providers.js). That failure must never
 * be treated as a transient blip to retry-loop forever against — it's a
 * structural "no provider connected" state that only changes when a human
 * connects one. classifyPublishFailure() is what keeps the queue from
 * spinning uselessly: a not-live failure settles once, doesn't retry.
 */

import { SOCIAL_NOT_LIVE } from "./marketing-social-providers.js";
import { determineDisclosureRequirement } from "./creative-ai/disclosure-policy.js";

export const PUBLISH_FAILURE_KINDS = Object.freeze(["not_live", "transient", "fatal"]);

const BASE_BACKOFF_SECONDS = 60; // 1 minute
const MAX_BACKOFF_SECONDS = 6 * 60 * 60; // 6 hours

/** Exponential backoff with a cap — attempt 1 -> 1min, 2 -> 2min, 3 -> 4min, ... capped at 6h. */
export function computeBackoffSeconds(attempt) {
  const n = Math.max(1, Number(attempt) || 1);
  return Math.min(MAX_BACKOFF_SECONDS, BASE_BACKOFF_SECONDS * 2 ** (n - 1));
}

/** Classifies why a publish attempt failed, so the queue knows whether to
 * retry, give up immediately, or wait indefinitely for a human to act.
 * Never guesses — an error with no recognizable shape is treated as
 * transient (the safe default: retry a bounded number of times rather
 * than silently dropping it). */
export function classifyPublishFailure(error) {
  if (error?.code === SOCIAL_NOT_LIVE) return "not_live";
  const status = Number(error?.statusCode);
  if (status === 400 || status === 422) return "fatal"; // bad media/content — retrying won't fix it
  return "transient";
}

/**
 * Given a job's current attempt count and a failure classification,
 * decides the job's next state. Never mutates — returns a plain
 * description the caller applies to the row.
 *
 * - not_live: settle to 'failed' immediately. No backoff loop against a
 *   provider that structurally doesn't exist yet — re-enqueuing happens
 *   explicitly (once a platform is connected), not via blind retry.
 * - fatal: settle to 'failed' immediately — the content itself needs a
 *   human fix, not a retry.
 * - transient: retry with exponential backoff until max_attempts, then
 *   dead_letter (Section 24: never silently lose a post — dead_letter is
 *   a visible, actionable state, not a silent drop).
 */
export function nextJobStateAfterFailure({ attempts, maxAttempts, kind }) {
  const nextAttempts = attempts + 1;
  if (kind === "not_live" || kind === "fatal") {
    return { status: "failed", attempts: nextAttempts, delaySeconds: null };
  }
  if (nextAttempts >= maxAttempts) {
    return { status: "dead_letter", attempts: nextAttempts, delaySeconds: null };
  }
  return { status: "queued", attempts: nextAttempts, delaySeconds: computeBackoffSeconds(nextAttempts) };
}

/** A job is due for processing when it's queued and its next_attempt_at
 * has arrived. Jobs in every other status (running/succeeded/failed/
 * dead_letter/canceled) are never picked up automatically. */
export function isJobDue(job, now = new Date()) {
  if (!job || job.status !== "queued") return false;
  const nextAttemptAt = job.next_attempt_at ? new Date(job.next_attempt_at) : null;
  if (!nextAttemptAt || Number.isNaN(nextAttemptAt.getTime())) return false;
  return nextAttemptAt.getTime() <= now.getTime();
}

/** Deterministic idempotency key for a variant's publish job — a variant
 * only ever has ONE active job lineage, so re-running plan/approve never
 * creates a duplicate queued job for the same piece of content. */
export function buildIdempotencyKey(variantId) {
  return `variant:${variantId}`;
}

/**
 * AI-disclosure requirement (Section 21/40) — a thin, single-flag
 * convenience wrapper for callers that only know "was this AI-generated
 * at all" and not which specific capability (avatar/voice/video/image)
 * produced it. Launch-blocker fix (Blocker 1): this used to maintain its
 * own hardcoded 3-platform allowlist (Meta + TikTok only), which quietly
 * disagreed with disclosure-policy.js's real per-platform policy table —
 * the audit's "parallel disclosure logic" finding. There is now exactly
 * ONE authoritative disclosure decision in the codebase:
 * determineDisclosureRequirement() in disclosure-policy.js. This function
 * delegates to it rather than re-deciding anything itself — which AI
 * flag gets set doesn't matter for the boolean `required` result, since
 * determineDisclosureRequirement() only checks whether ANY AI-trigger
 * flag is true.
 */
export function requiresAiDisclosure(platform, wasAiGenerated) {
  if (!wasAiGenerated) return false;
  const determination = determineDisclosureRequirement({ platform, generativeImageUsed: true });
  return Boolean(determination.required);
}
