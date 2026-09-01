/**
 * Florisyn Marketing Studio — the one provider-usage accounting service
 * (Batch 2, "Marketing image quality + provider cost accounting").
 *
 * Every real, billable provider call this codebase makes for Marketing
 * generation — a text/copy call, an image-generation call, a vision-
 * inspection call, and each of their bounded retries — goes through
 * reserveProviderCall() / completeProviderCall() / failProviderCall()
 * instead of a caller inventing its own insert/update logic. Reuses the
 * existing marketing_generation_usage table (created in
 * 20260823000000_marketing_studio_foundation_v1.sql, extended additively
 * by 20260901000000_marketing_generation_usage_ledger_extension.sql) —
 * never a second usage/cost table.
 *
 * FAIL-CLOSED LEDGER: reserveProviderCall() performs the real insert
 * BEFORE a caller is allowed to make the actual provider call. If the
 * insert fails, the caller must treat that as `{ok: false}` and never
 * attempt the provider call — Florisyn must never spend money it can't
 * account for. This mirrors the exact pattern this codebase's existing
 * recordUsage() helpers already use (insert an 'estimated' row before
 * calling the provider) — this service just makes it a single shared
 * implementation instead of one per call site, and adds the fields
 * needed to track EACH individual call (not one row per logical
 * "generation") plus real reconciliation to actual provider cost.
 */

import { estimateCostCents } from "./marketing-cost-config.js";

/**
 * Reserves (inserts) one usage row BEFORE the provider call it accounts
 * for. Returns { ok: false, error } if the write itself failed — the
 * caller must not proceed to the real provider call in that case.
 *
 * `purpose` must be one of the values marketing_generation_usage's own
 * check constraint allows ('image'|'video'|'avatar_video'|'voice'|
 * 'copy'|'vision'|'other'). `operation` is a free-form, code-defined
 * name for WHAT this specific call does (e.g. "image_generation",
 * "vision_inspection", "text_generation") — finer-grained than purpose,
 * useful for observability without widening the DB enum further.
 */
export async function reserveProviderCall(
  client,
  {
    shopId,
    jobId = null,
    contentItemId = null,
    provider = "cloudflare",
    model = null,
    purpose,
    operation = null,
    unitType = "request",
    units = 1,
    traceId = null,
    operationId = null,
    attemptIndex = 0,
    metadata = {}
  } = {}
) {
  if (!shopId) return { ok: false, error: "reserveProviderCall requires shopId." };
  if (!purpose) return { ok: false, error: "reserveProviderCall requires purpose." };
  const estimatedCostCents = estimateCostCents({ purpose, unitType, units });
  try {
    const result = await client
      .from("marketing_generation_usage")
      .insert({
        shop_id: shopId,
        job_id: jobId,
        content_item_id: contentItemId,
        provider,
        model,
        purpose,
        operation,
        unit_type: unitType,
        units,
        estimated_cost_cents: estimatedCostCents,
        actual_cost_cents: null,
        status: "estimated",
        cost_source: "estimated",
        trace_id: traceId,
        operation_id: operationId,
        attempt_index: attemptIndex,
        metadata
      })
      .select("id")
      .single();
    if (result.error) return { ok: false, error: result.error.message };
    return { ok: true, usageId: result.data.id, estimatedCostCents };
  } catch (error) {
    // A ledger write must fail closed the same way a real DB error would
    // — never let an exception here be mistaken for "no reservation
    // needed."
    return { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
}

/**
 * Marks a reserved usage row as completed. If the provider exposed its
 * own real cost figure (`actualCostCents`), reconciles the row to
 * 'actual'/cost_source 'provider_confirmed'. When the provider never
 * supplies a real figure (the overwhelmingly common case for the
 * providers this codebase calls today), the row is left exactly as
 * reserveProviderCall wrote it — status 'estimated', cost_source
 * 'estimated' — never silently upgraded to look provider-confirmed.
 */
export async function completeProviderCall(
  client,
  usageId,
  { providerRequestId = null, actualCostCents = null, metadata = null } = {}
) {
  if (!usageId) return { ok: false, error: "completeProviderCall requires usageId." };
  const update = {};
  if (providerRequestId != null) update.provider_request_id = providerRequestId;
  if (actualCostCents != null) {
    update.actual_cost_cents = actualCostCents;
    update.status = "actual";
    update.cost_source = "provider_confirmed";
  }
  if (metadata != null) update.metadata = metadata;
  if (!Object.keys(update).length) return { ok: true };
  try {
    const result = await client.from("marketing_generation_usage").update(update).eq("id", usageId);
    if (result.error) return { ok: false, error: result.error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
}

/**
 * Marks a reserved usage row as failed — the provider call this row
 * accounted for did not succeed. Never throws; a failure to even RECORD
 * the failure degrades to { ok: false } rather than silently pretending
 * the ledger is consistent.
 */
export async function failProviderCall(client, usageId, { error = null, metadata = null } = {}) {
  if (!usageId) return { ok: false, error: "failProviderCall requires usageId." };
  try {
    const result = await client
      .from("marketing_generation_usage")
      .update({
        status: "failed",
        metadata: metadata || { error: String(error?.message || error || "").slice(0, 300) }
      })
      .eq("id", usageId);
    if (result.error) return { ok: false, error: result.error.message };
    return { ok: true };
  } catch (thrown) {
    return { ok: false, error: String(thrown?.message || thrown).slice(0, 300) };
  }
}

/**
 * The worst-case bounded cost of a PLANNED operation — every text call,
 * every image-generation attempt up to the bound, and every vision
 * inspection up to the bound — computed BEFORE any provider call begins.
 * A caller compares this against remaining shop budget (via the
 * existing checkMonthlyBudgetForRequest, marketing-budget-guard.js —
 * never a parallel budget system) and refuses the whole operation up
 * front if the ceiling would exceed it, so a bounded retry can never
 * push a shop over budget just because an earlier estimate only counted
 * one attempt.
 */
export function calculateWorstCaseBoundedCostCents({ textCalls = 0, maxImageAttempts = 0, maxVisionInspections = 0 } = {}) {
  const textCents = textCalls > 0 ? (estimateCostCents({ purpose: "copy", unitType: "request", units: 1 }) || 0) * textCalls : 0;
  const imageCents = maxImageAttempts > 0 ? (estimateCostCents({ purpose: "image", unitType: "image", units: 1 }) || 0) * maxImageAttempts : 0;
  const visionCents =
    maxVisionInspections > 0 ? (estimateCostCents({ purpose: "vision", unitType: "request", units: 1 }) || 0) * maxVisionInspections : 0;
  return textCents + imageCents + visionCents;
}
