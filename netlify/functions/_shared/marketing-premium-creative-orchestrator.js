/**
 * Premium AI Creative — real server-side orchestration (Hybrid Marketing
 * Studio Batch 2, Parts 5/6/7/8/9/10/11; Batch 4, "async job architecture").
 *
 * ============================================================================
 * STAGING-ONLY. NOT ACTIVE IN PRODUCTION TODAY.
 * ============================================================================
 * This is the real code path a future live request would take — not a
 * mock, not test scaffolding. It is provably inert in every deployed
 * environment as of Batch 2 because ALL FOUR of these must independently
 * be true before it ever reaches a real network call, and none of them
 * are true anywhere today:
 *   1. The shop's own `marketing_openai_premium_creative` feature flag
 *      (checked by the caller — see marketing-studio.js integration)
 *   2. A real OPENAI_API_KEY is configured
 *   3. marketing-engine-router.js's routeMarketingEngine() actually
 *      returned "premium_ai_creative" for this request
 *   4. checkSafeMarketingPreviewEnvironment() passes — which REQUIRES
 *      FLORISYN_ENV to be explicitly "preview"/"staging" (never true on
 *      a real production deploy) and refuses outright if the Supabase
 *      host matches the configured production project.
 * ============================================================================
 *
 * Never a second Marketing Studio pipeline (Ashley's own instruction):
 * this reuses buildOpenAiCreativeBrief() (Batch 1), the existing OpenAI
 * provider adapter and registry, the existing usage ledger
 * (reserveProviderCall/completeProviderCall/failProviderCall), and the
 * existing preview/environment guard. Nothing here re-implements any of
 * those.
 *
 * Batch 4 ("async job architecture" — a real staging 504 proved a
 * synchronous OpenAI image call cannot safely live inside generate_
 * content's own request/response cycle): split into two phases so a
 * synchronous caller (marketing-studio.js) can do the FAST part
 * (validate everything, reserve usage) and return immediately, while a
 * Background Function (marketing-premium-creative-background.js) does
 * the SLOW part (the real network call) out of band, with zero
 * duplicated business logic:
 *   - reservePremiumCreativeGeneration() — env/provider/brief/cost-
 *     estimate gates + the usage-ledger reservation. Never calls
 *     provider.generate(). Fast, synchronous-safe.
 *   - executeReservedPremiumCreativeGeneration() — given an ALREADY-
 *     successful reservation (rebuilt from durable state, since a
 *     Background Function is a separate process with no shared memory
 *     from the request that reserved it), rebuilds the exact same brief
 *     (a pure function of the same inputs — deterministic, so
 *     recomputing it in a second process can never disagree with the
 *     first) and makes the real provider.generate() call.
 *   - attemptPremiumCreativeGeneration() — kept for full backward
 *     compatibility (existing tests, any future synchronous-only
 *     caller): simply runs both phases back to back in one process,
 *     with IDENTICAL externally-observable behavior to before this
 *     split.
 */

import { buildConfiguredMarketingImageProviderRegistry } from "./marketing-image-providers.js";
import { PROVIDER_NAME as OPENAI_PROVIDER_NAME } from "./marketing-image-provider-openai.js";
import { buildOpenAiCreativeBrief } from "./marketing-openai-creative-brief.js";
import { checkSafeMarketingPreviewEnvironment } from "./marketing-preview-environment-guard.js";
import { reserveProviderCall, completeProviderCall, failProviderCall } from "./marketing-provider-usage.js";
import { OPENAI_PREMIUM_CREATIVE_OPERATION } from "./marketing-premium-design-entitlement.js";
import { buildPremiumOperationId } from "./marketing-premium-creative-job.js";

// The controlled, honest states a Premium Creative attempt can end in.
// Never "success" unless a real image URL actually came back — see Part
// 9's own instruction: "never invent a fake success."
export const PREMIUM_CREATIVE_STATES = Object.freeze({
  SUCCESS: "success",
  ENVIRONMENT_BLOCKED: "environment_blocked",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
  BRIEF_UNAVAILABLE: "brief_unavailable",
  RESERVATION_FAILED: "reservation_failed",
  PROVIDER_CALL_FAILED: "provider_call_failed",
  // Batch 4: the reservation succeeded but the real provider call has
  // been handed off to a Background Function — never a terminal state
  // on its own; reservePremiumCreativeGeneration()'s own success value.
  RESERVED: "reserved"
});

// GPT-Image-2 only supports three output sizes (see marketing-image-
// provider-openai.js's own SIZE_BY_ASPECT_RATIO), while Florisyn's own
// flyer-templates.js names aspect ratios by pixel dimensions ("square",
// "story", "flyer", ...). Picks whichever of the three OpenAI-supported
// ratios is closest by log-ratio distance (a real, order-independent way
// to compare "how different are these two aspect ratios" that treats
// 2:1 and 1:2 as equally far from 1:1) — never a guess, never a silent
// default to "1:1" for a request that was actually portrait/landscape.
const OPENAI_ASPECT_RATIO_CANDIDATES = Object.freeze([
  { key: "1:1", value: 1 },
  { key: "3:2", value: 3 / 2 },
  { key: "2:3", value: 2 / 3 }
]);

export function resolveOpenAiAspectRatio({ width, height } = {}) {
  const w = Number(width) || 1;
  const h = Number(height) || 1;
  const ratio = w / h;
  let best = OPENAI_ASPECT_RATIO_CANDIDATES[0];
  let bestDiff = Math.abs(Math.log(ratio) - Math.log(best.value));
  for (const candidate of OPENAI_ASPECT_RATIO_CANDIDATES.slice(1)) {
    const diff = Math.abs(Math.log(ratio) - Math.log(candidate.value));
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return best.key;
}

// Batch 3 staging-acceptance fix ("STRICT EVIDENCE MODE"): the specific,
// non-vague reason vocabulary Ashley's own spec requires — never the
// generic "failed"/"unavailable"/"error" a caller can't act on. Exported
// so marketing-studio.js's own diagnostic (router/eligibility/fallback,
// none of which this module can see) can reuse the exact same codes for
// its own `fallback.reason` rather than inventing a second vocabulary.
export const PREMIUM_CREATIVE_REASON_CODES = Object.freeze({
  ROUTER_EXACT_LAYOUT: "router_exact_layout",
  FEATURE_FLAG_DISABLED: "feature_flag_disabled",
  PREVIEW_GUARD_FAILED: "preview_guard_failed",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
  PROVIDER_NOT_CONFIGURED: "provider_not_configured",
  BRIEF_BUILD_FAILED: "brief_build_failed",
  COST_ESTIMATE_FAILED: "cost_estimate_failed",
  RESERVATION_FAILED: "reservation_failed",
  PROVIDER_REQUEST_FAILED: "provider_request_failed",
  PROVIDER_RESPONSE_INVALID: "provider_response_invalid",
  PROVIDER_UPLOAD_FAILED: "provider_upload_failed",
  PREMIUM_SUCCESS: "premium_success",
  // Batch 4: the reservation-only phase succeeded; the real call is
  // pending in the Background Function. Not a failure — used only as an
  // intermediate diagnostic reason, never a terminal fallback.reason.
  PREMIUM_PENDING: "premium_pending"
});

/** Part 5/8: a provider.generate() failure carries `stage` ("config" /
 * "provider" / "upload") and, for a real HTTP round trip, `status` (null
 * only when no response was ever received at all — a network-level
 * failure). Maps that real, already-computed shape to the one specific
 * reason code it actually represents — never a second guess at what went
 * wrong beyond what the provider adapter itself already reported. */
function classifyProviderCallFailure(generation) {
  if (generation.stage === "upload") return PREMIUM_CREATIVE_REASON_CODES.PROVIDER_UPLOAD_FAILED;
  if (generation.status == null) return PREMIUM_CREATIVE_REASON_CODES.PROVIDER_REQUEST_FAILED;
  return PREMIUM_CREATIVE_REASON_CODES.PROVIDER_RESPONSE_INVALID;
}

function freshDiagnostic() {
  return {
    environment: { preview_guard_ok: null, preview_guard_errors: null },
    provider: { configured: null, selected: null, name: OPENAI_PROVIDER_NAME, model: null },
    usage: { reservation_attempted: false, reservation_id: null, reservation_status: null, reservation_error_code: null },
    execution: { provider_generate_entered: false, provider_http_status: null, provider_result_ok: null },
    orchestrator: { attempted: true, status: null, reason: null }
  };
}

/** Resolves the provider through the SAME registry every caller uses —
 * never a second, ad-hoc provider construction. Pure/cheap: no network
 * call, just reads env and (in tests) the injected factory. Safe to call
 * independently from two separate processes (the synchronous reservation
 * phase and the Background Function's execution phase) since it always
 * returns the same answer for the same env. */
function resolveProvider(env, providerFactory) {
  const registry = providerFactory ? { [OPENAI_PROVIDER_NAME]: providerFactory(env) } : buildConfiguredMarketingImageProviderRegistry(env);
  return registry[OPENAI_PROVIDER_NAME] || null;
}

/**
 * Batch 4, phase 1: everything through the usage-ledger reservation —
 * environment guard, provider resolution/configuration, the deterministic
 * brief builder (Part 7/8), OpenAI's own cost estimate, and finally
 * reserveProviderCall() itself. Never calls provider.generate(). Fast
 * (no outbound network call to OpenAI) and safe to run inside a
 * synchronous request/response cycle.
 *
 * @returns {Promise<object>} `{ ok:false, state, reason, diagnostic }` on
 *   any gate failure (same states attemptPremiumCreativeGeneration always
 *   used), or `{ ok:true, state:"reserved", diagnostic, reservation:
 *   {usageId, model}, jobId }` once the reservation has actually been
 *   written.
 */
export async function reservePremiumCreativeGeneration({
  client,
  shopId,
  contentItemId = null,
  jobId = null,
  canonicalConcept,
  creativeDirection,
  factSafeCopyPlan = {},
  verifiedShopBrandData = {},
  referenceImageMeta = null,
  aspectRatio = "1:1",
  qualityTier = "medium",
  traceId = null,
  attemptIndex = 0,
  env = process.env,
  providerFactory = null
} = {}) {
  const diag = freshDiagnostic();

  // Part 10: staging-only environment safety, unconditional (not gated
  // behind "if this deploy already claims to be preview" the way the
  // general Marketing preview guard is) — Premium Creative must
  // affirmatively PROVE it is running somewhere safe, including refusing
  // a real production deploy that never set FLORISYN_ENV at all.
  const envCheck = checkSafeMarketingPreviewEnvironment(env);
  diag.environment.preview_guard_ok = envCheck.ok;
  diag.environment.preview_guard_errors = envCheck.ok ? [] : envCheck.errors.map((e) => String(e).slice(0, 200));
  if (!envCheck.ok) {
    diag.orchestrator.status = PREMIUM_CREATIVE_STATES.ENVIRONMENT_BLOCKED;
    diag.orchestrator.reason = PREMIUM_CREATIVE_REASON_CODES.PREVIEW_GUARD_FAILED;
    return { ok: false, state: PREMIUM_CREATIVE_STATES.ENVIRONMENT_BLOCKED, reasons: envCheck.errors, diagnostic: diag };
  }

  const provider = resolveProvider(env, providerFactory);
  diag.provider.selected = Boolean(provider);
  diag.provider.configured = provider ? provider.configured() : false;
  if (!provider) {
    diag.orchestrator.status = PREMIUM_CREATIVE_STATES.PROVIDER_UNAVAILABLE;
    diag.orchestrator.reason = PREMIUM_CREATIVE_REASON_CODES.PROVIDER_UNAVAILABLE;
    return { ok: false, state: PREMIUM_CREATIVE_STATES.PROVIDER_UNAVAILABLE, reason: "OpenAI Premium Creative provider was not selected in this environment.", diagnostic: diag };
  }
  if (!provider.configured()) {
    diag.orchestrator.status = PREMIUM_CREATIVE_STATES.PROVIDER_UNAVAILABLE;
    diag.orchestrator.reason = PREMIUM_CREATIVE_REASON_CODES.PROVIDER_NOT_CONFIGURED;
    return { ok: false, state: PREMIUM_CREATIVE_STATES.PROVIDER_UNAVAILABLE, reason: "OpenAI Premium Creative is not configured in this environment.", diagnostic: diag };
  }
  diag.provider.model = provider.model;

  // Part 7/8: the one deterministic brief builder — never raw request
  // text. Only used here to PROVE it can build (fail closed if not); the
  // execution phase rebuilds the identical brief from the same inputs
  // rather than this phase trying to serialize/hand it across a process
  // boundary — buildOpenAiCreativeBrief is pure, so recomputing it later
  // from the same canonicalConcept/creativeDirection/factSafeCopyPlan/
  // verifiedShopBrandData can never disagree with this check.
  const brief = buildOpenAiCreativeBrief({ canonicalConcept, creativeDirection, factSafeCopyPlan, verifiedShopBrandData, referenceImageMeta });
  if (!brief.ok) {
    diag.orchestrator.status = PREMIUM_CREATIVE_STATES.BRIEF_UNAVAILABLE;
    diag.orchestrator.reason = PREMIUM_CREATIVE_REASON_CODES.BRIEF_BUILD_FAILED;
    return { ok: false, state: PREMIUM_CREATIVE_STATES.BRIEF_UNAVAILABLE, reason: brief.error, diagnostic: diag };
  }

  const costEstimate = provider.estimateCost({ qualityTier });
  if (!costEstimate) {
    diag.orchestrator.status = PREMIUM_CREATIVE_STATES.PROVIDER_UNAVAILABLE;
    diag.orchestrator.reason = PREMIUM_CREATIVE_REASON_CODES.COST_ESTIMATE_FAILED;
    return { ok: false, state: PREMIUM_CREATIVE_STATES.PROVIDER_UNAVAILABLE, reason: `Unsupported quality tier for Premium Creative: "${qualityTier}".`, diagnostic: diag };
  }

  // Part 11: reserve BEFORE the real call, using OpenAI's own conservative
  // cost model (never the generic Cloudflare-shaped estimateCostCents()).
  // A real OpenAI call must never happen without a durable reservation
  // first — provider.generate() is never called anywhere in this phase.
  //
  // Batch 4.1: operationId is a deterministic RFC4122 v5 UUID derived
  // from "premium_creative:<contentItemId>:<attemptIndex>" — the SAME
  // logical identity ai_execution_jobs.idempotency_key already enforces
  // job-level uniqueness for (see marketing-premium-creative-job.js's own
  // doc). A real database-enforced partial unique index on operation_id
  // (marketing_generation_usage_premium_operation_uidx) is what makes
  // onConflictReturnExisting safe: if some other request already reserved
  // this exact attempt (structurally shouldn't happen given the
  // job-level gate runs first, but kept as defense in depth against any
  // future caller that reserves without going through it), THAT row is
  // loaded and returned here instead of erroring — never a second real
  // reservation for the same logical attempt.
  diag.usage.reservation_attempted = true;
  const operationId = contentItemId ? buildPremiumOperationId(contentItemId, attemptIndex) : null;
  const reservation = await reserveProviderCall(client, {
    shopId,
    contentItemId,
    jobId,
    provider: OPENAI_PROVIDER_NAME,
    model: provider.model,
    purpose: "image",
    operation: OPENAI_PREMIUM_CREATIVE_OPERATION,
    unitType: "image",
    units: 1,
    traceId,
    operationId,
    attemptIndex,
    estimatedCostCentsOverride: costEstimate.cents,
    costSource: costEstimate.cost_source,
    metadata: { aspectRatio, qualityTier },
    onConflictReturnExisting: Boolean(operationId)
  });
  if (!reservation.ok) {
    diag.usage.reservation_status = "insert_failed";
    diag.usage.reservation_error_code = reservation.errorCode || "unknown_database_error";
    diag.orchestrator.status = PREMIUM_CREATIVE_STATES.RESERVATION_FAILED;
    diag.orchestrator.reason = PREMIUM_CREATIVE_REASON_CODES.RESERVATION_FAILED;
    return { ok: false, state: PREMIUM_CREATIVE_STATES.RESERVATION_FAILED, reason: reservation.error, diagnostic: diag };
  }
  diag.usage.reservation_id = reservation.usageId;
  diag.usage.reservation_status = "estimated";
  diag.orchestrator.status = PREMIUM_CREATIVE_STATES.RESERVED;
  diag.orchestrator.reason = PREMIUM_CREATIVE_REASON_CODES.PREMIUM_PENDING;

  // The winning row's own real job_id — never blindly trust the
  // caller-supplied `jobId` when a conflict handed back a DIFFERENT
  // already-existing reservation (only possible if a future caller
  // reserves without going through the job-level gate first; the normal
  // path always agrees).
  const resolvedJobId = reservation.alreadyExisted && reservation.jobId ? reservation.jobId : jobId;

  return {
    ok: true,
    state: PREMIUM_CREATIVE_STATES.RESERVED,
    diagnostic: diag,
    jobId: resolvedJobId,
    alreadyExisted: Boolean(reservation.alreadyExisted),
    reservation: { usageId: reservation.usageId, model: provider.model }
  };
}

/**
 * Batch 4, phase 2: given an ALREADY-successful reservation (from
 * reservePremiumCreativeGeneration(), possibly in a different process —
 * a Background Function has no memory shared with the request that
 * reserved), rebuilds the identical deterministic brief and makes the
 * real provider.generate() call, then settles the usage row.
 *
 * @param {object} params - the SAME canonicalConcept/creativeDirection/
 *   factSafeCopyPlan/verifiedShopBrandData/aspectRatio/qualityTier/
 *   traceId/env/providerFactory the reservation phase was called with —
 *   the caller (the Background Function) is responsible for loading
 *   these back from durable storage (the job row) since nothing here is
 *   held in memory from the synchronous request.
 * @param {string} params.reservationId - the usage row id reservePremium
 *   CreativeGeneration() already created.
 * @param {object} [params.initialDiagnostic] - the diagnostic
 *   reservePremiumCreativeGeneration() returned; continued forward here
 *   rather than rebuilt, so environment/provider/usage fields are never
 *   silently re-derived a second time.
 * @param {(diag: object) => (void|Promise<void>)} [params.onBeforeProviderCall] -
 *   invoked with the current diagnostic snapshot immediately after
 *   `execution.provider_generate_entered` is set true and BEFORE the
 *   outbound fetch — this is the ONE hook point a caller (the Background
 *   Function) uses to durably persist the "provider call starting" marker
 *   (Part E) into ai_execution_jobs before the real network call begins,
 *   so a hard process death after this point is distinguishable from one
 *   before it. Awaited if it returns a promise.
 * @param {(diag: object) => (void|Promise<void>)} [params.onAfterProviderCall] -
 *   invoked once the provider call has returned (success or failure),
 *   before usage settlement — lets the caller durably persist the
 *   "provider call finished" marker. Awaited if it returns a promise.
 */
export async function executeReservedPremiumCreativeGeneration({
  client,
  shopId,
  contentItemId = null,
  canonicalConcept,
  creativeDirection,
  factSafeCopyPlan = {},
  verifiedShopBrandData = {},
  referenceImageMeta = null,
  aspectRatio = "1:1",
  qualityTier = "medium",
  traceId = null,
  filename = null,
  reservationId,
  initialDiagnostic = null,
  env = process.env,
  providerFactory = null,
  onBeforeProviderCall = null,
  onAfterProviderCall = null
} = {}) {
  const diag = initialDiagnostic ? JSON.parse(JSON.stringify(initialDiagnostic)) : freshDiagnostic();

  const provider = resolveProvider(env, providerFactory);
  if (!provider || !provider.configured()) {
    // Structurally shouldn't happen (the reservation phase already
    // proved this env has a configured provider moments earlier), but a
    // Background Function is a genuinely separate invocation — fail
    // closed honestly rather than assume.
    diag.orchestrator.status = PREMIUM_CREATIVE_STATES.PROVIDER_UNAVAILABLE;
    diag.orchestrator.reason = PREMIUM_CREATIVE_REASON_CODES.PROVIDER_NOT_CONFIGURED;
    return { ok: false, state: PREMIUM_CREATIVE_STATES.PROVIDER_UNAVAILABLE, reason: "OpenAI Premium Creative is not configured for this execution.", diagnostic: diag };
  }

  const brief = buildOpenAiCreativeBrief({ canonicalConcept, creativeDirection, factSafeCopyPlan, verifiedShopBrandData, referenceImageMeta });
  if (!brief.ok) {
    diag.orchestrator.status = PREMIUM_CREATIVE_STATES.BRIEF_UNAVAILABLE;
    diag.orchestrator.reason = PREMIUM_CREATIVE_REASON_CODES.BRIEF_BUILD_FAILED;
    return { ok: false, state: PREMIUM_CREATIVE_STATES.BRIEF_UNAVAILABLE, reason: brief.error, diagnostic: diag };
  }

  // The real call. Genuinely billable if it ever actually reaches OpenAI
  // — inert here only because provider.configured() (checked above) is
  // false in every real environment today (see file header).
  diag.execution.provider_generate_entered = true;
  if (onBeforeProviderCall) await onBeforeProviderCall({ ...diag });

  const generation = await provider.generate({ client, shopId, prompt: buildBackgroundPromptFromBrief(brief), filename, aspectRatio, qualityTier, traceId });
  diag.execution.provider_result_ok = generation.ok;
  diag.execution.provider_http_status = generation.status ?? null;

  if (onAfterProviderCall) await onAfterProviderCall({ ...diag });

  if (!generation.ok) {
    await failProviderCall(client, reservationId, { error: generation.error });
    diag.usage.reservation_status = "failed";
    diag.orchestrator.status = PREMIUM_CREATIVE_STATES.PROVIDER_CALL_FAILED;
    diag.orchestrator.reason = classifyProviderCallFailure(generation);
    return { ok: false, state: PREMIUM_CREATIVE_STATES.PROVIDER_CALL_FAILED, reason: generation.error, usageId: reservationId, diagnostic: diag };
  }

  await completeProviderCall(client, reservationId, {
    actualCostCents: generation.actualCostCents ?? null,
    metadata: { usage: generation.usage || null, costSource: generation.costSource }
  });
  diag.usage.reservation_status = "actual";
  diag.orchestrator.status = PREMIUM_CREATIVE_STATES.SUCCESS;
  diag.orchestrator.reason = PREMIUM_CREATIVE_REASON_CODES.PREMIUM_SUCCESS;

  // Part 7: one authoritative result object — everything finalize_flyer_
  // render / the client needs to know, nothing more. Part 8: overlays
  // carries the fact-critical text Florisyn's own deterministic renderer
  // must draw — never text the image model was asked to render.
  return {
    ok: true,
    state: PREMIUM_CREATIVE_STATES.SUCCESS,
    diagnostic: diag,
    result: {
      engine: "premium_ai_creative",
      provider: OPENAI_PROVIDER_NAME,
      model: provider.model,
      backgroundImageUrl: generation.url,
      creativeDirection,
      canonicalConcept,
      overlays: {
        styleText: brief.styleText,
        deterministicText: brief.deterministicText,
        factsAllowed: brief.factsAllowed
      },
      qualityStatus: "unverified",
      usageReservationId: reservationId,
      traceId
    }
  };
}

/**
 * Attempts one real Premium AI Creative generation SYNCHRONOUSLY, start
 * to finish, in one process. Kept for full backward compatibility (every
 * Batch 2/3 test, and any future purely-synchronous caller) — behaves
 * IDENTICALLY to before Batch 4's async split, by simply running
 * reservePremiumCreativeGeneration() then (on success)
 * executeReservedPremiumCreativeGeneration() back to back. The real,
 * live-traffic-facing path (marketing-studio.js) no longer calls this —
 * it calls the two phases separately so the reservation returns fast and
 * the real provider call happens in a Background Function instead. Never
 * throws; every outcome is a typed `{ ok, state, ... }` result.
 *
 * @param {object} params
 * @param {import('@supabase/supabase-js').SupabaseClient} params.client
 * @param {string} params.shopId
 * @param {string|null} [params.contentItemId]
 * @param {object} params.canonicalConcept - buildCanonicalConcept()'s own output.
 * @param {object} params.creativeDirection - buildDeterministicCreativeDirection()'s own output.
 * @param {object} [params.factSafeCopyPlan] - { headline, body, cta, caption } that already passed evaluateMarketingOutput().
 * @param {object} [params.verifiedShopBrandData] - the shop's own verified brand record.
 * @param {object|null} [params.referenceImageMeta]
 * @param {string} [params.aspectRatio]
 * @param {string} [params.qualityTier]
 * @param {string|null} [params.traceId]
 * @param {string|null} [params.filename]
 * @param {object} [params.env] - defaults to process.env.
 * @param {(env: object) => object} [params.providerFactory] - defaults to
 *   the real createOpenAiMarketingImageProvider; overridable in tests so
 *   generate() can be mocked without touching process.env or the network.
 * @returns {Promise<object>}
 */
export async function attemptPremiumCreativeGeneration({
  client,
  shopId,
  contentItemId = null,
  canonicalConcept,
  creativeDirection,
  factSafeCopyPlan = {},
  verifiedShopBrandData = {},
  referenceImageMeta = null,
  aspectRatio = "1:1",
  qualityTier = "medium",
  traceId = null,
  filename = null,
  env = process.env,
  providerFactory = null
} = {}) {
  const reserved = await reservePremiumCreativeGeneration({
    client,
    shopId,
    contentItemId,
    canonicalConcept,
    creativeDirection,
    factSafeCopyPlan,
    verifiedShopBrandData,
    referenceImageMeta,
    aspectRatio,
    qualityTier,
    traceId,
    env,
    providerFactory
  });
  if (!reserved.ok) return reserved;

  return executeReservedPremiumCreativeGeneration({
    client,
    shopId,
    contentItemId,
    canonicalConcept,
    creativeDirection,
    factSafeCopyPlan,
    verifiedShopBrandData,
    referenceImageMeta,
    aspectRatio,
    qualityTier,
    traceId,
    filename,
    reservationId: reserved.reservation.usageId,
    initialDiagnostic: reserved.diagnostic,
    env,
    providerFactory
  });
}

/**
 * Part 8: OpenAI is asked to compose the visual scene from styleText and
 * the creative direction's own mood/composition fields ONLY — never asked
 * to render any fact-critical sentence as literal on-image text (see
 * .claude/rules/marketing-studio.md: "Never ask an image-generation model
 * to render literal words, numbers, or signage"). deterministicText stays
 * out of the prompt entirely; it's returned in `overlays` above for
 * Florisyn's own renderer to draw as real pixels instead.
 */
function buildBackgroundPromptFromBrief(brief) {
  const styleLine = brief.styleText.map((s) => s.text).join(" ");
  const parts = [
    `A premium, bright, colorful, realistic floral photography composition for a "${brief.occasion || "everyday"}" florist post.`,
    `Visual mood: ${brief.visualMood || "warm and inviting"}. Palette mood: ${brief.paletteMood || "soft pastel"}.`,
    `Composition: ${brief.compositionIntent || "photo-forward"}, image prominence ${brief.imageProminence || "dominant"}.`,
    styleLine ? `Tone/style reference (do not render as literal text): ${styleLine}` : null,
    // Same directive ai-image-engine.js's own buildImagePrompt already
    // relies on — never render literal words/numbers/signage.
    "Do not include any readable text, numbers, logos, or signage in the image — pure photography/illustration only."
  ].filter(Boolean);
  return parts.join(" ");
}
