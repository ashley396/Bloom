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

// Batch 3 staging-acceptance fix ("FIX THE PROVEN OPENAI USAGE
// RESERVATION FAILURE"): the marketing_generation_usage.cost_source
// COLUMN is a coarse, DB-enforced two-state axis — see
// marketing_generation_usage_cost_source_check on the real table
// ("estimated" | "provider_confirmed", added by 20260901000000_
// marketing_generation_usage_ledger_extension.sql) and that column's own
// comment: "how confident is the cost figure this row carries right
// now." A caller's more specific estimate METHODOLOGY (e.g. OpenAI's own
// "openai_conservative_ceiling_estimate" label from marketing-cost-
// config.js's estimateOpenAiImageCostCents(), distinct from the generic
// Cloudflare-shaped estimate) is real, useful information, but it was
// never a value this column's CHECK constraint accepts.
//
// PROVEN root cause (staging trace_id 71d67575-53dc-42bc-9b67-
// 0764847fbb8b): attemptPremiumCreativeGeneration() passes
// costSource: costEstimate.cost_source, i.e. literally
// "openai_conservative_ceiling_estimate", straight into this insert's
// cost_source column — every single OpenAI reservation attempt
// deterministically violates marketing_generation_usage_cost_source_check
// (confirmed directly against the real staging constraint: `select
// 'openai_conservative_ceiling_estimate' = ANY (ARRAY['estimated',
// 'provider_confirmed'])` returns false) and Postgres refuses the
// insert — never a Cloudflare-specific bug, never a routing/flag/
// provider-configured bug (all independently proven fine by the same
// staging trace).
//
// FIX (schema is correct — its own comment says exactly what it's for;
// this is an application payload bug, not a schema bug — no migration):
// normalize any caller-supplied costSource down to the two DB-legal
// values before it ever reaches the column, and preserve the caller's
// original, more specific label in `metadata` instead — the exact same
// place completeProviderCall() below already puts this identical kind of
// provider-specific detail (see its own `metadata: { ..., costSource }`
// call sites), so no information is silently lost, it just moves to the
// field that was always meant to hold it.
const VALID_COST_SOURCES = new Set(["estimated", "provider_confirmed"]);

function normalizeCostSourceForInsert(rawCostSource, metadata) {
  const costSource = String(rawCostSource || "estimated");
  if (VALID_COST_SOURCES.has(costSource)) {
    return { cost_source: costSource, metadata };
  }
  return { cost_source: "estimated", metadata: { ...metadata, cost_source_detail: costSource } };
}

// Part 3 ("STRICT EVIDENCE MODE" follow-up): a SAFE, non-secret
// classification of a real Postgres/PostgREST error into a short,
// actionable code — "insert_failed" alone (this module's own prior
// behavior) was proven too coarse to diagnose a real staging failure
// without direct schema inspection. Never persists/returns raw SQL text,
// column values, or anything that could carry customer/secret data —
// only the error's own already-safe SQLSTATE code and, for a check
// violation, the constraint's own name (a schema identifier, never row
// data). Falls back to "unknown_database_error" for anything this
// mapping doesn't recognize — never guesses a specific cause it can't
// actually confirm from the error object.
export function classifyDatabaseErrorCode(error) {
  const sqlState = error?.code ? String(error.code) : null;
  switch (sqlState) {
    case "23502":
      return "not_null_violation";
    case "23503":
      return "foreign_key_violation";
    case "23505":
      return "duplicate";
    case "23514":
      return "check_violation";
    case "42501":
      return "rls_denied";
    case "42703":
      return "invalid_column";
    default:
      return "unknown_database_error";
  }
}

/**
 * Reserves (inserts) one usage row BEFORE the provider call it accounts
 * for. Returns { ok: false, error, errorCode } if the write itself
 * failed — the caller must not proceed to the real provider call in that
 * case. `errorCode` is always one of classifyDatabaseErrorCode()'s own
 * safe values (never raw SQL text) so a caller can persist a specific,
 * actionable diagnostic without ever risking a secret/data leak.
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
    metadata = {},
    // Hybrid Marketing Studio Batch 2: estimateCostCents()'s own generic
    // per-purpose table (image_standard=4¢, etc.) is Cloudflare's real
    // rate, not any other provider's. A caller for a provider with its
    // own real cost model (e.g. marketing-cost-config.js's conservative
    // OpenAI ceiling, estimateOpenAiImageCostCents()) supplies the
    // already-computed figure here instead — reusing the SAME ledger
    // rather than forking a second reservation path per provider. Omit
    // for the existing Cloudflare-shaped behavior, unchanged.
    estimatedCostCentsOverride = null,
    costSource = "estimated"
  } = {}
) {
  if (!shopId) return { ok: false, error: "reserveProviderCall requires shopId.", errorCode: "invalid_input" };
  if (!purpose) return { ok: false, error: "reserveProviderCall requires purpose.", errorCode: "invalid_input" };
  const estimatedCostCents = estimatedCostCentsOverride != null ? estimatedCostCentsOverride : estimateCostCents({ purpose, unitType, units });
  const { cost_source: normalizedCostSource, metadata: normalizedMetadata } = normalizeCostSourceForInsert(costSource, metadata);
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
        cost_source: normalizedCostSource,
        trace_id: traceId,
        operation_id: operationId,
        attempt_index: attemptIndex,
        metadata: normalizedMetadata
      })
      .select("id")
      .single();
    if (result.error) return { ok: false, error: result.error.message, errorCode: classifyDatabaseErrorCode(result.error) };
    return { ok: true, usageId: result.data.id, estimatedCostCents };
  } catch (error) {
    // A ledger write must fail closed the same way a real DB error would
    // — never let an exception here be mistaken for "no reservation
    // needed."
    return { ok: false, error: String(error?.message || error).slice(0, 300), errorCode: classifyDatabaseErrorCode(error) };
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
  if (!usageId) return { ok: false, error: "completeProviderCall requires usageId.", errorCode: "invalid_input" };
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
    if (result.error) return { ok: false, error: result.error.message, errorCode: classifyDatabaseErrorCode(result.error) };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 300), errorCode: classifyDatabaseErrorCode(error) };
  }
}

/**
 * Marks a reserved usage row as failed — the provider call this row
 * accounted for did not succeed. Never throws; a failure to even RECORD
 * the failure degrades to { ok: false } rather than silently pretending
 * the ledger is consistent.
 */
export async function failProviderCall(client, usageId, { error = null, metadata = null } = {}) {
  if (!usageId) return { ok: false, error: "failProviderCall requires usageId.", errorCode: "invalid_input" };
  try {
    const result = await client
      .from("marketing_generation_usage")
      .update({
        status: "failed",
        metadata: metadata || { error: String(error?.message || error || "").slice(0, 300) }
      })
      .eq("id", usageId);
    if (result.error) return { ok: false, error: result.error.message, errorCode: classifyDatabaseErrorCode(result.error) };
    return { ok: true };
  } catch (thrown) {
    return { ok: false, error: String(thrown?.message || thrown).slice(0, 300), errorCode: classifyDatabaseErrorCode(thrown) };
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
