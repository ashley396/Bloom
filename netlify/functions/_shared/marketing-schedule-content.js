/**
 * Shared "set a real schedule on a content item's platform variants" logic
 * — used by both the schedule_content_item admin action (marketing-
 * studio.js) and the compound-request orchestrator (marketing-compound-
 * orchestrator.js), so there is exactly one implementation of "convert the
 * shop's local time and write scheduled_at", not two that could drift.
 */

import { shopLocalDateTimeToUtcIso } from "./shop-time.js";

/**
 * @param {object} client - tenant-scoped or service-role Supabase client
 * @param {object} params
 * @param {string} params.shopId
 * @param {string} params.contentItemId
 * @param {string} params.scheduledAtLocal - "YYYY-MM-DDTHH:mm", shop-local wall-clock time
 * @param {string} [params.timezone] - IANA zone; if omitted, looked up from `shops.timezone`
 * @param {string[]} [params.platforms] - restrict to these platforms only; all variants if omitted
 */
export async function scheduleContentItemVariants(client, { shopId, contentItemId, scheduledAtLocal, timezone = null, platforms = null } = {}) {
  if (!contentItemId) return { ok: false, code: "invalid_request", error: "contentItemId is required." };
  if (!scheduledAtLocal) return { ok: false, code: "invalid_request", error: "scheduledAtLocal is required (e.g. '2026-11-01T08:00', in the shop's own local time)." };

  let tz = timezone;
  if (!tz) {
    const shopRow = await client.from("shops").select("timezone").eq("id", shopId).maybeSingle();
    if (shopRow.error) return { ok: false, code: "db_error", error: shopRow.error.message, dbError: shopRow.error };
    tz = shopRow.data?.timezone || "America/New_York";
  }

  const scheduledAtUtc = shopLocalDateTimeToUtcIso(tz, scheduledAtLocal);
  if (!scheduledAtUtc) {
    return { ok: false, code: "invalid_datetime", error: "scheduledAtLocal could not be parsed. Expected 'YYYY-MM-DDTHH:mm' (24-hour, no timezone suffix — it's interpreted in the shop's own timezone)." };
  }

  let updateQuery = client
    .from("marketing_platform_variants")
    .update({ scheduled_at: scheduledAtUtc, updated_at: new Date().toISOString() })
    .eq("content_item_id", contentItemId)
    .eq("shop_id", shopId);
  if (platforms && platforms.length) updateQuery = updateQuery.in("platform", platforms);
  const updated = await updateQuery.select("id,platform,scheduled_at");
  if (updated.error) return { ok: false, code: "db_error", error: updated.error.message, dbError: updated.error };
  if (!updated.data?.length) return { ok: false, code: "not_found", error: "No matching platform variants found for this content item." };

  // Scheduling-hardening pass (Priority 10): this function only used to
  // touch the variant's own scheduled_at. If enqueue_publish already ran
  // for this content item BEFORE this reschedule (a real, legal call
  // order — nothing gates schedule_content_item to "before queueing"),
  // the already-created marketing_publishing_jobs row kept its OLD
  // next_attempt_at, so the real publish attempt would still fire at the
  // time the shop just changed away from. Only a job still 'queued' (not
  // yet running/terminal) is resynced — an in-flight or already-settled
  // attempt is never rewritten out from under itself.
  const variantIds = updated.data.map((v) => v.id);
  const jobSync = await client.from("marketing_publishing_jobs").update({ next_attempt_at: scheduledAtUtc, updated_at: new Date().toISOString() }).eq("status", "queued").in("platform_variant_id", variantIds);
  if (jobSync.error) {
    // A real DB error here must still surface — a reschedule that
    // silently failed to move the actual queued job would be exactly the
    // stale-time bug this fix exists to close.
    return { ok: false, code: "db_error", error: jobSync.error.message, dbError: jobSync.error };
  }

  return { ok: true, variants: updated.data, scheduledAtUtc, timezone: tz };
}
