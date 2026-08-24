/**
 * Digital Twin result finalization — the ONE canonical, idempotent
 * completion path both heygen-webhook.js and marketing-studio.js's
 * clone_job_status polling fallback call. This is the deliberate fix for
 * the gap the previous pass left open: a job could be kicked off and
 * correlated, but a genuine completion never turned into a real
 * ai_generated_assets record.
 *
 * Convergence, not duplication (Section 7 of the directive): both
 * completion-observation paths (an inbound webhook, or clone_job_status
 * discovering completion via a live provider poll) call
 * finalizeDigitalTwinJob() with the same shape of input. All of the
 * "is this actually a new completion, or a duplicate/race/replay" logic
 * lives in clone-video-jobs.js's applyWebhookStatusUpdate() (already
 * safe-transition: a job already terminal is never regressed) — this
 * module adds exactly one thing on top: when applyWebhookStatusUpdate()
 * reports a REAL, first-time transition to 'completed'
 * (alreadyTerminal:false), and only then, create the real Florisyn asset.
 * A duplicate webhook, a poll landing after the webhook already finished
 * the job, or a retried poll all see alreadyTerminal:true and skip asset
 * creation — so "completed asset cannot be duplicated" falls directly out
 * of the existing safe-transition guarantee rather than needing a second,
 * independently-maintained dedupe check here.
 */

import { applyWebhookStatusUpdate, markCloneVideoJobFinalized } from "./clone-video-jobs.js";
import { persistGeneratedAsset } from "../ai-creative-engine.js";
import { estimateCostCents } from "../marketing-cost-config.js";
import { determineDisclosureRequirement } from "./disclosure-policy.js";
import { isDigitalTwinUseAuthorized } from "./personal-brand-consent.js";

// HeyGen's webhook payload (event_data) does not reliably carry a
// duration figure — see heygen-webhook.js's own confidence note. This is
// a documented estimate for cost-ledger purposes, matching the "~60
// second master video" figure the product target itself uses, not a
// measured value. Flagged in the recorded usage row's own metadata so a
// future pass that gets a real duration from the provider can replace it
// without guessing which historical rows were estimates.
const ESTIMATED_VIDEO_DURATION_SECONDS = 60;

function log(message, extra = {}) {
  // Same structured, secret-free logging convention as heygen-webhook.js —
  // never a raw URL/token, only correlation ids and classified reasons.
  console.warn(JSON.stringify({ level: "warn", fn: "digital-twin-finalization", message, ...extra }));
}

/**
 * Pure sanity check on what the provider claims is the finished output —
 * "do not trust a provider callback merely because it says completed"
 * (Section 9). Deliberately conservative: this cannot verify the file
 * actually exists or is playable (no network fetch here), only that the
 * shape of what was reported is not obviously malformed/missing.
 */
export function validateDigitalTwinOutput({ resultUrl } = {}) {
  if (typeof resultUrl !== "string" || !resultUrl.trim()) {
    return { valid: false, reason: "missing_result_url" };
  }
  if (!/^https:\/\//i.test(resultUrl.trim())) {
    return { valid: false, reason: "result_url_not_https" };
  }
  return { valid: true, reason: null };
}

async function recordMasterGenerationCost(client, { shopId, contentItemId } = {}) {
  // One row, one time — this function is only ever reached from the
  // single alreadyTerminal:false transition, so a webhook/poll race or a
  // retried poll can never insert a second usage row for the same job
  // (Section 13: "do not multiply the avatar-generation cost").
  try {
    await client.from("marketing_generation_usage").insert({
      shop_id: shopId,
      content_item_id: contentItemId || null,
      provider: "heygen",
      purpose: "avatar_video",
      unit_type: "second",
      units: ESTIMATED_VIDEO_DURATION_SECONDS,
      estimated_cost_cents: estimateCostCents({ purpose: "avatar_video", unitType: "second", units: ESTIMATED_VIDEO_DURATION_SECONDS }),
      status: "estimated"
    });
  } catch (error) {
    // Cost-ledger recording is best-effort and must never block the asset
    // from becoming real — a florist's finished video is not lost because
    // an accounting insert hiccuped.
    log("cost_usage_record_failed", { reason: String(error?.message || error) });
  }
}

/**
 * Creates a real, reviewable marketing_content_items + platform variant
 * for a just-finalized Digital Twin video — the Section 10 handoff
 * ("Generated -> Needs Review"). Deliberately status:'in_review' (never
 * 'approved') — successful generation is never itself approval to
 * publish. Disclosure metadata is computed and stored immediately
 * (Section 12) via the SAME per-platform policy engine
 * set_content_disclosure already uses; disclosure_applied stays false —
 * a human still has to apply/confirm it before run_publishing_queue's
 * existing fail-closed gate will allow a publish attempt.
 *
 * Skipped entirely (returns null) when there's no target platform on the
 * job, or when consent is no longer valid at completion time — a
 * revoked-consent video still becomes a real, auditable asset (the cost
 * was genuinely incurred) but is never auto-surfaced into the
 * publish-eligible pipeline.
 */
async function createReviewableContentItem(client, { shopId, job, asset }) {
  if (!job.platform) return null;
  const determination = determineDisclosureRequirement({
    platform: job.platform,
    avatarUsed: Boolean(job.avatar_profile_id),
    voiceUsed: Boolean(job.voice_profile_id),
    generativeVideoUsed: true,
    generativeImageUsed: false,
    humanEdited: false
  });

  const inserted = await client
    .from("marketing_content_items")
    .insert({
      shop_id: shopId,
      created_by: job.created_by || null,
      content_type: "reel",
      title: "Digital Twin video",
      brief: "Generated from an approved Personal Brand concept via the Digital Twin (avatar/voice) pipeline.",
      status: "in_review",
      uses_ai_clone: true,
      requires_human_approval: true
    })
    .select("id,content_type,title,status")
    .single();
  if (inserted.error) throw inserted.error;

  const variant = await client
    .from("marketing_platform_variants")
    .insert({
      shop_id: shopId,
      content_item_id: inserted.data.id,
      platform: job.platform,
      asset_id: asset.id,
      status: "ready",
      ai_content_type: "avatar_video",
      avatar_used: Boolean(job.avatar_profile_id),
      voice_used: Boolean(job.voice_profile_id),
      generative_video_used: true,
      ai_disclosure_required: determination.required,
      disclosure_method: determination.mechanism,
      disclosure_policy_version: determination.policyVersion,
      disclosure_checked_at: new Date().toISOString()
    })
    .select("id,platform,ai_disclosure_required")
    .single();
  if (variant.error) throw variant.error;

  return { contentItem: inserted.data, variant: variant.data };
}

/**
 * The canonical finalization entrypoint. Never throws for anything past
 * the core safe-transition update — asset/content-item creation failures
 * are logged and reported in the return value rather than raised, so a
 * secondary-step DB hiccup can never make a caller think the underlying
 * status transition itself failed (Section 14: "never falsely report a
 * finished video" cuts both ways — never claim done when it isn't, and
 * never lose the fact that it genuinely did complete because of an
 * unrelated bookkeeping error).
 *
 * Returns a superset of applyWebhookStatusUpdate()'s shape
 * ({found, alreadyTerminal, job}) plus {assetCreated, asset, contentItem,
 * reason} — existing callers that only read found/alreadyTerminal/job
 * keep working unchanged.
 */
export async function finalizeDigitalTwinJob(client, { provider, providerJobId, status, resultUrl, error } = {}) {
  const applied = await applyWebhookStatusUpdate(client, { provider, providerJobId, status, resultUrl, error });
  if (!applied.found) return { ...applied, assetCreated: false, asset: null, contentItem: null, reason: "job_not_found" };
  if (applied.alreadyTerminal) return { ...applied, assetCreated: false, asset: null, contentItem: null, reason: "already_terminal" };

  const job = applied.job;
  if (job.status !== "completed") {
    // A genuine first-time transition to 'failed' — nothing more to do.
    // Never becomes a published asset; the job row itself already carries
    // the real error_message for the UI to show.
    return { ...applied, assetCreated: false, asset: null, contentItem: null, reason: job.status === "failed" ? "generation_failed" : "unexpected_status" };
  }

  const validation = validateDigitalTwinOutput({ resultUrl: job.result_url });
  if (!validation.valid) {
    log("invalid_output", { provider, jobId: job.id, reason: validation.reason });
    return { ...applied, assetCreated: false, asset: null, contentItem: null, reason: `invalid_output:${validation.reason}` };
  }

  let consentValidAtCompletion = null; // null = not applicable (no tracked consent on this job)
  if (job.consent_id) {
    try {
      const consentRow = await client
        .from("marketing_clone_consent")
        .select("id,avatar_permission,voice_permission,approved_usage,approved_platforms,revoked_at")
        .eq("id", job.consent_id)
        .maybeSingle();
      const authz = isDigitalTwinUseAuthorized({
        consentRow: consentRow.data,
        usage: job.usage,
        platform: job.platform,
        needsAvatar: Boolean(job.avatar_profile_id),
        needsVoice: Boolean(job.voice_profile_id)
      });
      consentValidAtCompletion = authz.authorized;
      if (!authz.authorized) {
        log("consent_revoked_at_completion", { provider, jobId: job.id, reason: authz.reason });
      }
    } catch (consentCheckError) {
      // Fail closed on an inability to verify, but never lose the asset
      // record itself — same reasoning as the cost-ledger best-effort path.
      consentValidAtCompletion = false;
      log("consent_recheck_failed", { provider, jobId: job.id, reason: String(consentCheckError?.message || consentCheckError) });
    }
  }

  let asset = null;
  let contentItem = null;
  try {
    const persisted = await persistGeneratedAsset(client, {
      shopId: job.shop_id,
      userId: job.created_by || null,
      persona: "Lily",
      assetType: "video",
      provider: job.provider || provider,
      model: "heygen-avatar-elevenlabs-voice",
      content: {
        video_url: job.result_url,
        source: "digital_twin",
        avatar_profile_id: job.avatar_profile_id,
        voice_profile_id: job.voice_profile_id,
        consent_id: job.consent_id,
        consent_valid_at_completion: consentValidAtCompletion,
        estimated_duration_seconds: ESTIMATED_VIDEO_DURATION_SECONDS
      },
      parentAssetId: job.source_asset_id || null,
      status: "completed"
    });
    if (!persisted.ok) throw new Error(persisted.error);
    asset = persisted.asset;

    await recordMasterGenerationCost(client, { shopId: job.shop_id });

    if (consentValidAtCompletion !== false) {
      try {
        contentItem = await createReviewableContentItem(client, { shopId: job.shop_id, job, asset });
      } catch (contentItemError) {
        // The asset itself is real and saved either way — a failure here
        // only means it isn't yet visible in the content-item review
        // queue, not that the video was lost.
        log("content_item_creation_failed", { provider, jobId: job.id, reason: String(contentItemError?.message || contentItemError) });
      }
    }

    await markCloneVideoJobFinalized(client, job.id, { resultingAssetId: asset.id });
  } catch (assetError) {
    log("asset_creation_failed", { provider, jobId: job.id, reason: String(assetError?.message || assetError) });
    return { ...applied, assetCreated: false, asset: null, contentItem: null, reason: "asset_creation_failed" };
  }

  return { ...applied, assetCreated: true, asset, contentItem, reason: null };
}
