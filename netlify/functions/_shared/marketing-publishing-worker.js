/**
 * The real durable-scheduler execution engine (launch-blocker pass,
 * Blocker 3). marketing-publishing-queue.js is deliberately pure
 * functions only — this module is where the actual database-touching
 * claim + process loop lives, so BOTH callers use the exact same engine:
 *
 *   - marketing-studio.js's `run_publishing_queue` action (admin-triggered,
 *     one shop at a time)
 *   - marketing-scheduled-publisher.js (Netlify Scheduled Function,
 *     cron-triggered, ALL shops — nobody supplies a shop_id on a timer)
 *
 * Before this pass, `run_publishing_queue` SELECTed due jobs and processed
 * them in a loop with no claim step — safe as long as exactly one caller
 * ever ran it at a time, which stopped being true the moment a cron
 * trigger could overlap either a slow-running previous cron tick or a
 * concurrent manual admin trigger. claimDueJobs() closes that gap with an
 * atomic, race-safe claim: SELECT candidate ids, then
 * UPDATE ... WHERE status='queued' AND id IN (candidates) RETURNING *.
 * Postgres serializes concurrent UPDATEs to the same row, and the
 * re-checked `status='queued'` guard means a losing race simply returns
 * zero rows for that job rather than a corrupted double-claim — the same
 * safety property FOR UPDATE SKIP LOCKED gives, achievable here with
 * plain supabase-js calls and no new migration/stored procedure.
 */

import {
  classifyPublishFailure,
  nextJobStateAfterFailure,
  computeBackoffSeconds
} from "./marketing-publishing-queue.js";
import { enforcePrePublishDisclosureGate } from "./creative-ai/disclosure-policy.js";
import { notLiveSocialProvider, SOCIAL_NOT_LIVE, isPlatformConfigured, buildConfiguredSocialProviderRegistry } from "./marketing-social-providers.js";
import { decryptSocialToken } from "./marketing-social-oauth.js";
import { publicWebsiteMediaUrl } from "./website-media.js";

export { computeBackoffSeconds };

const DEFAULT_CLAIM_LIMIT = 25;

/**
 * Priority 5 audit finding (social-provider strict audit): before this
 * pass, whether a shop had EVER connected a platform made zero difference
 * to whether a publish was attempted — every job went straight from the
 * variant read to provider.publish() with no check of
 * marketing_social_connections at all. That was invisible today only
 * because every provider is the not-live stub, which throws regardless of
 * connection state; the moment a real adapter is wired in for any
 * platform, this gap would let a job publish for a shop that never
 * connected it, or whose connection is disconnected/needs_reauth/error,
 * or whose token has expired. This is the fail-closed gate that makes
 * "no provider call can bypass connection state" true structurally, not
 * by accident of every adapter being a stub.
 */
function isConnectionUsable(connection, now) {
  if (!connection) return false;
  if (connection.status !== "connected") return false;
  if (connection.expires_at && new Date(connection.expires_at).getTime() <= now.getTime()) return false;
  return true;
}

/**
 * Atomically claims up to `limit` due jobs (status='queued',
 * next_attempt_at <= now), flips them to 'running', and returns the
 * claimed rows — safe under concurrent callers (see module doc). Pass
 * `shopId` to scope the claim to one shop (the admin-triggered path);
 * omit it to claim across every shop (the cron-triggered path).
 */
export async function claimDueJobs(client, { shopId = null, limit = DEFAULT_CLAIM_LIMIT, now = new Date() } = {}) {
  let candidateQuery = client
    .from("marketing_publishing_jobs")
    .select("id")
    .eq("status", "queued")
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(Math.min(100, Math.max(1, Number(limit) || DEFAULT_CLAIM_LIMIT)));
  if (shopId) candidateQuery = candidateQuery.eq("shop_id", shopId);

  const candidates = await candidateQuery;
  if (candidates.error) throw candidates.error;
  const candidateIds = (candidates.data || []).map((row) => row.id);
  if (!candidateIds.length) return [];

  // The re-checked status='queued' here — not just the id list — is what
  // makes this claim safe against a concurrent second caller racing the
  // same candidate set: whichever caller's UPDATE lands second sees those
  // rows already flipped to 'running' and simply gets fewer rows back,
  // never a duplicate claim.
  const claimed = await client
    .from("marketing_publishing_jobs")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .in("id", candidateIds)
    .eq("status", "queued")
    .select("id,shop_id,platform_variant_id,status,attempts,max_attempts,next_attempt_at");
  if (claimed.error) throw claimed.error;
  return claimed.data || [];
}

/**
 * Processes ONE already-claimed (status='running') job through the full
 * fail-closed pipeline: quarantined-asset check, disclosure gate, provider
 * dispatch, retry/backoff classification. Identical behavior to what
 * run_publishing_queue did inline before this pass — extracted so the
 * scheduled-function path gets the exact same guarantees, not a
 * reimplementation that could drift from it.
 */
export async function processClaimedJob(client, job, { now = new Date(), registry = null } = {}) {
  let platform = null;
  let outcome;
  try {
    // Audit finding: this DB read's error was previously never checked —
    // a genuine query failure (not just "row not found") silently fell
    // through to `variant = undefined` and kept going, which meant a
    // transient DB hiccup was invisible rather than retried, AND a
    // missing/foreign variant (deleted, or belonging to another shop) let
    // enforcePrePublishDisclosureGate({}) run against an EMPTY object —
    // which reads as "no disclosure required" (the gate's default), a
    // real fail-OPEN path a real provider.publish({}) could have reached.
    // Both are fixed the same way: any variant-read problem is now a
    // real, classified failure BEFORE a provider is ever considered.
    const variantResult = await client
      .from("marketing_platform_variants")
      .select("id,platform,caption,scheduled_at,ai_disclosure_required,disclosure_applied,asset_id")
      .eq("id", job.platform_variant_id)
      .eq("shop_id", job.shop_id)
      .maybeSingle();
    if (variantResult.error) throw variantResult.error;
    const variant = variantResult.data;
    if (!variant) {
      const notFoundError = new Error("Platform variant not found for this job (deleted, or does not belong to this shop) — cannot publish.");
      notFoundError.statusCode = 400; // fatal — retrying will never make a missing/foreign row appear
      notFoundError.code = "variant_not_found";
      throw notFoundError;
    }
    platform = variant.platform;

    let assetUrl = null;
    if (variant.asset_id) {
      const assetResult = await client.from("ai_generated_assets").select("id,status,media_id").eq("id", variant.asset_id).maybeSingle();
      if (assetResult.error) throw assetResult.error;
      if (assetResult.data?.status === "quarantined") {
        const quarantineError = new Error("Source asset is quarantined (consent was revoked) and cannot be published.");
        quarantineError.statusCode = 400;
        quarantineError.code = "asset_quarantined";
        throw quarantineError;
      }
      // Real publish-adapter completion pass: a real provider needs a
      // real, public HTTPS URL to the image/video, not Florisyn's
      // internal asset id — images are stored in website_media (see
      // ai_generated_assets' own schema comment), so resolving one is a
      // real DB read + a real public-URL lookup, never a guessed path.
      // Only actually resolved when this platform has a real, configured
      // adapter (below) — a not-live platform never needed it anyway.
      if (assetResult.data?.media_id && isPlatformConfigured(platform, process.env)) {
        const mediaResult = await client.from("website_media").select("storage_path").eq("id", assetResult.data.media_id).eq("shop_id", job.shop_id).maybeSingle();
        if (mediaResult.error) throw mediaResult.error;
        if (mediaResult.data?.storage_path) {
          assetUrl = publicWebsiteMediaUrl(client, mediaResult.data.storage_path);
        }
      }
    }
    const gate = enforcePrePublishDisclosureGate(variant);
    if (!gate.allowed) {
      const disclosureError = new Error(gate.message);
      disclosureError.statusCode = 400;
      disclosureError.code = "ai_disclosure_required";
      throw disclosureError;
    }

    // Connection-state gate (see isConnectionUsable doc above) — checked
    // AFTER content-safety (quarantine/disclosure) but always BEFORE any
    // provider is ever touched, so a real future adapter physically
    // cannot be invoked for a shop that hasn't connected this platform,
    // whose connection was revoked/needs reauth, or whose token expired.
    const connectionResult = await client
      .from("marketing_social_connections")
      .select("id,status,expires_at,external_account_id")
      .eq("shop_id", job.shop_id)
      .eq("platform", platform)
      .maybeSingle();
    if (connectionResult.error) throw connectionResult.error;
    if (!isConnectionUsable(connectionResult.data, now)) {
      const notConnectedError = new Error(
        `${platform}: no usable connection for this shop (status: ${connectionResult.data?.status || "not_connected"}) — connect or reconnect this platform before publishing.`
      );
      // Same bucket as "adapter not live" — both mean "no real publish is
      // possible right now, don't retry-loop, this needs a human action"
      // (connect the platform, or wait for the adapter to exist).
      notConnectedError.code = SOCIAL_NOT_LIVE;
      notConnectedError.statusCode = 501;
      throw notConnectedError;
    }

    // registry is only ever supplied in tests (real production callers
    // never pass it) — lets a test exercise the worker's real asset/token
    // plumbing against a fast, deterministic stub provider instead of a
    // real adapter's real (multi-second) polling delays, while the real
    // adapters' own actual HTTP behavior is separately proven in
    // marketing-social-adapter-*.test.js against mocked real endpoints.
    const effectiveRegistry = registry || buildConfiguredSocialProviderRegistry({ env: process.env });
    const provider = effectiveRegistry[platform] || notLiveSocialProvider(platform);

    // A real, configured adapter needs real call-time context this
    // worker resolves itself — the decrypted access token (service-role
    // only; never touches browser code) and the target account id
    // captured at connect time (marketing-social-oauth-callback.js). An
    // unconfigured/not-live platform never reaches this — publish()
    // ignores whatever it's called with and throws regardless, so no
    // wasted queries for the common today-still-not-live case.
    let publishContext = variant;
    if (isPlatformConfigured(platform, process.env)) {
      const secretsResult = await client
        .from("marketing_social_connection_secrets")
        .select("access_token_ciphertext")
        .eq("connection_id", connectionResult.data.id)
        .maybeSingle();
      if (secretsResult.error) throw secretsResult.error;
      const accessToken = secretsResult.data?.access_token_ciphertext ? decryptSocialToken(secretsResult.data.access_token_ciphertext, process.env) : "";
      if (!accessToken) {
        const tokenError = new Error(`${platform}: no usable stored access token for this connection — reconnect the platform.`);
        tokenError.code = "social_token_invalid";
        tokenError.statusCode = 401;
        throw tokenError;
      }
      publishContext = { ...variant, accessToken, externalAccountId: connectionResult.data.external_account_id, assetUrl, caption: variant.caption };
    }

    const publishResult = await provider.publish(publishContext);
    await client.from("marketing_publishing_jobs").update({ status: "succeeded", attempts: job.attempts + 1, updated_at: new Date().toISOString() }).eq("id", job.id);
    await client
      .from("marketing_platform_variants")
      .update({ status: "published", published_at: new Date().toISOString(), external_post_id: publishResult?.externalPostId || null })
      .eq("id", job.platform_variant_id);
    outcome = "succeeded";
  } catch (error) {
    const kind = classifyPublishFailure(error);
    const next = nextJobStateAfterFailure({ attempts: job.attempts, maxAttempts: job.max_attempts, kind });
    const nextAttemptAt = next.delaySeconds != null ? new Date(now.getTime() + next.delaySeconds * 1000).toISOString() : job.next_attempt_at;
    await client
      .from("marketing_publishing_jobs")
      .update({
        status: next.status,
        attempts: next.attempts,
        next_attempt_at: nextAttemptAt,
        last_error: String(error?.message || error).slice(0, 500),
        last_error_code: kind,
        updated_at: new Date().toISOString()
      })
      .eq("id", job.id);
    if (next.status === "failed" || next.status === "dead_letter") {
      await client
        .from("marketing_platform_variants")
        .update({ status: "failed", last_error: String(error?.message || error).slice(0, 500) })
        .eq("id", job.platform_variant_id);
    }
    // Real connection-health tracking (Priority 5 completion pass): a
    // token the provider itself rejected means THIS connection is
    // genuinely broken, independent of any one job's retry/backoff state
    // — surfaced to the real Connections panel as needs_reauth rather
    // than silently staying "connected" while every publish keeps
    // failing the same way.
    if (kind === "token_invalid" && platform) {
      await client
        .from("marketing_social_connections")
        .update({ status: "needs_reauth", last_error: String(error?.message || error).slice(0, 500), last_checked_at: new Date().toISOString() })
        .eq("shop_id", job.shop_id)
        .eq("platform", platform);
    }
    outcome = next.status;
  }
  return { job_id: job.id, platform_variant_id: job.platform_variant_id, platform: platform || null, outcome };
}

// Comfortably above the slowest real adapter's own internal status-poll
// ceiling (TikTok's ~2 minutes — see marketing-social-adapter-tiktok.js),
// so nothing legitimately still in-flight is ever reclaimed out from
// under itself. A row stuck at 'running' longer than this can only mean
// the process that claimed it never reached a terminal write — a Netlify
// function timeout, an OOM kill, a container recycle — not a slow but
// genuinely still-working attempt.
const STALE_RUNNING_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Recovery after interrupted execution (Priority B hardening): claimDueJobs
 * flips a row to 'running' before any work happens, but nothing before this
 * function ever looked at a 'running' row again — only 'queued' rows are
 * ever claimed. If the process handling a job dies mid-flight (the common
 * real case: a serverless function timeout, not a JS-catchable error), that
 * job was stuck at 'running' forever; no cron tick, no manual retry, and no
 * amount of waiting ever picks it back up. This closes that gap the same
 * way a real failure is handled — reusing nextJobStateAfterFailure's exact
 * transient-retry-then-dead_letter logic (Section 24), never a parallel
 * recovery policy that could drift from the normal failure path.
 */
export async function reclaimStaleRunningJobs(client, { now = new Date(), staleAfterMs = STALE_RUNNING_MS, limit = DEFAULT_CLAIM_LIMIT } = {}) {
  const staleBefore = new Date(now.getTime() - staleAfterMs).toISOString();
  const staleQuery = await client
    .from("marketing_publishing_jobs")
    .select("id,shop_id,platform_variant_id,attempts,max_attempts")
    .eq("status", "running")
    .lt("updated_at", staleBefore)
    .limit(Math.min(100, Math.max(1, Number(limit) || DEFAULT_CLAIM_LIMIT)));
  if (staleQuery.error) throw staleQuery.error;
  const staleJobs = staleQuery.data || [];

  let reclaimed = 0;
  let deadLettered = 0;
  for (const job of staleJobs) {
    // eslint-disable-next-line no-await-in-loop
    const next = nextJobStateAfterFailure({ attempts: job.attempts, maxAttempts: job.max_attempts, kind: "transient" });
    const nextAttemptAt = next.delaySeconds != null ? new Date(now.getTime() + next.delaySeconds * 1000).toISOString() : now.toISOString();
    // Re-checked status='running' — the same race-safety pattern
    // claimDueJobs uses — so a job that legitimately finished (or was
    // already reclaimed by a concurrent worker) between the select above
    // and this update is never double-recovered.
    // eslint-disable-next-line no-await-in-loop
    const updated = await client
      .from("marketing_publishing_jobs")
      .update({
        status: next.status,
        attempts: next.attempts,
        next_attempt_at: nextAttemptAt,
        last_error: "Interrupted: the worker that claimed this job never reached a terminal state (likely a function timeout or crash). Automatically recovered by the stale-running reclaim.",
        last_error_code: "interrupted_execution",
        updated_at: new Date().toISOString()
      })
      .eq("id", job.id)
      .eq("status", "running")
      .select("id");
    if (updated.error) throw updated.error;
    if (!updated.data?.length) continue; // lost the race — someone else already resolved it
    if (next.status === "dead_letter") {
      deadLettered++;
      // eslint-disable-next-line no-await-in-loop
      await client
        .from("marketing_platform_variants")
        .update({ status: "failed", last_error: "Publishing repeatedly interrupted before completion — see the job's dead-letter state." })
        .eq("id", job.platform_variant_id);
    } else {
      reclaimed++;
    }
  }
  return { reclaimed, deadLettered, inspected: staleJobs.length };
}

/**
 * Claim + process, end to end. This is the ONE function both the
 * admin-triggered action and the cron-triggered scheduled function call —
 * neither maintains its own copy of this loop.
 */
export async function runPublishingWorker(client, { shopId = null, limit = DEFAULT_CLAIM_LIMIT, now = new Date() } = {}) {
  // Reclaim before claiming — a job stuck at 'running' from a prior
  // interrupted invocation gets a chance to become 'queued' again (and
  // therefore claimable below) in the very same pass, rather than waiting
  // for a separate cron tick.
  await reclaimStaleRunningJobs(client, { now });
  const claimed = await claimDueJobs(client, { shopId, limit, now });
  const results = [];
  for (const job of claimed) {
    results.push(await processClaimedJob(client, job, { now }));
  }
  return results;
}
