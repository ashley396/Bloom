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
  { shopId, provider, providerJobId, source, contentItemId = null, platformVariantId = null } = {}
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
      status: "rendering"
    })
    .select("id,shop_id,provider,provider_job_id,status")
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

export async function getCloneVideoJob(client, { provider, providerJobId } = {}) {
  const result = await client
    .from("marketing_clone_video_jobs")
    .select("id,shop_id,provider,provider_job_id,source,content_item_id,platform_variant_id,status,result_url,error_message,created_at,updated_at")
    .eq("provider", provider)
    .eq("provider_job_id", providerJobId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
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
    .select("id,shop_id,provider,provider_job_id,source,content_item_id,platform_variant_id,status,result_url,error_message")
    .single();
  if (updated.error) throw updated.error;
  return { found: true, alreadyTerminal: false, job: updated.data };
}
