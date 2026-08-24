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

  return { ok: true, variants: updated.data, scheduledAtUtc, timezone: tz };
}
