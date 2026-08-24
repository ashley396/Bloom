/**
 * Digital Twin result finalization — the ONE canonical, idempotent
 * completion path both heygen-webhook.js and marketing-studio.js's
 * clone_job_status polling fallback call.
 *
 * Convergence, not duplication (prior pass, Section 7): both completion-
 * observation paths call finalizeDigitalTwinJob() with the same shape of
 * input. All of the "is this actually a new completion, or a duplicate/
 * race/replay" logic lives in clone-video-jobs.js's
 * applyWebhookStatusUpdate() (already safe-transition: a job already
 * terminal is never regressed) — this module adds exactly one thing on
 * top: when applyWebhookStatusUpdate() reports a REAL, first-time
 * transition to 'completed' (alreadyTerminal:false), and only then,
 * decide what happens to the output.
 *
 * Revoked-media hardening (this pass): "decide what happens" is no longer
 * always "create a usable asset." Consent is re-checked here BEFORE any
 * ai_generated_assets row is created. If a required permission (avatar
 * and/or voice, evaluated independently — see personal-brand-consent.js's
 * isDigitalTwinUseAuthorized()) was revoked before this moment, the
 * output is quarantined instead: no ai_generated_assets row is ever
 * inserted for it (Section 3 of the directive — "do NOT preserve
 * generated media merely because an audit record is required"; the audit
 * trail lives entirely on marketing_clone_video_jobs, which already has
 * everything Section 3 asks to keep: job id, provider, provider job id,
 * timestamps, shop, consent reference, and now disposition/
 * quarantine_reason/quarantined_at). The generation cost is still
 * recorded exactly once either way — Florisyn genuinely incurred it.
 */

import { applyWebhookStatusUpdate, markCloneVideoJobFinalized, markCloneVideoJobQuarantined, markTempAudioDeleted } from "./clone-video-jobs.js";
import { persistGeneratedAsset } from "../ai-creative-engine.js";
import { estimateCostCents } from "../marketing-cost-config.js";
import { determineDisclosureRequirement } from "./disclosure-policy.js";
import { isDigitalTwinUseAuthorized } from "./personal-brand-consent.js";
import { WEBSITE_MEDIA_BUCKET } from "../website-media.js";

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
 * "do not trust a provider callback merely because it says completed".
 * Deliberately conservative: this cannot verify the file actually exists
 * or is playable (no network fetch here), only that the shape of what was
 * reported is not obviously malformed/missing.
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

/**
 * Re-checks consent at the moment of completion — independently for
 * avatar and voice (Case E/F: revoking one must never quarantine output
 * that never used the other). Returns { authorized, reason } — reason is
 * null when there was nothing to check (no consent_id tracked on this
 * job, e.g. an older preview_clone_profile job outside Personal Brand
 * Studio's consent-gated flow) so that case is treated as "not
 * applicable, proceed" exactly as before this pass, never as a failure.
 */
export async function recheckDigitalTwinConsent(client, job) {
  if (!job.consent_id) return { authorized: true, reason: null, checked: false };
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
    return { authorized: authz.authorized, reason: authz.reason, checked: true };
  } catch (consentCheckError) {
    // Fail closed on an inability to verify.
    log("consent_recheck_failed", { jobId: job.id, reason: String(consentCheckError?.message || consentCheckError) });
    return { authorized: false, reason: "consent_recheck_failed", checked: true };
  }
}

async function recordMasterGenerationCost(client, { shopId, contentItemId } = {}) {
  // One row, one time — this function is only ever reached from the
  // single alreadyTerminal:false transition, so a webhook/poll race or a
  // retried poll can never insert a second usage row for the same job.
  // Recorded regardless of quarantine disposition (Section 7 of the
  // revoked-media hardening pass: "do not erase legitimate provider cost
  // merely because the media was revoked" — the render genuinely
  // happened and was genuinely billed by the provider either way).
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
    // Cost-ledger recording is best-effort and must never block the rest
    // of finalization — a florist's finished video is not lost, and a
    // quarantine disposition is not skipped, because an accounting insert
    // hiccuped.
    log("cost_usage_record_failed", { reason: String(error?.message || error) });
  }
}

/**
 * Creates a real, reviewable marketing_content_items + platform variant
 * for a just-finalized, NORMAL-disposition Digital Twin video ("Generated
 * -> Needs Review"). Deliberately status:'in_review' (never 'approved')
 * — successful generation is never itself approval to publish. Disclosure
 * metadata is computed and stored immediately via the SAME per-platform
 * policy engine set_content_disclosure already uses; disclosure_applied
 * stays false — a human still has to apply/confirm it before
 * run_publishing_queue's existing fail-closed gate will allow a publish
 * attempt. Only ever called once consent has already been confirmed
 * valid — quarantined output never reaches this function at all.
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
 * Best-effort cleanup for quarantined output (Section 4 of the revoked-
 * media hardening pass). Deletes the ElevenLabs-synthesized audio
 * Florisyn itself hosted for this render, if a path was recorded —
 * that's a real Florisyn-controlled file this codebase already knows how
 * to remove (the same Supabase Storage bucket website-media.js's other
 * deletion paths use). The HeyGen-hosted VIDEO output is a different
 * matter: HeyGen's API does not document a video-deletion endpoint (see
 * marketing-clone-provider-heygen-elevenlabs.js's cancelJob(), which
 * already honestly refuses for the same documented-capability reason) —
 * inventing one here would violate the standing "never fake provider
 * capabilities" rule, so this logs PROVIDER DELETION UNAVAILABLE /
 * UNVERIFIED instead. Internal access is still fully blocked regardless
 * (no asset row, no resultUrl ever returned to a client) — deletion is a
 * courtesy on top of that, not what makes the quarantine safe.
 */
export async function cleanupQuarantinedDigitalTwinMedia(client, job) {
  const result = { audioDeleted: false, audioDeleteError: null, providerDeletion: "PROVIDER DELETION UNAVAILABLE / UNVERIFIED — HeyGen does not document a video-deletion endpoint." };
  if (job.temp_audio_path && !job.temp_audio_deleted_at) {
    try {
      const { error } = await client.storage.from(WEBSITE_MEDIA_BUCKET).remove([job.temp_audio_path]);
      if (error) throw error;
      await markTempAudioDeleted(client, job.id);
      result.audioDeleted = true;
    } catch (error) {
      result.audioDeleteError = String(error?.message || error).slice(0, 300);
      log("temp_audio_cleanup_failed", { jobId: job.id, reason: result.audioDeleteError });
    }
  }
  log("provider_deletion_unavailable", { jobId: job.id, provider: job.provider });
  return result;
}

/**
 * The canonical finalization entrypoint. Never throws for anything past
 * the core safe-transition update — asset/content-item creation failures
 * are logged and reported in the return value rather than raised, so a
 * secondary-step DB hiccup can never make a caller think the underlying
 * status transition itself failed ("never falsely report a finished
 * video" cuts both ways — never claim done when it isn't, and never lose
 * the fact that it genuinely did complete because of an unrelated
 * bookkeeping error).
 *
 * Returns a superset of applyWebhookStatusUpdate()'s shape
 * ({found, alreadyTerminal, job}) plus {assetCreated, quarantined, asset,
 * contentItem, reason} — existing callers that only read
 * found/alreadyTerminal/job keep working unchanged.
 */
export async function finalizeDigitalTwinJob(client, { provider, providerJobId, status, resultUrl, error } = {}) {
  const applied = await applyWebhookStatusUpdate(client, { provider, providerJobId, status, resultUrl, error });
  if (!applied.found) return { ...applied, assetCreated: false, quarantined: false, asset: null, contentItem: null, reason: "job_not_found" };
  if (applied.alreadyTerminal) return { ...applied, assetCreated: false, quarantined: false, asset: null, contentItem: null, reason: "already_terminal" };

  const job = applied.job;
  if (job.status !== "completed") {
    // A genuine first-time transition to 'failed' — nothing more to do.
    // Never becomes a usable asset; the job row itself already carries
    // the real error_message for the UI to show.
    return { ...applied, assetCreated: false, quarantined: false, asset: null, contentItem: null, reason: job.status === "failed" ? "generation_failed" : "unexpected_status" };
  }

  const validation = validateDigitalTwinOutput({ resultUrl: job.result_url });
  if (!validation.valid) {
    log("invalid_output", { provider, jobId: job.id, reason: validation.reason });
    return { ...applied, assetCreated: false, quarantined: false, asset: null, contentItem: null, reason: `invalid_output:${validation.reason}` };
  }

  // Consent is re-checked BEFORE any asset is created — the whole point
  // of this pass. A job with no tracked consent_id (checked:false) is
  // treated as not applicable, exactly as before this hardening pass.
  const consentCheck = await recheckDigitalTwinConsent(client, job);

  if (consentCheck.checked && !consentCheck.authorized) {
    log("quarantining_revoked_output", { provider, jobId: job.id, reason: consentCheck.reason });
    await recordMasterGenerationCost(client, { shopId: job.shop_id }); // cost was genuinely incurred either way
    const cleanup = await cleanupQuarantinedDigitalTwinMedia(client, job);
    let quarantineRow = null;
    try {
      quarantineRow = await markCloneVideoJobQuarantined(client, job.id, { reason: consentCheck.reason });
    } catch (quarantineError) {
      log("quarantine_mark_failed", { provider, jobId: job.id, reason: String(quarantineError?.message || quarantineError) });
    }
    return {
      ...applied,
      job: { ...job, disposition: quarantineRow?.disposition || "quarantined", quarantine_reason: consentCheck.reason },
      assetCreated: false,
      quarantined: true,
      asset: null,
      contentItem: null,
      cleanup,
      reason: `consent_revoked_at_completion:${consentCheck.reason}`
    };
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
        estimated_duration_seconds: ESTIMATED_VIDEO_DURATION_SECONDS
      },
      parentAssetId: job.source_asset_id || null,
      status: "completed"
    });
    if (!persisted.ok) throw new Error(persisted.error);
    asset = persisted.asset;

    // consent_id is written directly (not just buried in content jsonb)
    // so a later revocation (Case D — consent revoked AFTER this normal
    // asset already exists) can find and quarantine it in one indexed
    // query — see revoke_clone_consent in marketing-studio.js.
    if (job.consent_id) {
      await client.from("ai_generated_assets").update({ consent_id: job.consent_id }).eq("id", asset.id);
    }

    await recordMasterGenerationCost(client, { shopId: job.shop_id });

    try {
      contentItem = await createReviewableContentItem(client, { shopId: job.shop_id, job, asset });
    } catch (contentItemError) {
      // The asset itself is real and saved either way — a failure here
      // only means it isn't yet visible in the content-item review
      // queue, not that the video was lost.
      log("content_item_creation_failed", { provider, jobId: job.id, reason: String(contentItemError?.message || contentItemError) });
    }

    await markCloneVideoJobFinalized(client, job.id, { resultingAssetId: asset.id });
  } catch (assetError) {
    log("asset_creation_failed", { provider, jobId: job.id, reason: String(assetError?.message || assetError) });
    return { ...applied, assetCreated: false, quarantined: false, asset: null, contentItem: null, reason: "asset_creation_failed" };
  }

  return { ...applied, assetCreated: true, quarantined: false, asset, contentItem, reason: null };
}
