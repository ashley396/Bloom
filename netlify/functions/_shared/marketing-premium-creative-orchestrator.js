/**
 * Premium AI Creative — real server-side orchestration (Hybrid Marketing
 * Studio Batch 2, Parts 5/6/7/8/9/10/11).
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
 * No shop has (1) set yet (Part 14: "DO NOT write the feature flag yet"),
 * and no environment has (2) configured. This module exists so that once
 * those two things become true for a specific staging shop, the rest of
 * the path is already real, tested, and wired — not built under time
 * pressure at activation time.
 * ============================================================================
 *
 * Never a second Marketing Studio pipeline (Ashley's own instruction):
 * this reuses buildOpenAiCreativeBrief() (Batch 1), the existing OpenAI
 * provider adapter and registry, the existing usage ledger
 * (reserveProviderCall/completeProviderCall/failProviderCall), and the
 * existing preview/environment guard. Nothing here re-implements any of
 * those.
 */

import { buildConfiguredMarketingImageProviderRegistry } from "./marketing-image-providers.js";
import { PROVIDER_NAME as OPENAI_PROVIDER_NAME } from "./marketing-image-provider-openai.js";
import { buildOpenAiCreativeBrief } from "./marketing-openai-creative-brief.js";
import { checkSafeMarketingPreviewEnvironment } from "./marketing-preview-environment-guard.js";
import { reserveProviderCall, completeProviderCall, failProviderCall } from "./marketing-provider-usage.js";
import { OPENAI_PREMIUM_CREATIVE_OPERATION } from "./marketing-premium-design-entitlement.js";

// The controlled, honest states a Premium Creative attempt can end in.
// Never "success" unless a real image URL actually came back — see Part
// 9's own instruction: "never invent a fake success."
export const PREMIUM_CREATIVE_STATES = Object.freeze({
  SUCCESS: "success",
  ENVIRONMENT_BLOCKED: "environment_blocked",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
  BRIEF_UNAVAILABLE: "brief_unavailable",
  RESERVATION_FAILED: "reservation_failed",
  PROVIDER_CALL_FAILED: "provider_call_failed"
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

/**
 * Attempts one real Premium AI Creative generation. Never throws — every
 * outcome is a typed `{ ok, state, ... }` result so a caller can decide
 * what to show the florist without inspecting exception internals.
 *
 * Credit/usage-ledger contract (Part 9/12): reserveProviderCall() is only
 * ever called AFTER the environment guard and provider-configured check
 * both pass — a provider-configuration failure or a blocked environment
 * therefore NEVER writes a usage row and NEVER consumes a Premium Design
 * credit (marketing-premium-design-entitlement.js counts exactly these
 * reservation rows). A mocked test's fake client writing to its own
 * isolated fake table never touches a real shop's entitlement either way.
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
  PREMIUM_SUCCESS: "premium_success"
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
  // Batch 3 staging-acceptance fix ("STRICT EVIDENCE MODE — durable
  // runtime trace"): built incrementally, one field at a time, exactly as
  // each real gate below is actually evaluated — never recomputed or
  // guessed afterward. Every return path (success and every failure
  // state) carries this SAME nested object back to the caller, which
  // persists it verbatim onto the asset (marketing-studio.js) so a real
  // staging failure can be read back from Supabase instead of requiring
  // Netlify function-log access this account has already found
  // impractical to retrieve (Function log UI reports "No results found"
  // even over a 2-day range). Contains no secret: booleans, short
  // state/reason codes, a usage-ledger id, an HTTP status code, and the
  // preview guard's own already-non-secret violation sentences.
  const diag = {
    environment: { preview_guard_ok: null, preview_guard_errors: null },
    provider: { configured: null, selected: null, name: OPENAI_PROVIDER_NAME, model: null },
    usage: { reservation_attempted: false, reservation_id: null, reservation_status: null },
    execution: { provider_generate_entered: false, provider_http_status: null, provider_result_ok: null },
    orchestrator: { attempted: true, status: null, reason: null }
  };

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

  // Resolve the provider through the SAME registry every other caller
  // uses — never a second, ad-hoc provider construction.
  const registry = providerFactory ? { [OPENAI_PROVIDER_NAME]: providerFactory(env) } : buildConfiguredMarketingImageProviderRegistry(env);
  const provider = registry[OPENAI_PROVIDER_NAME];
  // Read straight off the same boolean the gate below actually branches
  // on — never a second, independently-recomputed "is it configured"
  // check that could disagree with the real decision.
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

  // Part 7/8: the one deterministic brief builder — never raw request text.
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
  // first — provider.generate() below is only ever reached past this
  // point, and diag.execution.provider_generate_entered stays false on
  // every return path above this line.
  diag.usage.reservation_attempted = true;
  const reservation = await reserveProviderCall(client, {
    shopId,
    contentItemId,
    provider: OPENAI_PROVIDER_NAME,
    model: provider.model,
    purpose: "image",
    operation: OPENAI_PREMIUM_CREATIVE_OPERATION,
    unitType: "image",
    units: 1,
    traceId,
    attemptIndex: 0,
    estimatedCostCentsOverride: costEstimate.cents,
    costSource: costEstimate.cost_source,
    metadata: { aspectRatio, qualityTier }
  });
  if (!reservation.ok) {
    diag.usage.reservation_status = "insert_failed";
    diag.orchestrator.status = PREMIUM_CREATIVE_STATES.RESERVATION_FAILED;
    diag.orchestrator.reason = PREMIUM_CREATIVE_REASON_CODES.RESERVATION_FAILED;
    return { ok: false, state: PREMIUM_CREATIVE_STATES.RESERVATION_FAILED, reason: reservation.error, diagnostic: diag };
  }
  diag.usage.reservation_id = reservation.usageId;
  diag.usage.reservation_status = "estimated";

  // The real call. Genuinely billable if it ever actually reaches OpenAI
  // — inert here only because provider.configured() (checked above) is
  // false in every real environment today (see file header).
  diag.execution.provider_generate_entered = true;
  const generation = await provider.generate({ client, shopId, prompt: buildBackgroundPromptFromBrief(brief), filename, aspectRatio, qualityTier, traceId });
  diag.execution.provider_result_ok = generation.ok;
  diag.execution.provider_http_status = generation.status ?? null;

  if (!generation.ok) {
    await failProviderCall(client, reservation.usageId, { error: generation.error });
    diag.usage.reservation_status = "failed";
    diag.orchestrator.status = PREMIUM_CREATIVE_STATES.PROVIDER_CALL_FAILED;
    diag.orchestrator.reason = classifyProviderCallFailure(generation);
    return { ok: false, state: PREMIUM_CREATIVE_STATES.PROVIDER_CALL_FAILED, reason: generation.error, usageId: reservation.usageId, diagnostic: diag };
  }

  await completeProviderCall(client, reservation.usageId, {
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
      usageReservationId: reservation.usageId,
      traceId
    }
  };
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
