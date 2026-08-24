/**
 * Job correlation for asynchronous avatar-video renders
 * (marketing_clone_video_jobs) — the missing link a webhook needs to map
 * an inbound `external_job_id` (HeyGen's video_id) back to a real
 * Florisyn shop_id/content_item, since the vendor client itself only
 * knows the provider's own job id.
 *
 * Today the only live call site that starts a real HeyGen video render is
 * marketing-studio.js's `preview_clone_profile` action; this store is
 * provider-independent (keyed by `provider` + `provider_job_id`) so a
 * future real content-generation → avatar-video pipeline (wiring
 * `uses_ai_clone` content items to actually call generateVideo() — not
 * built yet, out of scope for this pass) can persist rows here the same
 * way without a schema change.
 */

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export async function recordCloneVideoJob(
  client,
  {
    shopId,
    provider,
    providerJobId,
    source,
    contentItemId = null,
    platformVariantId = null,
    // Digital Twin result lifecycle (20260826000000): everything
    // finalizeDigitalTwinJob() needs to build a fully-linked
    // ai_generated_assets row and to re-verify consent at completion
    // time, without a second round-trip back to whoever requested the
    // render. All optional/nullable — preview_clone_profile's existing
    // call site (no Personal Brand concept, no explicit consent record)
    // keeps working exactly as before with none of these set.
    sourceAssetId = null,
    avatarProfileId = null,
    voiceProfileId = null,
    consentId = null,
    usage = null,
    platform = null,
    createdBy = null,
    // Revoked-media hardening (20260827000000): the storage path of the
    // synthesized voice track this render is using, if any — captured so
    // quarantine cleanup can actually delete a Florisyn-hosted file it
    // has a real path for, rather than only being able to log that it
    // exists.
    tempAudioPath = null
  } = {}
) {
  if (!shopId) throw new Error("recordCloneVideoJob requires shopId.");
  if (!provider) throw new Error("recordCloneVideoJob requires provider.");
  if (!providerJobId) throw new Error("recordCloneVideoJob requires providerJobId.");
  const inserted = await client
    .from("marketing_clone_video_jobs")
    .insert({
      shop_id: shopId,
      provider,
      provider_job_id: providerJobId,
      source: source || "preview",
      content_item_id: contentItemId,
      platform_variant_id: platformVariantId,
      source_asset_id: sourceAssetId,
      avatar_profile_id: avatarProfileId,
      voice_profile_id: voiceProfileId,
      consent_id: consentId,
      usage,
      platform,
      created_by: createdBy,
      temp_audio_path: tempAudioPath,
      status: "rendering"
    })
    .select("id,shop_id,provider,provider_job_id,status")
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

// The full row shape finalizeDigitalTwinJob() (and its quarantine path)
// depend on — kept as one constant so getCloneVideoJob()'s read and
// applyWebhookStatusUpdate()'s post-update read can never silently drift
// apart and omit a column the caller actually needs.
const FULL_JOB_COLUMNS =
  "id,shop_id,provider,provider_job_id,source,content_item_id,platform_variant_id,status,result_url,error_message,source_asset_id,resulting_asset_id,avatar_profile_id,voice_profile_id,consent_id,usage,platform,created_by,disposition,quarantine_reason,quarantined_at,temp_audio_path,temp_audio_deleted_at,finalized_at,created_at,updated_at";

export async function getCloneVideoJob(client, { provider, providerJobId } = {}) {
  const result = await client.from("marketing_clone_video_jobs").select(FULL_JOB_COLUMNS).eq("provider", provider).eq("provider_job_id", providerJobId).maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

/**
 * Records which real ai_generated_assets row a job's completion produced —
 * called exactly once, by finalizeDigitalTwinJob(), right after that asset
 * is created. Kept as its own tiny update (not folded into
 * applyWebhookStatusUpdate) so the safe-status-transition function stays
 * focused on one concern; this one is idempotent by virtue of only ever
 * being called from the single alreadyTerminal:false branch.
 */
export async function markCloneVideoJobFinalized(client, jobId, { resultingAssetId } = {}) {
  const updated = await client
    .from("marketing_clone_video_jobs")
    .update({ resulting_asset_id: resultingAssetId || null, disposition: "normal", finalized_at: new Date().toISOString() })
    .eq("id", jobId)
    .select("id,resulting_asset_id,disposition,finalized_at")
    .maybeSingle();
  if (updated.error) throw updated.error;
  return updated.data;
}

/**
 * Records that a job's output was quarantined — required consent was
 * revoked before finalization could complete (Section 2/3 of the revoked-
 * media hardening pass). This is the audit trail for that outcome:
 * finalizeDigitalTwinJob() never creates an ai_generated_assets row for
 * this job at all, so this update IS the durable record of what happened
 * (when, why, and — via the columns already on this row — which shop/
 * provider/consent/avatar/voice profile were involved).
 */
export async function markCloneVideoJobQuarantined(client, jobId, { reason } = {}) {
  const updated = await client
    .from("marketing_clone_video_jobs")
    .update({ disposition: "quarantined", quarantine_reason: reason || "consent_revoked", quarantined_at: new Date().toISOString(), finalized_at: new Date().toISOString() })
    .eq("id", jobId)
    .select("id,disposition,quarantine_reason,quarantined_at")
    .maybeSingle();
  if (updated.error) throw updated.error;
  return updated.data;
}

/** Marks the temp synthesized-audio file as deleted (or attempted) — a
 * separate, tiny update so a storage-deletion failure never gets confused
 * with the job's own status/disposition. */
export async function markTempAudioDeleted(client, jobId) {
  const updated = await client.from("marketing_clone_video_jobs").update({ temp_audio_deleted_at: new Date().toISOString() }).eq("id", jobId).select("id,temp_audio_deleted_at").maybeSingle();
  if (updated.error) throw updated.error;
  return updated.data;
}

/**
 * Applies a webhook-reported status to the matching job row — the "safe
 * status transitions" requirement: a job already in a terminal state
 * (completed/failed) is never overwritten by a later event, so an
 * out-of-order or duplicate-but-not-identical delivery (e.g. a stale
 * "processing" event arriving after "completed" already landed) can never
 * regress a finished job back to an earlier state. Returns
 * { found, alreadyTerminal, job }.
 */
export async function applyWebhookStatusUpdate(client, { provider, providerJobId, status, resultUrl, error } = {}) {
  const job = await getCloneVideoJob(client, { provider, providerJobId });
  if (!job) return { found: false, alreadyTerminal: false, job: null };
  if (TERMINAL_STATUSES.has(job.status)) {
    return { found: true, alreadyTerminal: true, job };
  }
  const updated = await client
    .from("marketing_clone_video_jobs")
    .update({
      status,
      result_url: resultUrl || null,
      error_message: error ? String(error).slice(0, 500) : null,
      updated_at: new Date().toISOString()
    })
    .eq("id", job.id)
    .select(FULL_JOB_COLUMNS)
    .single();
  if (updated.error) throw updated.error;
  return { found: true, alreadyTerminal: false, job: updated.data };
}
