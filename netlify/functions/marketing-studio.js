/**
 * Florisyn Marketing Studio — Founding Beta (admin-only) API surface.
 *
 * Stage B+C+D+E+F: Brand Brain read/write, connection status (never
 * tokens), usage/cost ledger summary, an honest `status` action, Stage C's
 * monthly content planner/calendar/approval workflow (plan_month/
 * content_calendar/list_content/approve_content), Stage D's real creative
 * generation (generate_content — real image+copy today, real script/
 * storyboard for video) plus AI Clone consent capture
 * (request_clone_enrollment/list_clone_consent/revoke_clone_consent),
 * Stage E's reliable publishing queue (enqueue_publish/
 * run_publishing_queue/publishing_health/connect_platform/
 * disconnect_platform), and Stage F's intelligence layer
 * (analytics_summary/list_insights/create_ab_experiment/
 * list_ab_experiments/evaluate_ab_experiment) — real machinery throughout,
 * but every actual publish attempt fails honestly today because no
 * platform has a live, approved adapter (see
 * _shared/marketing-social-providers.js), so Stage F's engagement/insight/
 * experiment data stays honestly empty until that changes. Nothing here
 * ever reports a post as published, or a pattern as proven, before real
 * data says so.
 *
 * Stage G: the first real provider is wired — HeyGen (avatar) +
 * ElevenLabs (voice), composed behind the same clone.* interface
 * (_shared/marketing-clone-provider-heygen-elevenlabs.js). It only
 * activates once BOTH HEYGEN_API_KEY and ELEVENLABS_API_KEY are actually
 * set in the environment (buildConfiguredCloneProviderRegistry()) — with
 * neither (or only one) configured, request_clone_enrollment and
 * preview_clone_profile still fall back to the not-live stub exactly as
 * before. Social publishing (Stage E) remains entirely not-live; only the
 * AI Clone side has a real, activatable provider today.
 *
 * upload_clone_reference_photo is a small convenience action used only by
 * the admin console's enrollment form: HeyGen's Photo Avatar Group API
 * needs real, publicly-fetchable photo URLs (not uploaded blobs), so this
 * hosts each reference photo in the public website-media bucket first and
 * returns its URL for request_clone_enrollment's reference_photo_urls.
 * clone_job_status polls a HeyGen video render started by generateVideo/
 * preview's video path (public/marketing-studio-admin.js is the first real
 * admin UI for any of this — Stages A-F shipped server-side only).
 *
 * Access control is two layers, both required (Section 5: admin-only must
 * be enforced server-side, not UI-hidden):
 *   1. isFeatureEnabled("MARKETING_STUDIO") — the kill switch.
 *   2. platformAdmin(event, ["super_admin"]) — only the founder account,
 *      the same mechanism admin-command-center.js/admin-photo-manager.js
 *      already use in production. No per-shop bypass exists; Ashley/
 *      Florisyn is Tenant Zero, reached the same way any future beta shop
 *      would be, not via a hard-coded special path.
 *
 * Follows the exact createXHandler(deps)/export const handler = createX()
 * dependency-injection convention every other platformAdmin() call site in
 * this codebase uses (see tests/platform-admin-authorization-boundary.test.js) —
 * parsePlatformAdminJsonBody() for request bodies, never bodyOf()/JSON.parse
 * directly, and platformAdminErrorResponse() for every failure path.
 */

import crypto from "node:crypto";
import { json, methodNotAllowed } from "./_shared/http.js";
import { admin as createServiceRoleClient } from "./_shared/saas.js";
import { structuredLog } from "./_shared/production.js";
import { isFeatureEnabled } from "./_shared/feature-flags.js";
import { isShopFeatureEnabled } from "./_shared/shop-feature-access.js";
import {
  platformAdmin,
  requireSuperAdmin,
  platformAdminErrorResponse,
  platformAdminError,
  parsePlatformAdminJsonBody,
  writeCommandAudit as writeCommandAuditShared
} from "./_shared/platform-admin.js";
import {
  loadBrandBrain,
  saveBrandBrain,
  applyExplicitBrandUpdates,
  recordBrandSignal,
  forgetBrandTrait,
  resetPreferences,
  buildBrandSummary
} from "./_shared/marketing-brand-brain.js";
import {
  STYLE_CATEGORIES as VISUAL_STYLE_CATEGORIES,
  loadStyleMemory,
  saveStyleMemory,
  applyExplicitPreferenceUpdates as applyExplicitVisualStyleUpdates,
  recordApprovalSignal as recordVisualStyleApprovalSignal,
  forgetPreference as forgetVisualStyleTrait,
  resetPreferences as resetVisualStylePreferences,
  activeTraits as activeVisualStyleTraits,
  buildStyleSummary as buildVisualStyleSummary
} from "./_shared/ai-style-memory.js";
import {
  SUPPORTED_PLATFORMS,
  isPlatformLive,
  isPlatformConfigured,
  platformOAuthEnvVarNames
} from "./_shared/marketing-social-providers.js";
import { OAUTH_SUPPORTED_PLATFORMS, isOAuthArchitected, buildAuthorizeUrl } from "./_shared/marketing-social-oauth.js";
import { resolvePublicSiteUrl } from "./_shared/site-url.js";
import { selectCloneProvider, notLiveCloneProvider, buildConfiguredCloneProviderRegistry } from "./_shared/marketing-clone-providers.js";
import { uploadClonedVoiceAudio, uploadWebsiteMedia, uploadFlyerRenderBuffer, publicWebsiteMediaUrl } from "./_shared/website-media.js";
import { validateFlyerRenderDataUrl, flyerApprovalBlockReason, contentApprovalBlockReason, verifyFlyerStorageObjectExists } from "./_shared/flyer-render.js";
import { parseDataUrl } from "./_shared/upload-validation.js";
import { buildIdempotencyKey } from "./_shared/marketing-publishing-queue.js";
import { runPublishingWorker } from "./_shared/marketing-publishing-worker.js";
import { scheduleContentItemVariants } from "./_shared/marketing-schedule-content.js";
import { runCompoundRequest } from "./_shared/marketing-compound-orchestrator.js";
import { runAnalyticsIngestion, reconcileLatestMetricSnapshots } from "./_shared/marketing-analytics-ingestion.js";
import { checkMonthlyBudgetForRequest, getShopBudgetCapCents, monthlyCommittedSpendCents } from "./_shared/marketing-budget-guard.js";
import { enforceSafeMarketingPreviewEnvironmentIfClaimed } from "./_shared/marketing-preview-environment-guard.js";
import { routeMarketingEngine } from "./_shared/marketing-engine-router.js";
import { reservePremiumCreativeGeneration, resolveOpenAiAspectRatio, PREMIUM_CREATIVE_REASON_CODES, PREMIUM_CREATIVE_STATES } from "./_shared/marketing-premium-creative-orchestrator.js";
import {
  findActivePremiumJobForContentItem,
  findLatestPremiumJobForContentItem,
  createOrContinuePremiumJob,
  buildPlannedAttemptStep,
  addPremiumJobAttempt,
  settlePremiumJobFailed,
  invokePremiumCreativeBackgroundFunction,
  PREMIUM_JOB_MAX_ATTEMPTS
} from "./_shared/marketing-premium-creative-job.js";
import { PROVIDER_NAME as OPENAI_PROVIDER_NAME } from "./_shared/marketing-image-provider-openai.js";
import { COST_CONFIG_VERSION, DEFAULT_MONTHLY_ALLOWANCE, estimateCostCents } from "./_shared/marketing-cost-config.js";
import { calculateWorstCaseBoundedCostCents, failProviderCall } from "./_shared/marketing-provider-usage.js";
import {
  buildMonthlyContentPlan,
  CONTENT_ITEM_APPROVABLE_STATUSES,
  resolveApprovalDecision
} from "./_shared/marketing-content-planner.js";
import { recordCloneVideoJob, getCloneVideoJob } from "./_shared/creative-ai/clone-video-jobs.js";
import { finalizeDigitalTwinJob } from "./_shared/creative-ai/digital-twin-finalization.js";
import { determineDisclosureRequirement, enforcePrePublishDisclosureGate, computeDisclosureFields } from "./_shared/creative-ai/disclosure-policy.js";
import { validateCloneConsentBody, isConsentActive } from "./_shared/marketing-clone-consent.js";
import { buildContentCalendarEvents, groupCalendarEventsByMonth } from "../../lib/marketing/calendar-events.js";
import { generateSocialPost, generateVideoConcept, generateWebsiteSectionDraft, generateFlyerContent, persistGeneratedAsset, sanitizedRequestForModel } from "./_shared/ai-creative-engine.js";
import { buildImagePrompt, buildFlyerBackgroundPrompt } from "./_shared/ai-image-engine.js";
import { runMarketingImageQuality } from "./_shared/marketing-image-quality.js";
import { pickFlyerTemplate, pickAspectRatio, ASPECT_RATIOS } from "./_shared/flyer-templates.js";
import { loadGenerationGrounding } from "./_shared/marketing-generation-grounding.js";
import { planVideoRender } from "./_shared/marketing-video-render-engine.js";
import {
  parseRevisionDeltas,
  detectPersistIntent,
  extractMoodPhrase,
  deriveRevisionTraits,
  factsPreserved,
  buildImageRevisionBrief,
  buildWordingRevisionRequestText,
  detectPermanentClosureMismatch,
  detectInventedOperationalContent,
  requestSignalsPlainOperationalNotice,
  buildDeterministicNoticeContent,
  buildDeterministicCreativeRescueContent,
  extractShopNameFromRequestText,
  requestNeedsFlyerWording,
  instructionAffectsFlyerWording,
  instructionAffectsFlyerImage,
  BEREAVEMENT_CONTEXT_RE,
  requestSignalsRealPromotion,
  requestSignalsIntentionalInventoryUse,
  evaluateMarketingOutput
} from "./_shared/marketing-content-revision.js";
import {
  buildCanonicalConcept,
  inheritConcept,
  detectExplicitConceptChangeRequest,
  detectConceptDrift,
  detectImageSubjectDrift,
  classifyOccasionCategory,
  classifyCtaIntent,
  classifyPrimarySubjectClass,
  deriveAssetRoute
} from "./_shared/marketing-canonical-concept.js";
import { buildDeterministicCreativeDirection, inheritCreativeDirection } from "./_shared/marketing-creative-direction.js";
import { evaluateMarketingDiversity } from "./_shared/marketing-content-diversity.js";
import { deriveApprovalObservations, dedupeTraits } from "./_shared/marketing-approval-learning.js";
import { defaultVisualStyle } from "./_shared/ai-visual-revisions.js";
import { buildMarketingStudioAnalyticsSummary } from "./_shared/marketing-analytics.js";
import { groupMetricsByDimension } from "./_shared/marketing-insights.js";
import { validateExperimentBody, determineExperimentWinner } from "./_shared/marketing-ab-testing.js";
import {
  defaultPreferences as defaultPersonalBrandPreferences,
  applyExplicitPreferenceUpdates as applyExplicitPersonalBrandUpdates,
  recordApprovalSignal as recordPersonalBrandApprovalSignal,
  forgetPreference as forgetPersonalBrandTrait,
  resetPreferences as resetPersonalBrandPreferences,
  buildPersonalBrandStyleSummary,
  loadPersonalBrandProfile,
  savePersonalBrandProfileFields,
  savePersonalBrandPreferences
} from "./_shared/personal-brand-memory.js";
import {
  validateReferencePhotoConsentBody,
  canUsePhotoFor,
  FEEDBACK_REASONS
} from "./_shared/creative-ai/personal-brand-consent.js";
import { getPersonalBrandMode, PERSONAL_BRAND_MODE_KEYS } from "./_shared/creative-ai/personal-brand-modes.js";
import { generatePersonalBrandConcept } from "./_shared/creative-ai/personal-brand-concept.js";
import { planPersonalBrandPlatformVariants, resolveTargetPlatforms } from "./_shared/creative-ai/personal-brand-platform-variants.js";
import { runPersonalBrandCommand, requestDigitalTwinGeneration } from "./_shared/creative-ai/personal-brand-service.js";

const VIDEO_CONTENT_TYPES = new Set(["reel", "short_video", "long_video"]);

/** Shapes a stored ai-style-memory preferences object into what the "My
 * Style" panel actually renders — active traits (the shop's real style)
 * grouped by category, plus any inferred trait still building evidence
 * toward the promotion threshold (honestly labeled "still learning", never
 * hidden and never presented as already part of the shop's style). No
 * embeddings, confidence scores, or model/internal terminology — see
 * netlify/functions/ai-style-memory.js's own toScreenPayload() for the
 * identical convention used by Lily Visual Creation Studio's own My Style
 * screen elsewhere in the app. */
function visualStyleScreenPayload(preferences) {
  const categories = {};
  for (const category of VISUAL_STYLE_CATEGORIES) {
    const traits = preferences[category]?.traits || [];
    categories[category] = {
      active: activeVisualStyleTraits(preferences, category),
      learning: traits.filter((t) => !t.active)
    };
  }
  return { categories, summary: buildVisualStyleSummary(preferences) };
}

// Priority 7 ("as far as technically possible" pass): the platform SET on
// a content item may only be edited (add_content_platform/
// remove_content_platform) while it's still in one of these statuses —
// "before approval/scheduling", matching the launch audit's own wording.
const PRE_APPROVAL_CONTENT_STATUSES = ["idea", "draft", "in_review"];

/**
 * Founding Beta private activation (Section 40 follow-up): the global
 * MARKETING_STUDIO flag stays false — Marketing Studio only becomes
 * reachable for a specific shop when that shop's OWN
 * shop_admin_config.features.marketing_studio_beta is explicitly true.
 * The super_admin requirement in platformAdmin() below is UNCHANGED and
 * NOT relaxed by this — this only widens which shop_ids a super_admin can
 * operate Marketing Studio against while the global flag is off; it does
 * not open access to ordinary shop-member logins (marketing-studio-shop.js
 * is the separate, florist-facing entry point for that).
 *
 * Uses the shared isShopFeatureEnabled() helper (Phase 2 of the "Florist-
 * Facing Marketing Studio" pass — see _shared/shop-feature-access.js) —
 * this admin handler's own `client` is already service-role, so it's
 * passed straight through rather than letting the helper create a second
 * one.
 */
async function featureGate(client, shopId) {
  if (await isShopFeatureEnabled(shopId, "marketing_studio_beta", { globalFlagName: "MARKETING_STUDIO", client })) return;
  throw platformAdminError("forbidden");
}

/** Non-throwing peek at the same shop_id key every action already reads via requireShopId(). */
function peekShopId(qs, body) {
  return body?.shop_id || qs?.shop_id || null;
}

function missingRelation(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST202" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("could not find the table")
  );
}

// Real-bug fix found while building Priority 2 (persisted budget
// controls): this used to hand-build a plain `new Error()` with its own
// `.florisynCode`/`.statusCode` set manually — but
// platformAdminErrorResponse() only ever trusts a `florisynCode` on an
// error actually BRANDED via platformAdminError() (isFlorisynPlatformAdminError
// checks WeakSet membership, not just the property's presence). A plain
// Error was never branded, so every caller of this function was silently
// getting the generic 500 "Unexpected Florisyn error" instead of the
// actionable "apply the migration" message — for the entire lifetime of
// every friendlyMissing() call site in this file, not just the ones this
// pass added. platformAdminError() is the correctly-branded builder.
function friendlyMissing() {
  return platformAdminError("marketing_studio_schema_unavailable");
}

function requireShopId(qs, body) {
  const shopId = body?.shop_id || qs?.shop_id;
  if (!shopId) throw platformAdminError("missing_shop_id");
  return shopId;
}

function parseYearMonth(qs, body) {
  const year = Number(body?.year ?? qs?.year);
  const month = Number(body?.month ?? qs?.month);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function monthRangeIso(year, month) {
  const start = `${year}-${String(month).padStart(2, "0")}-01T00:00:00.000Z`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00.000Z`;
  return { start, end };
}

/**
 * Local helper for the small set of actions a florist may reach directly
 * (see marketing-studio-shop.js) — passes for the existing super_admin
 * admin-console path exactly as before (requireSuperAdmin unchanged), OR
 * for a caller `createMarketingStudioHandler` has ITSELF already proven
 * to be an authorized shop actor (`deps.florist`, set only after real
 * session auth + real active membership + the shop's own beta access were
 * independently verified — see below). Never anything a request body,
 * query string, or header can set.
 */
function requireSuperAdminOrShopActor(admin, shopActorAuthorized) {
  if (shopActorAuthorized) return;
  requireSuperAdmin(admin);
}

/** Test seam — production uses bound real dependencies via exported `handler`. */
export function createMarketingStudioHandler(deps = {}) {
  return async function handler(event) {
    try {
      // Batch 6, Part B — independent-review finding (Part S): this guard
      // previously existed but was never actually called from a real
      // generation entry point, only from a separate advisory status
      // route. Called here, once, before any auth/DB work, covering
      // every action through the same single dispatch — never scattered
      // per action branch. A genuine production deploy never claims to
      // be preview (no FLORISYN_ENV/MARKETING_STUDIO_PREVIEW set there),
      // so this is a true no-op in production; it can only ever refuse a
      // request that is ALREADY claiming to be a preview/staging deploy
      // and whose actual configuration doesn't back that claim up.
      try {
        enforceSafeMarketingPreviewEnvironmentIfClaimed(process.env);
      } catch (guardError) {
        if (guardError?.code === "unsafe_marketing_preview_environment") {
          return json(guardError.statusCode || 412, { error: guardError.message, violations: guardError.violations });
        }
        throw guardError;
      }

      // Two auth paths into the exact same action dispatch below — never
      // two copies of the actions themselves. `deps.florist` is set ONLY
      // by marketing-studio-shop.js's own server-side code, after it has
      // independently verified real session auth (currentUser()), real
      // active shop membership, and the shop's own
      // shop_admin_config.features.marketing_studio_beta — never anything
      // a request to THIS handler could itself set.
      let client, user, admin, shopActorAuthorized;
      if (deps.florist) {
        ({ client, user } = deps.florist);
        admin = { user_id: user.id, role: "shop_member", active: true };
        shopActorAuthorized = true;
      } else {
        ({ client, user, admin } = await platformAdmin(event, ["super_admin"], deps));
        shopActorAuthorized = false;
      }
      // Every writeCommandAudit(...) call below (~50 action handlers) must
      // land in platform_admin_audit through a genuinely privileged
      // client, never whichever one this request happens to be using for
      // its own business-logic reads/writes. On the admin-console path
      // `client` already IS that privileged client (platformAdmin()'s own
      // service-role buildServerClient) — reuse it exactly as before. On
      // the florist path `client` is deps.florist.client, an ordinary
      // session-scoped `authenticated` client with zero grants on
      // platform_admin_audit (confirmed live: only service_role has real
      // DML there) — never let it near that table; writeCommandAuditShared
      // falls back to its own real service-role client instead. Shadowing
      // the shared import here, once, means every existing call site below
      // needs no change at all.
      const buildFloristAuditClient = deps.createAuditClient || createServiceRoleClient;
      const writeCommandAudit = (_callerClient, adminUserId, action, options) =>
        writeCommandAuditShared(client, adminUserId, action, options, deps.florist ? { createAuditClient: buildFloristAuditClient } : {});
      const method = event.httpMethod;
      const qs = event.queryStringParameters || {};
      const body = parsePlatformAdminJsonBody(event);
      // The florist's own session-resolved shop is authoritative — a
      // client-supplied shop_id (body or query string) is never trusted
      // once a real session shop is known, closing the direct-ID-attack
      // path (Shop A member sending Shop B's id) at its root rather than
      // relying on every individual action to reject it.
      if (deps.florist) body.shop_id = deps.florist.shopId;
      const action = String(body.action || qs.action || "status").toLowerCase();
      // The florist path already verified beta access (with its own
      // service-role read — shop_admin_config has no RLS grant for
      // `authenticated`, so re-running featureGate here against the
      // member-scoped client would always fail closed on a client
      // mismatch, not a real access problem) before ever calling this
      // handler; re-checking here would only risk that false negative,
      // not add real safety.
      if (!deps.florist) await featureGate(client, peekShopId(qs, body));

      if (action === "status") {
        const cloneProviderLive = Object.keys(buildConfiguredCloneProviderRegistry({ env: process.env })).length > 0;
        return json(200, {
          marketing_studio_enabled: true,
          access: "admin_only_founding_beta",
          supported_platforms: SUPPORTED_PLATFORMS.map((platform) => ({
            platform,
            live: isPlatformLive(platform)
          })),
          clone_provider: { name: "heygen_elevenlabs", live: cloneProviderLive },
          cost_config_version: COST_CONFIG_VERSION,
          note: cloneProviderLive
            ? "AI Clone (HeyGen avatar + ElevenLabs voice) is connected. Every social platform is still NOT LIVE — PROVIDER CONNECTION REQUIRED."
            : "NOT LIVE — PROVIDER CONNECTION REQUIRED. No social platform, AI Clone, or voice provider is connected yet. See Stage E/D for provider onboarding."
        });
      }

      if (action === "get_brand_brain") {
        const shopId = requireShopId(qs, body);
        const { preferences, error } = await loadBrandBrain(client, shopId);
        if (error && missingRelation({ message: error })) throw friendlyMissing();
        return json(200, { preferences, summary: buildBrandSummary(preferences) });
      }

      if (action === "update_brand_brain" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!Array.isArray(body.updates) || body.updates.length === 0) {
          return json(400, { error: "updates must be a non-empty array." });
        }
        const { preferences: current } = await loadBrandBrain(client, shopId);
        const next = applyExplicitBrandUpdates(current, body.updates);
        const { ok, error } = await saveBrandBrain(client, shopId, next);
        if (!ok) {
          if (missingRelation({ message: error })) throw friendlyMissing();
          throw new Error(error);
        }
        await writeCommandAudit(client, user.id, "marketing_brand_brain_update", {
          shopId,
          targetType: "marketing_brand_brain",
          targetId: shopId
        });
        return json(200, { preferences: next, summary: buildBrandSummary(next) });
      }

      if (action === "forget_brand_trait" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.category || !body.text) return json(400, { error: "category and text are required." });
        const { preferences: current } = await loadBrandBrain(client, shopId);
        const next = forgetBrandTrait(current, { category: body.category, text: body.text });
        const { ok, error } = await saveBrandBrain(client, shopId, next);
        if (!ok) throw new Error(error);
        return json(200, { preferences: next, summary: buildBrandSummary(next) });
      }

      if (action === "reset_brand_brain" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const next = resetPreferences();
        const { ok, error } = await saveBrandBrain(client, shopId, next);
        if (!ok) throw new Error(error);
        await writeCommandAudit(client, user.id, "marketing_brand_brain_reset", {
          shopId,
          targetType: "marketing_brand_brain",
          targetId: shopId
        });
        return json(200, { preferences: next, summary: "" });
      }

      // ── "My Style" — Lily's learned VISUAL creative style ───────────────
      // Deliberately the shop's own ai-style-memory.js record (the same
      // module Lily Visual Creation Studio already uses elsewhere in the
      // app for background/lighting/color/mood/typography/flyer/product-
      // photo/social-graphic/floral-decoration/realism traits) — NOT
      // marketing-brand-brain.js (writing/caption voice) and NOT a new
      // parallel system. Keeping the two separate is deliberate: a shop
      // liking "bright and airy photography" must never leak into caption
      // wording, and "always say artisan, never cheap" must never leak
      // into a visual_brief. Same super_admin/shop_id gating as every
      // other Marketing Studio action (Founding Beta is admin-only).
      if (action === "get_visual_style") {
        const shopId = requireShopId(qs, body);
        const { preferences, error } = await loadStyleMemory(client, shopId);
        if (error && missingRelation({ message: error })) throw friendlyMissing();
        return json(200, visualStyleScreenPayload(preferences));
      }

      if (action === "update_visual_style" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!Array.isArray(body.updates) || body.updates.length === 0) {
          return json(400, { error: "updates must be a non-empty array." });
        }
        const { preferences: current } = await loadStyleMemory(client, shopId);
        const next = applyExplicitVisualStyleUpdates(current, body.updates);
        const { ok, error } = await saveStyleMemory(client, shopId, next);
        if (!ok) {
          if (missingRelation({ message: error })) throw friendlyMissing();
          throw new Error(error);
        }
        await writeCommandAudit(client, user.id, "marketing_visual_style_update", {
          shopId,
          targetType: "ai_style_memory",
          targetId: shopId
        });
        return json(200, visualStyleScreenPayload(next));
      }

      if (action === "forget_visual_style_trait" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.category || !body.text) return json(400, { error: "category and text are required." });
        const { preferences: current } = await loadStyleMemory(client, shopId);
        const next = forgetVisualStyleTrait(current, { category: body.category, text: body.text });
        const { ok, error } = await saveStyleMemory(client, shopId, next);
        if (!ok) throw new Error(error);
        return json(200, visualStyleScreenPayload(next));
      }

      if (action === "reset_visual_style" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const next = resetVisualStylePreferences();
        const { ok, error } = await saveStyleMemory(client, shopId, next);
        if (!ok) throw new Error(error);
        await writeCommandAudit(client, user.id, "marketing_visual_style_reset", {
          shopId,
          targetType: "ai_style_memory",
          targetId: shopId
        });
        return json(200, visualStyleScreenPayload(next));
      }

      if (action === "connections") {
        const shopId = requireShopId(qs, body);
        const { data, error } = await client
          .from("marketing_social_connections")
          .select("id,platform,status,account_label,connected_at,expires_at,last_error,last_checked_at")
          .eq("shop_id", shopId)
          .order("platform", { ascending: true });
        if (error) {
          if (missingRelation(error)) throw friendlyMissing();
          throw error;
        }
        const byPlatform = new Map((data || []).map((row) => [row.platform, row]));
        const items = SUPPORTED_PLATFORMS.map((platform) => {
          const row = byPlatform.get(platform) || { status: "not_connected", account_label: null };
          return { ...row, platform, live: isPlatformLive(platform) };
        });
        return json(200, { items });
      }

      if (action === "usage_summary") {
        const shopId = requireShopId(qs, body);
        // Batch 6, Part K/G: the acceptance harness's own "usage ledger
        // matches actual calls" check needs the real provider metadata
        // Batch 2's ledger extension added (model/trace_id/operation_id/
        // provider_request_id/cost_source), not just cost totals — this is
        // the one place that ledger is ever read back through the API.
        // Purely additive to the response shape (existing fields
        // unchanged), and fails open to the original narrower column set
        // via the same missingRelation() convention used everywhere else
        // in this file, so an environment where that migration hasn't
        // applied yet still works exactly as before.
        const WIDE_USAGE_COLUMNS =
          "provider,purpose,estimated_cost_cents,actual_cost_cents,status,created_at,model,operation,trace_id,operation_id,attempt_index,provider_request_id,cost_source";
        const NARROW_USAGE_COLUMNS = "provider,purpose,estimated_cost_cents,actual_cost_cents,status,created_at";
        let usageQuery = await client
          .from("marketing_generation_usage")
          .select(WIDE_USAGE_COLUMNS)
          .eq("shop_id", shopId)
          .order("created_at", { ascending: false })
          .limit(500);
        if (usageQuery.error && missingRelation(usageQuery.error)) {
          usageQuery = await client
            .from("marketing_generation_usage")
            .select(NARROW_USAGE_COLUMNS)
            .eq("shop_id", shopId)
            .order("created_at", { ascending: false })
            .limit(500);
        }
        const { data, error } = usageQuery;
        if (error) {
          if (missingRelation(error)) throw friendlyMissing();
          throw error;
        }
        const rows = data || [];
        const estimatedTotalCents = rows.reduce((sum, r) => sum + (r.status === "estimated" ? r.estimated_cost_cents || 0 : 0), 0);
        const actualTotalCents = rows.reduce((sum, r) => sum + (r.status === "actual" ? r.actual_cost_cents || 0 : 0), 0);

        // Priority 2: surface the shop's configured monthly budget (if
        // any) and real remaining headroom alongside the usage ledger —
        // reuses the exact same "estimated rows this UTC month" logic the
        // pre-spend gate itself uses, never a second calculation that
        // could drift from what's actually enforced.
        const shopCap = await getShopBudgetCapCents(client, shopId);
        const monthlySpend = shopCap.ok && shopCap.capCents != null ? await monthlyCommittedSpendCents(client, { shopId }) : null;
        return json(200, {
          items: rows,
          estimated_total_cents: estimatedTotalCents,
          actual_total_cents: actualTotalCents,
          cost_config_version: COST_CONFIG_VERSION,
          monthly_budget_cap_cents: shopCap.ok ? shopCap.capCents : null,
          monthly_committed_spend_cents: monthlySpend?.ok ? monthlySpend.cents : null,
          monthly_remaining_cents: shopCap.ok && shopCap.capCents != null && monthlySpend?.ok ? Math.max(0, shopCap.capCents - monthlySpend.cents) : null
        });
      }

      // Priority 2 of the "finish everything that can safely be
      // completed without Ashley" pass: a real, persisted per-shop
      // default monthly budget cap. Nullable/default-safe — clearing it
      // (monthly_budget_cents: null) returns a shop to today's unlimited
      // default. Before the migration (20260828000000_marketing_studio_
      // budget_controls.sql) is applied anywhere, this action reports a
      // clear, honest error rather than a raw DB failure.
      if (action === "set_marketing_budget_cap" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const raw = body.monthly_budget_cents;
        if (raw !== null && raw !== undefined && (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0)) {
          return json(400, { error: "monthly_budget_cents must be a non-negative number of cents, or null to remove the cap." });
        }
        const value = raw === undefined ? null : raw;
        const updated = await client.from("shops").update({ marketing_monthly_budget_cents: value }).eq("id", shopId).select("id,marketing_monthly_budget_cents").maybeSingle();
        if (updated.error) {
          if (missingRelation(updated.error) || String(updated.error.message || "").toLowerCase().includes("does not exist")) {
            throw platformAdminError("marketing_budget_schema_unavailable");
          }
          throw updated.error;
        }
        if (!updated.data) return json(404, { error: "Shop not found." });
        await writeCommandAudit(client, user.id, "marketing_budget_cap_updated", { shopId, targetType: "shops", targetId: shopId, monthlyBudgetCents: value });
        return json(200, { shop_id: shopId, monthly_budget_cap_cents: updated.data.marketing_monthly_budget_cents });
      }

      // "Lily, handle my marketing for September" (Section 9). Plans WHAT
      // and WHEN only — content_items land in status 'idea' with no
      // creative generated yet (Stage D). Idempotent per shop+month: if
      // anything is already scheduled in this month, returns the existing
      // plan instead of silently doubling it.
      if (action === "plan_month" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const ym = parseYearMonth(qs, body);
        if (!ym) return json(400, { error: "A valid year and month (1-12) are required." });
        const platforms = Array.isArray(body.platforms) && body.platforms.length
          ? body.platforms.filter((p) => SUPPORTED_PLATFORMS.includes(p))
          : [...SUPPORTED_PLATFORMS];
        if (!platforms.length) return json(400, { error: "platforms must include at least one supported platform." });
        const allowance = body.allowance && typeof body.allowance === "object" ? body.allowance : DEFAULT_MONTHLY_ALLOWANCE;

        const { start, end } = monthRangeIso(ym.year, ym.month);
        const existing = await client
          .from("marketing_platform_variants")
          .select("content_item_id")
          .eq("shop_id", shopId)
          .gte("scheduled_at", start)
          .lt("scheduled_at", end)
          .limit(1);
        if (existing.error) {
          if (missingRelation(existing.error)) throw friendlyMissing();
          throw existing.error;
        }
        if (existing.data && existing.data.length > 0) {
          return json(200, { already_planned: true, message: `${ym.year}-${String(ym.month).padStart(2, "0")} already has planned content — plan_month is idempotent per shop+month.` });
        }

        const { items, occasions_in_month } = buildMonthlyContentPlan({ year: ym.year, month: ym.month, allowance, platforms });
        if (!items.length) return json(200, { already_planned: false, items_created: 0, occasions_in_month, items: [] });

        const contentRows = items.map((item) => ({
          shop_id: shopId,
          campaign_id: body.campaign_id || null,
          created_by: user.id,
          content_type: item.content_type,
          title: item.title,
          brief: item.brief,
          status: "idea",
          uses_ai_clone: item.uses_ai_clone,
          requires_human_approval: item.requires_human_approval
        }));
        const inserted = await client.from("marketing_content_items").insert(contentRows).select("id,content_type,title,brief,status");
        if (inserted.error) {
          if (missingRelation(inserted.error)) throw friendlyMissing();
          throw inserted.error;
        }

        const variantRows = [];
        (inserted.data || []).forEach((row, i) => {
          const scheduledAt = `${items[i].suggested_date}T12:00:00.000Z`; // noon UTC — avoids any per-platform TZ boundary ambiguity
          for (const platform of items[i].platforms) {
            variantRows.push({ shop_id: shopId, content_item_id: row.id, platform, status: "pending", scheduled_at: scheduledAt });
          }
        });
        const insertedVariants = await client.from("marketing_platform_variants").insert(variantRows).select("id,content_item_id,platform,scheduled_at");
        if (insertedVariants.error) throw insertedVariants.error;

        await writeCommandAudit(client, user.id, "marketing_plan_month", {
          shopId,
          targetType: "marketing_content_items",
          year: ym.year,
          month: ym.month,
          itemsCreated: inserted.data.length
        });

        return json(201, {
          already_planned: false,
          items_created: inserted.data.length,
          occasions_in_month,
          items: (inserted.data || []).map((row, i) => ({ ...row, suggested_date: items[i].suggested_date, occasion_key: items[i].occasion_key, platforms: items[i].platforms }))
        });
      }

      if (action === "content_calendar") {
        const shopId = requireShopId(qs, body);
        const ym = parseYearMonth(qs, body);
        if (!ym) return json(400, { error: "A valid year and month (1-12) are required." });
        const { start, end } = monthRangeIso(ym.year, ym.month);

        const variantsResult = await client
          .from("marketing_platform_variants")
          .select("id,content_item_id,platform,status,scheduled_at")
          .eq("shop_id", shopId)
          .gte("scheduled_at", start)
          .lt("scheduled_at", end);
        if (variantsResult.error) {
          if (missingRelation(variantsResult.error)) throw friendlyMissing();
          throw variantsResult.error;
        }
        const contentItemIds = [...new Set((variantsResult.data || []).map((v) => v.content_item_id))];
        let contentItems = [];
        if (contentItemIds.length) {
          const itemsResult = await client
            .from("marketing_content_items")
            .select("id,title,status,content_type")
            .eq("shop_id", shopId)
            .in("id", contentItemIds);
          if (itemsResult.error) throw itemsResult.error;
          contentItems = itemsResult.data || [];
        }
        const events = buildContentCalendarEvents({ contentItems, variants: variantsResult.data || [] });
        return json(200, { events, months: groupCalendarEventsByMonth(events) });
      }

      if (action === "list_content") {
        const shopId = requireShopId(qs, body);
        const status = typeof qs.status === "string" ? qs.status : body.status;
        let query = client
          .from("marketing_content_items")
          .select("id,content_type,title,brief,status,uses_ai_clone,requires_human_approval,campaign_id,created_at,updated_at")
          .eq("shop_id", shopId)
          .order("updated_at", { ascending: false })
          .limit(200);
        if (status) query = query.eq("status", status);
        const { data, error } = await query;
        if (error) {
          if (missingRelation(error)) throw friendlyMissing();
          throw error;
        }
        const itemIds = (data || []).map((i) => i.id);
        let variants = [];
        if (itemIds.length) {
          // Launch-blocker fix (Blocker 4, content detail UI): extended to
          // include caption/disclosure/error fields the Calendar/Review UI
          // needs to render a real content-detail view — additive, no
          // existing caller asserts the previous narrower shape.
          const variantsResult = await client
            .from("marketing_platform_variants")
            .select(
              "id,content_item_id,platform,status,scheduled_at,published_at,external_permalink,caption,hashtags,asset_id,ai_disclosure_required,disclosure_applied,disclosure_method,last_error"
            )
            .eq("shop_id", shopId)
            .in("content_item_id", itemIds);
          if (variantsResult.error) throw variantsResult.error;
          variants = variantsResult.data || [];
        }
        const byItem = new Map();
        for (const v of variants) {
          if (!byItem.has(v.content_item_id)) byItem.set(v.content_item_id, []);
          byItem.get(v.content_item_id).push(v);
        }

        // Conversational revision loop: the content-detail view needs to
        // show what the CURRENT asset actually looks like (its image url /
        // caption / parent_asset_id) to render a real "see result" preview
        // and to know whether Undo has anything to go back to — a bare
        // asset_id alone isn't enough for that. All of a content item's
        // variants share one asset uniformly (generate_content/
        // revise_content both attach it that way), so one asset per item,
        // not per variant.
        const assetIds = [...new Set(variants.map((v) => v.asset_id).filter(Boolean))];
        const assetById = new Map();
        if (assetIds.length) {
          // model is included so the client can tell a deterministic
          // operational-notice generation ("model":"deterministic") apart
          // from an AI-generated one — Ashley's Phase 3 live-test report
          // ("trace... what deterministic object was produced, what was
          // persisted, and what the client received") needs an answer she
          // can check herself on the next real test, not just my own
          // pure-function verification. Purely additive — no existing
          // caller reads or asserts against the absence of this field.
          const assetsResult = await client.from("ai_generated_assets").select("id,asset_type,content,parent_asset_id,model").in("id", assetIds).eq("shop_id", shopId);
          if (assetsResult.error) throw assetsResult.error;
          for (const a of assetsResult.data || []) assetById.set(a.id, a);
        }

        return json(200, {
          items: (data || []).map((item) => {
            const itemVariants = byItem.get(item.id) || [];
            const sharedAssetId = itemVariants.find((v) => v.asset_id)?.asset_id || null;
            return { ...item, variants: itemVariants, asset: sharedAssetId ? assetById.get(sharedAssetId) || null : null };
          })
        });
      }

      if (action === "approve_content" && method === "POST") {
        requireSuperAdminOrShopActor(admin, shopActorAuthorized);
        const shopId = requireShopId(qs, body);
        if (!body.content_item_id) return json(400, { error: "content_item_id is required." });
        if (body.decision !== "approved" && body.decision !== "rejected") {
          return json(400, { error: "decision must be 'approved' or 'rejected'." });
        }
        const current = await client
          .from("marketing_content_items")
          .select("id,status")
          .eq("id", body.content_item_id)
          .eq("shop_id", shopId)
          .maybeSingle();
        if (current.error) {
          if (missingRelation(current.error)) throw friendlyMissing();
          throw current.error;
        }
        if (!current.data) return json(404, { error: "Content item not found." });
        const nextStatus = resolveApprovalDecision(current.data.status, body.decision);
        if (!nextStatus) {
          return json(400, { error: `Cannot ${body.decision} a content item in status '${current.data.status}'. Only ${CONTENT_ITEM_APPROVABLE_STATUSES.join(", ")} may be reviewed.` });
        }

        // Real, server-side durability gate (never trust the client's own
        // render-succeeded flag) — a flyer can only be approved once its
        // deterministic render has actually been uploaded to durable
        // storage via finalize_flyer_render and content.url is real. Fetched
        // once here and reused below for the Brand Brain/My Style signal —
        // no second query for the same rows.
        //
        // Batch 3, Part D: "unreadable state is not valid state." A real
        // query error here used to silently fall through to `[]` (treated
        // exactly like "this content item genuinely has no variants at
        // all" — a real, legitimate, tested state for e.g. a fresh text
        // post) — meaning a transient DB hiccup could let an approval
        // through with zero validation. Every error below fails the whole
        // request closed instead, with a retryable 502, never a silent
        // pass-through.
        const reviewVariantAssets = await client
          .from("marketing_platform_variants")
          .select("asset_id")
          .eq("content_item_id", body.content_item_id)
          .eq("shop_id", shopId);
        if (reviewVariantAssets.error) {
          return json(502, { error: "Couldn't verify this item's current state right now — try again in a moment." });
        }
        const reviewAssetIds = [...new Set((reviewVariantAssets.data || []).map((v) => v.asset_id).filter(Boolean))];
        let reviewAssets = [];
        if (reviewAssetIds.length) {
          // status is fetched alongside asset_type/content so
          // contentApprovalBlockReason can read the REAL quarantine signal
          // (asset.status === "quarantined") — content.quarantined alone
          // is real, tested plumbing nothing actually sets today.
          const reviewAssetsResult = await client.from("ai_generated_assets").select("id,asset_type,status,content").in("id", reviewAssetIds).eq("shop_id", shopId);
          if (reviewAssetsResult.error) {
            return json(502, { error: "Couldn't verify this item's current content right now — try again in a moment." });
          }
          reviewAssets = reviewAssetsResult.data || [];
        }
        if (body.decision === "approved") {
          // Part D: a variant that references a real asset_id but whose
          // asset can't actually be found (deleted, or a genuine data gap)
          // is unreadable state — never treated as "nothing to check."
          // (An item with NO asset_id references at all — e.g. a fresh
          // text post that was never generated — legitimately has nothing
          // to validate here; that's the existing, correct behavior this
          // does not change.)
          const foundAssetIds = new Set(reviewAssets.map((a) => a.id));
          for (const assetId of reviewAssetIds) {
            if (!foundAssetIds.has(assetId)) {
              return json(409, { error: "This post's current content couldn't be found — it may have been deleted. Try regenerating it." });
            }
          }
          // contentApprovalBlockReason checks more than "url is set": for a
          // flyer, a real render_status, a trusted https url, a real
          // storage_path (proof it actually went through
          // finalize_flyer_render, not a hand-crafted content blob with a
          // forged url), a supported mime, and the real quarantine signal;
          // for an image post, a real current photo url; text-only content
          // (social_copy, video_concept) has no extra requirement (Part E
          // — never one blanket asset rule for every content type). Every
          // reviewAssets row reflects THIS item's current active asset
          // (same fetch used above), so there's no separate "superseded
          // revision" case to check here — a stale asset is never what
          // gets read back.
          for (const a of reviewAssets) {
            const blockReason = contentApprovalBlockReason(a);
            if (blockReason) return json(409, { error: blockReason });
          }
          // Part F: for a flyer that passed every DB-side check above,
          // also verify the actual stored object exists — a DB row can
          // claim render_status:"rendered" with a real-looking
          // storage_path while the underlying file was deleted, never
          // uploaded, or the upload silently failed. "Could not verify" is
          // never treated as "verified" — a storage error or an
          // unavailable client fails the whole approval closed with a
          // retryable error, exactly like the DB-read errors above.
          for (const a of reviewAssets) {
            if (a.asset_type !== "flyer") continue;
            const verification = await verifyFlyerStorageObjectExists(client, a.content?.storage_path);
            if (!verification.ok) {
              return json(502, { error: "Couldn't verify the flyer's stored file right now — try again in a moment." });
            }
            if (!verification.verified) {
              return json(409, { error: "The flyer's stored file couldn't be found — open it again so it can finish preparing, then approve." });
            }
          }
        }

        const updated = await client
          .from("marketing_content_items")
          .update({ status: nextStatus, updated_at: new Date().toISOString() })
          .eq("id", body.content_item_id)
          .eq("shop_id", shopId)
          .select("id,status")
          .single();
        if (updated.error) throw updated.error;

        // Lily Creative Style Learning: a real Approve/Reject is exactly
        // the "repeated behavioral signal" this shop's Brand Brain
        // (writing voice) and My Style (visual style) memory are supposed
        // to learn from — this is the one place recordBrandSignal()/
        // recordApprovalSignal() actually get called from real product
        // behavior, not a bare generation. Traits are read back from
        // whatever traits_used the generation itself reported (see
        // ai-creative-engine.js) via this content item's own variants'
        // asset_id — never guessed or reconstructed after the fact, so a
        // shop can never be credited with a trait Lily didn't actually use.
        try {
          if (reviewAssets.length) {
            const brandTraits = [];
            const visualTraits = [];
            for (const a of reviewAssets) {
              // traits_applied (Part I): the generation's own already-
              // grounded self-report — unchanged from before this batch.
              if (Array.isArray(a?.content?.brand_traits_used)) brandTraits.push(...a.content.brand_traits_used);
              if (Array.isArray(a?.content?.visual_traits_used)) visualTraits.push(...a.content.visual_traits_used);
              // approval_observations (Part I/J): NEW deterministic
              // observations derived straight from this artifact's own
              // structural properties (canonical_concept's creativeFamily,
              // the real caption's real length) — never from a model's
              // free-form self-report, so this is the one path a genuinely
              // NEW inferred preference can actually be born through
              // (traits_applied above can only ever echo a trait that was
              // already active, since generateSocialPost/generateVideoConcept
              // ground it against the summary text — nothing is ever in
              // that summary the very first time).
              const observations = deriveApprovalObservations(a);
              brandTraits.push(...observations.brandObservations);
              visualTraits.push(...observations.visualObservations);
            }
            // Part L: the same trait named twice for this one approval
            // event (e.g. by both a self-report AND a deterministic
            // observation, or by two different assets) must still only
            // ever count as one observation.
            const dedupedBrandTraits = dedupeTraits(brandTraits);
            const dedupedVisualTraits = dedupeTraits(visualTraits);
            if (dedupedBrandTraits.length) {
              const { preferences: currentBrand } = await loadBrandBrain(client, shopId);
              const nextBrand = recordBrandSignal(currentBrand, { traits: dedupedBrandTraits, signal: body.decision });
              await saveBrandBrain(client, shopId, nextBrand);
            }
            if (dedupedVisualTraits.length) {
              const { preferences: currentVisual } = await loadStyleMemory(client, shopId);
              const nextVisual = recordVisualStyleApprovalSignal(currentVisual, {
                traits: dedupedVisualTraits,
                signal: body.decision === "approved" ? "saved" : "undone"
              });
              await saveStyleMemory(client, shopId, nextVisual);
            }
          }
        } catch (signalError) {
          // Never let a style-learning hiccup turn a real approve/reject
          // into a failure the florist sees — the review decision itself
          // already succeeded above.
          console.warn(
            JSON.stringify({
              level: "warn",
              fn: "marketing-studio",
              message: "approval_style_signal_failed",
              shopId,
              contentItemId: body.content_item_id,
              reason: String(signalError?.message || signalError)
            })
          );
        }

        await writeCommandAudit(client, user.id, "marketing_content_review", {
          shopId,
          targetType: "marketing_content_items",
          targetId: body.content_item_id,
          decision: body.decision,
          nextStatus
        });
        return json(200, { item: updated.data });
      }

      // ── Conversational revision loop ─────────────────────────────────
      // "Generate → see result → tell Lily what to change → see revised
      // result → keep refining → Save/Approve when satisfied" — the gap
      // between generate_content (one-shot) and approve_content (the only
      // way to make anything permanent) that Blocker 4's original UI never
      // filled. A revision is just another real generation call
      // (generateImage/generateSocialPost/generateVideoConcept — the exact
      // same functions generate_content already uses) with the florist's
      // instruction folded in as this-call-only override text; it always
      // produces a NEW child asset (parent_asset_id set), the asset being
      // revised is never mutated or deleted, and every variant is
      // repointed to the new asset — never a fake in-place edit. Nothing
      // here approves or publishes anything; that's still only
      // approve_content/enqueue_publish.
      if (action === "revise_content" && method === "POST") {
        requireSuperAdminOrShopActor(admin, shopActorAuthorized);
        const shopId = requireShopId(qs, body);
        if (!body.content_item_id) return json(400, { error: "content_item_id is required." });
        const instruction = String(body.instruction || "").trim();
        if (!instruction) return json(400, { error: "Describe what you'd like changed." });

        const currentItem = await client
          .from("marketing_content_items")
          .select("id,content_type,title,brief,status")
          .eq("id", body.content_item_id)
          .eq("shop_id", shopId)
          .maybeSingle();
        if (currentItem.error) {
          if (missingRelation(currentItem.error)) throw friendlyMissing();
          throw currentItem.error;
        }
        if (!currentItem.data) return json(404, { error: "Content item not found." });
        if (!CONTENT_ITEM_APPROVABLE_STATUSES.includes(currentItem.data.status) || currentItem.data.status === "idea" || currentItem.data.status === "generating") {
          return json(400, { error: `Cannot revise a content item in status '${currentItem.data.status}'. Generate content first, or if it's already approved/scheduled, that decision has to be undone through review, not a revision.` });
        }

        const variantsResult = await client
          .from("marketing_platform_variants")
          .select("id,platform,asset_id")
          .eq("content_item_id", body.content_item_id)
          .eq("shop_id", shopId);
        if (variantsResult.error) throw variantsResult.error;
        const variants = variantsResult.data || [];
        const currentAssetId = variants.find((v) => v.asset_id)?.asset_id || null;
        if (!currentAssetId) return json(400, { error: "Generate content first before revising it." });

        const assetResult = await client.from("ai_generated_assets").select("*").eq("id", currentAssetId).eq("shop_id", shopId).maybeSingle();
        if (assetResult.error) throw assetResult.error;
        const currentAsset = assetResult.data;
        if (!currentAsset) return json(404, { error: "Couldn't find the current version to revise." });

        const ownDeltas = parseRevisionDeltas(instruction);
        const hasNewChange = Boolean(ownDeltas) || Boolean(extractMoodPhrase(instruction));

        // "I like this better, use this style from now on" / "always use
        // this" — a real standing-preference signal, handled BEFORE any
        // new generation call. Never fires from ambiguous approval alone
        // (see detectPersistIntent's own docstring); the trait saved is
        // always something the florist's own words actually named — either
        // in this same message, or (a bare "use this from now on" with no
        // new content of its own) whatever the CURRENT asset's own
        // revision actually applied, recorded on it when it was created.
        if (detectPersistIntent(instruction)) {
          const ownTraits = deriveRevisionTraits(instruction, ownDeltas);
          const traitsToSave = ownTraits.length ? ownTraits : Array.isArray(currentAsset.content?.revision_traits) ? currentAsset.content.revision_traits : [];
          if (!traitsToSave.length) {
            return json(400, { error: "Tell me specifically what to keep (e.g. \"always use this background\") so Lily can save it as your style." });
          }
          const { preferences: currentVisual } = await loadStyleMemory(client, shopId);
          const nextVisual = applyExplicitVisualStyleUpdates(currentVisual, traitsToSave);
          const savedStyle = await saveStyleMemory(client, shopId, nextVisual);
          if (!savedStyle.ok) throw new Error(savedStyle.error);
          await writeCommandAudit(client, user.id, "marketing_visual_style_update", { shopId, targetType: "ai_style_memory", targetId: shopId, source: "content_revision" });
          if (!hasNewChange) {
            // Nothing else to change — the current asset stays exactly as it is.
            return json(200, {
              persisted: true,
              style_summary: buildVisualStyleSummary(nextVisual),
              item: { id: currentItem.data.id, status: currentItem.data.status }
            });
          }
          // Otherwise fall through — this message ALSO asked for a real
          // change ("use a luxury background, and use this from now on"),
          // so the revision below still runs.
        }

        // logo_url added (Creative Direction Phase 1, Part C): the
        // deterministic brand-identifier rule needs to know whether this
        // shop actually has a verified logo on file before a revision's
        // Creative Direction can ever be rebuilt for a pre-Phase-1 asset
        // — never invented when absent, see marketing-creative-
        // direction.js's resolveDefaultBrandIdentifier.
        const shopRow = await client.from("shops").select("name,phone,primary_color,logo_url").eq("id", shopId).maybeSingle();
        const shopName = shopRow.data?.name || null;
        const appliedTraits = deriveRevisionTraits(instruction, ownDeltas);
        // Batch 1 rebuild: revise_content previously ran only factsPreserved
        // + detectPermanentClosureMismatch + detectInventedOperationalContent
        // on a revision's new text — never detectWeakMarketingCopy,
        // detectUnverifiedInventoryStateClaim, or the visual-fiction
        // boundary, so a revision could reintroduce exactly the same shape
        // of invented claim generate_content already guards against. This
        // traceId ties every evaluateMarketingOutput call below (one per
        // asset_type branch) into one observable event per revision.
        const reviseTraceId = crypto.randomUUID();

        // Batch 4 ("persisted canonical concept + revision enforcement",
        // Part D/E): every revision branch below must start from the SAME
        // persisted canonical concept the parent asset carries, and must
        // only ever change the fields the florist explicitly asked to
        // change — never silently re-derive a new concept from scratch.
        // Computed once here since neither depends on which asset_type is
        // being revised.
        const parentConcept = currentAsset.content?.canonical_concept || null;
        const conceptChangeRequest = detectExplicitConceptChangeRequest(instruction);
        // Legacy-shaped view of a concept (the same ad-hoc
        // {objective, isSympathy} generate_content's own `concept` already
        // uses) — evaluateMarketingOutput's existing coherence checks
        // (detectConceptCoherenceMismatch/detectCtaCoherenceMismatch) were
        // built around that shape; this reuses them rather than adding a
        // second, competing comparison.
        function legacyConceptView(revisedConcept) {
          if (!revisedConcept) return null;
          return { objective: revisedConcept.objective, isSympathy: revisedConcept.sympathyClassification === "sympathy" };
        }
        // Builds this revision's own canonical concept: inherits the
        // parent byte-for-byte when nothing was explicitly asked to
        // change (Part D), or re-derives ONLY the fields the instruction
        // explicitly named (Part E) — recording which fields changed and
        // why, right alongside the concept itself.
        function buildRevisedConcept({ ctaText = null, bodyText = "", photoStrategy = null, styleTier = null, userUploadedPhoto: uploadedPhoto = false, reusedFromAssetId = null }) {
          if (!parentConcept) {
            // No parent concept to inherit — an asset created before Batch
            // 4. Build a fresh one from the same real signals
            // generate_content itself uses, so every asset carries a
            // persisted concept going forward regardless of when it was
            // first created.
            return {
              concept: buildCanonicalConcept({
                requestText: currentItem.data.brief,
                occasionTitle: currentItem.data.title,
                platform: variants[0]?.platform || "facebook",
                contentType: currentItem.data.content_type,
                assetType: currentAsset.asset_type,
                ctaText,
                bodyText,
                isSympathy: BEREAVEMENT_CONTEXT_RE.test(`${currentItem.data.brief} ${instruction} ${bodyText}`),
                photoStrategy,
                styleTier,
                userUploadedPhoto: uploadedPhoto,
                reusedFromAssetId,
                invGroundedCount: (currentAsset.content?.grounded_in_inventory || []).length
              }),
              changedFields: []
            };
          }
          if (!conceptChangeRequest.changed) {
            return { concept: inheritConcept(parentConcept, {}), changedFields: [] };
          }
          const fields = conceptChangeRequest.fields;
          const overrides = {};
          if (fields.includes("occasionCategory") || fields.includes("sympathyClassification")) {
            const isSympathy = BEREAVEMENT_CONTEXT_RE.test(`${instruction} ${bodyText}`);
            overrides.sympathyClassification = isSympathy ? "sympathy" : "not_sympathy";
            overrides.occasionCategory = classifyOccasionCategory({ occasionTitle: currentItem.data.title, requestText: instruction, objective: parentConcept.objective, isSympathy });
          }
          if (fields.includes("objective") || fields.includes("promotionIntent")) {
            const realPromotion = requestSignalsRealPromotion(instruction);
            overrides.promotionIntent = realPromotion ? "real_promotion" : "not_promotion";
            overrides.objective = realPromotion ? "promotion" : parentConcept.objective === "promotion" ? "awareness" : parentConcept.objective;
          }
          if (fields.includes("inventoryIntent")) {
            overrides.inventoryIntent = requestSignalsIntentionalInventoryUse(instruction) ? "inventory_driven" : "not_inventory_driven";
          }
          if (fields.includes("ctaIntent")) {
            overrides.ctaIntent = classifyCtaIntent(ctaText || instruction);
          }
          if (fields.includes("primarySubjectClass")) {
            overrides.primarySubjectClass = classifyPrimarySubjectClass(instruction);
          }
          if (fields.includes("assetRoute")) {
            overrides.assetRoute = deriveAssetRoute({ contentType: currentItem.data.content_type, photoStrategy, styleTier, userUploadedPhoto: uploadedPhoto, reusedFromAssetId });
          }
          const revised = inheritConcept(parentConcept, overrides);
          // Batch 4, Part I (requirement 10): a defensive last check, not a
          // new detection path — by construction this function only ever
          // changes fields the florist's own instruction explicitly named,
          // so this should never actually fire. It's the backstop against
          // a future edit to the logic above accidentally widening what
          // changes on an ordinary revision.
          const unexpectedDrift = detectConceptDrift(parentConcept, revised, Object.keys(overrides));
          if (unexpectedDrift.hasDrift) {
            throw new Error(`Internal error: revision would have silently changed ${unexpectedDrift.driftedFields.join(", ")} without an explicit request — refusing to persist.`);
          }
          return { concept: revised, changedFields: Object.keys(overrides) };
        }

        // hashtags is deliberately optional: an image-only (visual) revision
        // never touches the caption/hashtags a wording revision would —
        // omitting the key leaves that column exactly as it was.
        async function repointVariants(assetId, { caption, hashtags, aiContentType, generativeImageUsed = false }) {
          for (const v of variants) {
            const payload = {
              asset_id: assetId,
              caption,
              ...computeDisclosureFields({ platform: v.platform, generativeImageUsed, aiContentType })
            };
            if (hashtags !== undefined) payload.hashtags = hashtags;
            await client.from("marketing_platform_variants").update(payload).eq("id", v.id).eq("shop_id", shopId);
          }
        }

        if (currentAsset.asset_type === "image") {
          // Real, live-found failure: Ashley asked to change a generated
          // post's wording ("change it to Floyd Central Jaguars" — the
          // caption said "the Jacksonville Jaguars"), twice, and got the
          // picture regenerated both times with the OLD team name still in
          // the caption. This asset type has no separate social_copy
          // sibling — the caption lives on this same row — and this branch
          // unconditionally treated every instruction as image-only,
          // hardcoding `caption: currentAsset.content?.caption` with no
          // path that could ever revise it. There was no bug to trip over:
          // the caption-revision code simply did not exist here, only on
          // the flyer branch below.
          //
          // Mirrors that flyer branch's own gate exactly, since the
          // standing rule this repo already has for "Regenerate image" is
          // the correct default to preserve: an instruction that is
          // unambiguously ONLY about the visual ("regenerate the
          // background", "try a different photo") must still leave the
          // wording byte-for-byte untouched. Everything else — including a
          // plain fact/name correction with no image language in it at
          // all, which is what actually happened here — now revises the
          // caption too.
          const { preferences: imgBrandPrefs } = await loadBrandBrain(client, shopId);
          const brandVoiceSummary = buildBrandSummary(imgBrandPrefs);
          const { preferences: imgVisualPrefs } = await loadStyleMemory(client, shopId);
          const visualStyleSummary = buildVisualStyleSummary(imgVisualPrefs);
          const primaryPlatform = variants[0]?.platform || "facebook";
          const priorCaption = currentAsset.content?.caption || "";
          const imageOnlyRevision = instructionAffectsFlyerImage(instruction) && !instructionAffectsFlyerWording(instruction);
          let captionFields = { body: priorCaption, headline: currentAsset.content?.headline || null, cta: currentAsset.content?.cta || null, hashtags: currentAsset.content?.hashtags || [] };
          if (!imageOnlyRevision) {
            const captionRequestText = buildWordingRevisionRequestText({ instruction, brief: currentItem.data.brief, priorText: priorCaption });
            const captionGen = await generateSocialPost({ persona: "Lily", channel: primaryPlatform, occasion: currentItem.data.title, shop: { name: shopName }, requestText: captionRequestText, brandVoiceSummary, visualStyleSummary });
            if (!captionGen.ok) return json(400, { error: captionGen.error });
            if (!factsPreserved(priorCaption, captionGen.content.body)) {
              return json(400, { error: "That revision would have changed an exact phone number, date, price, or link in the caption — nothing was changed. Try rephrasing the request." });
            }
            if (detectPermanentClosureMismatch(`${currentItem.data.brief} ${instruction}`, `${captionGen.content.headline} ${captionGen.content.body}`)) {
              return json(400, { error: "That revision came back reading like a permanent closing, but nothing about this post asked for that — nothing was changed. Try rephrasing the request." });
            }
            if (detectInventedOperationalContent(`${currentItem.data.brief} ${instruction}`, `${captionGen.content.headline} ${captionGen.content.body}`)) {
              return json(400, { error: "That revision came back with wording you didn't ask for — an invented reason, urgency, or future plan — nothing was changed. Try rephrasing the request." });
            }
            const imgCaptionEval = evaluateMarketingOutput({
              route: "revise_content",
              request: `${currentItem.data.brief} ${instruction} ${priorCaption}`,
              shopEvidence: { name: shopName, phone: shopRow.data?.phone },
              inventoryEvidence: currentAsset.content?.grounded_in_inventory || [],
              candidate: captionGen.content,
              component: "caption",
              isRetryAttempt: true
            });
            structuredLog("info", "marketing_revise_content_safety", {
              traceId: reviseTraceId,
              route: "revise_content",
              assetType: "image",
              component: "caption",
              checksRun: imgCaptionEval.checksRun,
              decision: imgCaptionEval.reasons.length ? "reject" : imgCaptionEval.repaired ? "repair" : "pass",
              reasonCount: imgCaptionEval.reasons.length,
              repaired: imgCaptionEval.repaired
            });
            if (imgCaptionEval.reasons.length) {
              return json(400, { error: "That revision came back with wording Lily can't safely use yet — nothing was changed. Try rephrasing the request." });
            }
            if (imgCaptionEval.safeCandidate) {
              captionGen.content.headline = imgCaptionEval.safeCandidate.headline;
              captionGen.content.body = imgCaptionEval.safeCandidate.body;
              captionGen.content.cta = imgCaptionEval.safeCandidate.cta;
            }
            captionFields = { body: captionGen.content.body, headline: captionGen.content.headline, cta: captionGen.content.cta, hashtags: captionGen.content.hashtags || [] };
          }
          // The visual only regenerates when the instruction actually asks
          // for that (or asks for both) — a pure wording correction like
          // Ashley's must not also silently reroll the photo she never
          // asked to change. (imageOnlyRevision implies this is already
          // true, so this alone covers both "image only" and "image and
          // wording" — never re-check it separately.)
          const affectsImage = instructionAffectsFlyerImage(instruction);
          // Real gap an independent review found in the photo-choice
          // feature above: this post's photo may be a REAL photo the
          // florist uploaded herself, not an AI generation — "ask me each
          // time" means exactly that, so a revision instruction must never
          // silently swap it for an AI-generated one behind her back. It
          // stays true for the rest of this branch UNLESS a fresh AI
          // generation genuinely happens below (which the check right
          // after this refuses to let happen at all for an uploaded photo).
          const userUploadedPhoto = Boolean(currentAsset.content?.user_uploaded_photo);
          if (affectsImage && userUploadedPhoto) {
            return json(400, {
              error:
                "This post's photo is a real photo you uploaded, not an AI generation — Lily won't silently replace it with an AI photo. Create a new post if you'd like an AI-generated photo instead, or ask for a wording-only change here."
            });
          }
          let imageUrl = currentAsset.content?.url || null;
          let mediaId = null;
          let provider = currentAsset.provider || "cloudflare";
          let model = currentAsset.model || "unknown";
          let prompt = currentAsset.prompt || null;
          // Real, live-found failure (Ashley's own screenshots): a
          // regenerated photo came back with the requested subject (a
          // jaguar) missing entirely. Root cause traced to two compounding
          // problems in how the image prompt carried context across
          // revisions:
          //  1. The TRUE concrete description that got the original subject
          //     drawn (copyGen.content.visual_brief, e.g. "a jaguar mascot
          //     holding a bouquet of flowers") was never persisted at
          //     generation time — the first-ever revision had nothing to
          //     work from except the content item's own generic brief text,
          //     which may never name the subject at all.
          //  2. Even once persisted, buildImageRevisionBrief's own output
          //     becomes the NEXT revision's own "prior" input — nesting the
          //     entire revision history inside itself again on every
          //     subsequent revision. That compounds without bound, and once
          //     the combined prompt exceeds buildImagePrompt's length cap,
          //     visual_brief — the ONLY optional clause — is dropped in one
          //     piece, erasing the subject completely rather than trimming it.
          // Fix: track a STABLE base description (the real original
          // subject) separately from this asset's own (possibly
          // instruction-annotated) visual_brief, and always build the next
          // revision's prompt from that stable base — never from a prior
          // revision's already-compounded output. base_visual_brief never
          // grows, so the real subject can never be squeezed out no matter
          // how many revisions happen.
          const baseVisualBrief = currentAsset.content?.base_visual_brief || currentAsset.content?.visual_brief || currentItem.data.brief;
          let visualBrief = currentAsset.content?.visual_brief || currentItem.data.brief;
          if (affectsImage) {
            visualBrief = buildImageRevisionBrief({ instruction, priorVisualBrief: baseVisualBrief });
            // Batch 1 rebuild: the visual-fiction/flower-grounding boundary
            // applies to a revised image prompt exactly as it does at
            // generation time — the florist's own revision instruction is a
            // real supplied fact (a flower she asks for by name here is
            // allowed), but nothing else independently earns a species name.
            const revisionSceneEval = evaluateMarketingOutput({
              route: "revise_content",
              request: `${currentItem.data.brief} ${instruction}`,
              shopEvidence: { name: shopName, phone: shopRow.data?.phone },
              inventoryEvidence: currentAsset.content?.grounded_in_inventory || [],
              candidate: visualBrief,
              component: "creative_scene"
            });
            if (revisionSceneEval.decision === "repair") visualBrief = revisionSceneEval.safeCandidate;
            // Batch 4, Part F/I: "regenerate image" must preserve the
            // canonical concept — composition/crop/lighting/mood may
            // change, but the image prompt must still describe the SAME
            // real subject as the stable original, never a silently
            // different photo. Only a genuine, deliberate subject change
            // (conceptChangeRequest naming primarySubjectClass) is allowed
            // to actually swap it.
            if (!conceptChangeRequest.changed || !conceptChangeRequest.fields.includes("primarySubjectClass")) {
              const subjectDrift = detectImageSubjectDrift({ concept: parentConcept, imagePromptText: visualBrief, primarySubject: baseVisualBrief });
              if (subjectDrift) {
                return json(400, { error: `${subjectDrift} If you meant to change what's actually shown, say so explicitly (e.g. "change the subject to ...").` });
              }
            }
            prompt = buildImagePrompt({ occasion: currentItem.data.title, shopName, visualBrief });
            const revisionQuality = await runMarketingImageQuality({
              client,
              shopId,
              promptFor: () => prompt,
              filenameFor: (attempt) =>
                attempt === 0
                  ? `marketing-revision-${body.content_item_id}-${Date.now()}.jpg`
                  : `marketing-revision-${body.content_item_id}-${Date.now()}-retry${attempt}.jpg`,
              visualBrief,
              occasion: currentItem.data.title,
              usage: { traceId: reviseTraceId, contentItemId: body.content_item_id }
              // No buildFallback here: a revision that asked for a new
              // photo and can't get a safe one must say so, never silently
              // swap in a template behind the florist's back mid-revision.
            });
            structuredLog("info", "marketing_revise_content_quality_check", {
              traceId: reviseTraceId,
              state: revisionQuality.state,
              attempts: revisionQuality.attempts.length,
              rejectedCount: revisionQuality.rejectedAssetPaths.length
            });
            if (revisionQuality.state !== "PASS") {
              return json(400, {
                error: revisionQuality.error
                  ? `Couldn't regenerate your photo: ${revisionQuality.error}`
                  : "The regenerated photo didn't pass Lily's quality check — nothing was changed. Try again."
              });
            }
            const imageGen = revisionQuality.gen;
            const mediaRow = await client
              .from("website_media")
              .insert({ shop_id: shopId, storage_path: imageGen.path, filename: imageGen.path.split("/").pop(), source: "generated", mime: "image/jpeg" })
              .select()
              .single();
            imageUrl = imageGen.url;
            mediaId = mediaRow.data?.id || null;
            provider = imageGen.provider;
            model = imageGen.model;
            prompt = imageGen.prompt;
          }
          const imageRevisedConcept = buildRevisedConcept({
            ctaText: captionFields.cta,
            bodyText: captionFields.body,
            userUploadedPhoto,
            styleTier: userUploadedPhoto ? "upload" : currentAsset.content?.style_tier || "generated"
          });
          const persisted = await persistGeneratedAsset(client, {
            shopId,
            userId: user.id,
            persona: "Lily",
            assetType: "image",
            provider,
            model,
            prompt,
            content: {
              // Batch 4 bug fix: this branch previously built its content
              // object from scratch, silently dropping creative_brief/
              // objective/grounded_in_inventory/photo_strategy on every
              // revision (the flyer branch below already spread
              // ...currentAsset.content — this branch never did). Carries
              // everything forward unchanged by default now; only the
              // fields this revision actually touched are overridden.
              ...currentAsset.content,
              url: imageUrl,
              caption: captionFields.body,
              headline: captionFields.headline,
              cta: captionFields.cta,
              hashtags: captionFields.hashtags,
              visual_brief: visualBrief,
              // Carried forward unchanged, never recomputed from this
              // revision's own (instruction-annotated) visual_brief — see
              // the comment above where baseVisualBrief is derived.
              base_visual_brief: baseVisualBrief,
              brand_traits_used: [],
              visual_traits_used: appliedTraits,
              revision_instruction: instruction,
              revision_traits: appliedTraits,
              // Carried forward unchanged — the guard above refuses any
              // revision that would replace an uploaded photo with an AI
              // one, so this can only ever still be true here, never
              // silently flipped to false by a revision that touched it.
              user_uploaded_photo: userUploadedPhoto,
              // Batch 4, Part B/D/E: the canonical concept this revision
              // inherited (or, for an explicit concept change, the same
              // concept with only the named fields updated) — see
              // buildRevisedConcept above.
              canonical_concept: imageRevisedConcept.concept,
              ...(imageRevisedConcept.changedFields.length
                ? { concept_change: { changed_fields: imageRevisedConcept.changedFields, reason: instruction } }
                : {})
            },
            mediaId,
            parentAssetId: currentAsset.id,
            status: "completed"
          });
          if (!persisted.ok) throw new Error(persisted.error);
          await repointVariants(persisted.asset.id, {
            caption: captionFields.body,
            // Only an actual wording revision has a freshly generated
            // hashtag set worth writing back — passing the merely-carried-
            // forward default for a pure image-only revision would
            // overwrite (or blank) the variant's real hashtags for a
            // request that never asked to touch them.
            hashtags: imageOnlyRevision ? undefined : captionFields.hashtags,
            // Disclosure must reflect whether the PUBLISHED photo is
            // AI-generated, not whether THIS revision happened to
            // regenerate it — a caption-only fix must never silently clear
            // the disclosure flag just because it didn't touch the photo
            // this time. Matches the same test used at creation time and
            // by revert_content_revision. userUploadedPhoto (not just
            // Boolean(imageUrl)) is what actually decides this now: a real
            // photo the florist uploaded herself has a non-null imageUrl
            // too, but is never a generative image — see the guard above
            // that refuses to let a revision silently swap it for an AI one.
            aiContentType: imageUrl && !userUploadedPhoto ? "generative_image" : "none",
            generativeImageUsed: Boolean(imageUrl) && !userUploadedPhoto
          });
          await writeCommandAudit(client, user.id, "marketing_content_revised", { shopId, targetType: "marketing_content_items", targetId: body.content_item_id, assetType: "image" });
          return json(200, {
            item: { id: currentItem.data.id, status: currentItem.data.status },
            asset: { id: persisted.asset.id, type: "image", url: imageUrl, parent_asset_id: currentAsset.id, content: persisted.asset.content }
          });
        }

        if (currentAsset.asset_type === "flyer") {
          const { preferences: brandPrefs } = await loadBrandBrain(client, shopId);
          const brandVoiceSummary = buildBrandSummary(brandPrefs);
          const { preferences: visualPrefs } = await loadStyleMemory(client, shopId);
          const visualStyleSummary = buildVisualStyleSummary(visualPrefs);
          const primaryPlatform = variants[0]?.platform || "facebook";

          // Real, live-found failure: the Facebook caption used to ALWAYS
          // revise, even for a pure "Regenerate image — keep the exact
          // same wording" request that never mentioned the caption at all
          // — the one-click Regenerate image button hit this every time.
          // A caption-affecting instruction (anything that isn't a pure
          // image-only regeneration) still revises the caption exactly as
          // before; a pure image-only revision now leaves the caption
          // byte-for-byte untouched, the same guarantee an "image"-type
          // asset's own revision path already gives its caption.
          const priorCaption = currentAsset.content?.caption || "";
          const imageOnlyRevision = instructionAffectsFlyerImage(instruction) && !instructionAffectsFlyerWording(instruction);
          let gen;
          if (imageOnlyRevision) {
            gen = {
              model: currentAsset.model || "cloudflare",
              content: {
                headline: currentAsset.content?.headline,
                body: priorCaption,
                cta: currentAsset.content?.cta,
                hashtags: currentAsset.content?.hashtags || [],
                brand_traits_used: currentAsset.content?.brand_traits_used || [],
                visual_traits_used: currentAsset.content?.visual_traits_used || []
              }
            };
          } else {
            const captionRequestText = buildWordingRevisionRequestText({ instruction, brief: currentItem.data.brief, priorText: priorCaption });
            gen = await generateSocialPost({ persona: "Lily", channel: primaryPlatform, occasion: currentItem.data.title, shop: { name: shopName }, requestText: captionRequestText, brandVoiceSummary, visualStyleSummary });
            if (!gen.ok) return json(400, { error: gen.error });
            if (!factsPreserved(priorCaption, gen.content.body)) {
              return json(400, { error: "That revision would have changed an exact phone number, date, price, or link in the caption — nothing was changed. Try rephrasing the request." });
            }
            if (detectPermanentClosureMismatch(`${currentItem.data.brief} ${instruction}`, `${gen.content.headline} ${gen.content.body}`)) {
              return json(400, {
                error: "That revision came back reading like a permanent closing, but nothing about this post asked for that — nothing was changed. Try rephrasing the request."
              });
            }
            if (detectInventedOperationalContent(`${currentItem.data.brief} ${instruction}`, `${gen.content.headline} ${gen.content.body}`)) {
              return json(400, {
                error: "That revision came back with wording you didn't ask for — an invented reason, urgency, or future plan — nothing was changed. Try rephrasing the request."
              });
            }
            const flyerCaptionEval = evaluateMarketingOutput({
              route: "revise_content",
              request: `${currentItem.data.brief} ${instruction} ${priorCaption}`,
              shopEvidence: { name: shopName, phone: shopRow.data?.phone },
              inventoryEvidence: currentAsset.content?.grounded_in_inventory || [],
              candidate: gen.content,
              component: "caption",
              isRetryAttempt: true
            });
            structuredLog("info", "marketing_revise_content_safety", {
              traceId: reviseTraceId,
              route: "revise_content",
              assetType: "flyer",
              component: "caption",
              checksRun: flyerCaptionEval.checksRun,
              decision: flyerCaptionEval.reasons.length ? "reject" : flyerCaptionEval.repaired ? "repair" : "pass",
              reasonCount: flyerCaptionEval.reasons.length,
              repaired: flyerCaptionEval.repaired
            });
            if (flyerCaptionEval.reasons.length) {
              return json(400, { error: "That revision came back with wording Lily can't safely use yet — nothing was changed. Try rephrasing the request." });
            }
            if (flyerCaptionEval.safeCandidate) {
              gen.content.headline = flyerCaptionEval.safeCandidate.headline;
              gen.content.body = flyerCaptionEval.safeCandidate.body;
              gen.content.cta = flyerCaptionEval.safeCandidate.cta;
            }
          }

          // Batch 4, Part D/E/I: this revision's own concept target — the
          // parent's concept unless the instruction explicitly asked to
          // change occasion/sympathy/objective/promotion, in which case
          // the NEW target. Reuses buildRevisedConcept itself (not a
          // second, hand-rolled copy of the same override logic —
          // independent-review fix, LOW: the two used to drift-risk out of
          // sync) — only .objective/.sympathyClassification are read here,
          // so calling it before photoStrategy/styleTier are known is
          // safe. captionExcerpt is the real caption THIS revision is
          // about to have (now that `gen` is resolved), so
          // detectConceptCoherenceMismatch's named-flower caption-vs-flyer
          // comparison actually has something to compare against, instead
          // of an always-empty string (independent-review fix, LOW).
          const conceptPreview = parentConcept
            ? { ...legacyConceptView(buildRevisedConcept({ ctaText: gen.content.cta, bodyText: gen.content.body }).concept), captionExcerpt: gen.content.body }
            : null;

          // The deterministic text layer (headline/body/cta actually
          // printed on the flyer) only regenerates when the instruction
          // itself affects it — requirement 7. An ordinary caption-only
          // revision ("make it more cheerful") leaves the flyer's exact
          // wording untouched.
          let flyerFields = { headline: currentAsset.content?.headline, body: currentAsset.content?.body, cta: currentAsset.content?.cta };
          // Whether THIS revision changed anything actually drawn on the
          // graphic (as opposed to only the caption). If it did, the
          // previously-rendered/uploaded file (if any) no longer matches
          // this new asset's content and must not be carried forward — a
          // fresh render + finalize_flyer_render is required before this
          // revision can be approved. If it didn't, the pixels are still
          // accurate, so the existing durable url/mime survive untouched
          // and no re-render is needed.
          let renderStale = false;
          if (instructionAffectsFlyerWording(instruction)) {
            const priorFlyerText = `${currentAsset.content?.headline || ""} ${currentAsset.content?.body || ""} ${currentAsset.content?.cta || ""}`;
            const flyerRequestText = buildWordingRevisionRequestText({ instruction, brief: currentItem.data.brief, priorText: priorFlyerText });
            const flyerGen = await generateFlyerContent({ persona: "Lily", message: flyerRequestText, occasion: currentItem.data.title, shop: { name: shopName } });
            if (!flyerGen.ok) return json(400, { error: flyerGen.error });
            const newFlyerText = `${flyerGen.content.headline} ${flyerGen.content.body} ${flyerGen.content.cta}`;
            if (!factsPreserved(priorFlyerText, newFlyerText)) {
              return json(400, { error: "That revision would have changed an exact phone number, date, price, or link on the flyer itself — nothing was changed. Try rephrasing the request." });
            }
            if (detectPermanentClosureMismatch(`${currentItem.data.brief} ${instruction}`, newFlyerText)) {
              return json(400, {
                error: "That revision came back reading like a permanent closing, but nothing about this flyer asked for that — nothing was changed. Try rephrasing the request."
              });
            }
            if (detectInventedOperationalContent(`${currentItem.data.brief} ${instruction}`, newFlyerText)) {
              return json(400, {
                error: "That revision came back with wording you didn't ask for — an invented reason, urgency, or future plan — nothing was changed. Try rephrasing the request."
              });
            }
            const flyerTextEval = evaluateMarketingOutput({
              route: "revise_content",
              request: `${currentItem.data.brief} ${instruction} ${priorFlyerText}`,
              shopEvidence: { name: shopName, phone: shopRow.data?.phone },
              inventoryEvidence: currentAsset.content?.grounded_in_inventory || [],
              candidate: flyerGen.content,
              // Batch 4, Part I: the same coherence checks generate_content
              // already runs against its own newly-built concept, now run
              // here too — a wording revision must never silently drift the
              // flyer text away from the concept it's actually supposed to
              // still match (or, for an explicit change, the new target).
              canonicalConcept: conceptPreview,
              component: "flyer_text",
              isRetryAttempt: true
            });
            structuredLog("info", "marketing_revise_content_safety", {
              traceId: reviseTraceId,
              route: "revise_content",
              assetType: "flyer",
              component: "flyer_text",
              checksRun: flyerTextEval.checksRun,
              decision: flyerTextEval.reasons.length ? "reject" : flyerTextEval.repaired ? "repair" : "pass",
              reasonCount: flyerTextEval.reasons.length,
              repaired: flyerTextEval.repaired
            });
            if (flyerTextEval.reasons.length) {
              return json(400, { error: "That revision came back with wording on the flyer Lily can't safely use yet — nothing was changed. Try rephrasing the request." });
            }
            if (flyerTextEval.safeCandidate) {
              flyerGen.content.headline = flyerTextEval.safeCandidate.headline;
              flyerGen.content.body = flyerTextEval.safeCandidate.body;
              flyerGen.content.cta = flyerTextEval.safeCandidate.cta;
            }
            flyerFields = flyerGen.content;
            renderStale = true;
          }

          // A florist can also ask to re-roll the AI-generated floral
          // photo behind the text ("change the image", "regenerate the
          // background") independently of the wording — the one-click
          // "Regenerate image" button (marketing-studio-shop-ui.js) sends
          // this same kind of plain-language instruction, never a raw
          // provider prompt. Reuses the exact grounding already saved on
          // the current asset (grounded_in_inventory) rather than
          // re-querying inventory, and never fails the whole revision if
          // the provider call fails — silently keeps the CURRENT
          // background_url/style_tier, the same "never leave the florist
          // with a broken result" guarantee generate_content's own Tier A
          // wiring already gives.
          let backgroundFields = {};
          if (instructionAffectsFlyerImage(instruction)) {
            // A flyer generated for a request that named a real subject (the
            // jaguar, a specific arrangement) is marked photo_strategy:
            // "subject_forward" at generation time. "Regenerate image" on
            // one of these must ask for that SAME subject again, not
            // silently fall back to a generic calm floral backdrop — that
            // would quietly erase the exact thing this flyer was asked for,
            // the same failure mode the jaguar fix above was written to
            // close. A calm-backdrop flyer (an operational notice with no
            // real subject of its own) keeps using the negative-space
            // backdrop prompt exactly as before.
            const isSubjectForward = currentAsset.content?.photo_strategy === "subject_forward";
            const revisionVisualBrief = currentAsset.content?.visual_brief || currentItem.data.brief;
            let backgroundPrompt;
            let backgroundFilenamePrefix;
            if (isSubjectForward) {
              backgroundPrompt = buildImagePrompt({
                occasion: currentItem.data.title,
                shopName,
                visualBrief: revisionVisualBrief,
                // Carried forward from the asset persisted at generation
                // time (see generate_content's subject-forward branch) so
                // "Regenerate image" asks for the same concrete subject,
                // not a vaguer re-derivation from prose alone.
                creativeBrief: currentAsset.content?.creative_brief || null
              });
              backgroundFilenamePrefix = "marketing";
            } else {
              const groundedFlowerNames = Array.isArray(currentAsset.content?.grounded_in_inventory)
                ? currentAsset.content.grounded_in_inventory.map((i) => i.name).filter(Boolean)
                : [];
              backgroundPrompt = buildFlyerBackgroundPrompt({
                occasion: currentItem.data.title,
                brandColor: shopRow.data?.primary_color || null,
                groundedFlowers: groundedFlowerNames,
                creativeBrief: currentAsset.content?.creative_brief || null,
                // "Regenerate image" must ask for a genuinely different
                // composition, not just resend the same instruction and hope
                // the model's own sampling varies it — Date.now() guarantees
                // a fresh, different composition instruction on every call.
                variationSeed: Date.now()
              });
              backgroundFilenamePrefix = "flyer-background";
            }
            const backgroundQuality = await runMarketingImageQuality({
              client,
              shopId,
              promptFor: () => backgroundPrompt,
              filenameFor: (attempt) =>
                attempt === 0
                  ? `${backgroundFilenamePrefix}-${body.content_item_id}-${Date.now()}.jpg`
                  : `${backgroundFilenamePrefix}-${body.content_item_id}-${Date.now()}-retry${attempt}.jpg`,
              visualBrief: revisionVisualBrief,
              creativeBrief: currentAsset.content?.creative_brief || null,
              occasion: currentItem.data.title,
              usage: { traceId: reviseTraceId, contentItemId: body.content_item_id }
              // No buildFallback: a failed/rejected "Regenerate image" must
              // never fail the whole revision — it silently keeps the
              // CURRENT background_url/style_tier below, exactly the same
              // "never leave the florist with a broken result" guarantee
              // this branch already gave a plain provider failure before
              // this quality gate existed. A rejected/unsafe candidate is
              // simply never adopted.
            });
            structuredLog("info", "marketing_revise_content_quality_check", {
              traceId: reviseTraceId,
              state: backgroundQuality.state,
              attempts: backgroundQuality.attempts.length,
              rejectedCount: backgroundQuality.rejectedAssetPaths.length
            });
            if (backgroundQuality.state === "PASS") {
              backgroundFields = { style_tier: "generated", background_url: backgroundQuality.gen.url };
              renderStale = true;
            }
          }
          // A real, successfully-generated AI photo behind the poster IS a
          // generative image whether it came from THIS revision's own
          // regenerate call or was simply carried forward from the current
          // asset untouched — the disclosure fix generate_content already
          // has (imageUrl reflecting what actually happened, not which
          // branch ran) applied here too. Before this, aiContentType was
          // hardcoded to "none" below regardless of style_tier, so a flyer
          // with a real Tier-A photo still disclosed "no AI image used."
          const finalStyleTier = backgroundFields.style_tier || currentAsset.content?.style_tier;
          const finalBackgroundUrl = backgroundFields.background_url || currentAsset.content?.background_url;
          const generativeImageUsed = finalStyleTier === "generated" && Boolean(finalBackgroundUrl);

          const flyerRevisedConcept = buildRevisedConcept({
            ctaText: flyerFields.cta,
            bodyText: `${flyerFields.body || ""} ${gen.content.body || ""}`,
            photoStrategy: currentAsset.content?.photo_strategy || null,
            styleTier: finalStyleTier,
            // Independent review fix (MEDIUM): a flyer's own real photo
            // provenance (a real upload, or a reuse of one) was previously
            // never passed here, so re-deriving assetRoute (only when
            // there's no parent concept, or an explicit "use a real photo
            // instead" change) always computed as if the photo could only
            // ever be AI-generated — wrong for a real uploaded/reused
            // photo. Carried forward from the same fields generate_content
            // itself persists on this exact asset type/branch.
            userUploadedPhoto: Boolean(currentAsset.content?.user_uploaded_photo),
            reusedFromAssetId: currentAsset.content?.reused_from_asset_id || null
          });
          // Creative Direction Phase 1, Part H: inherited byte-for-byte
          // from the parent asset — Phase 1 defines no "explicit
          // creative-direction change" detector (that's Phase 3+, once a
          // model can actually choose between real creative options), so
          // this never re-derives a new direction from scratch. A
          // pre-Phase-1 asset with no creative_direction on file yet gets
          // one backfilled deterministically, the same "legacy asset"
          // fallback buildRevisedConcept already uses above for
          // canonical_concept.
          const flyerRevisedCreativeDirection =
            inheritCreativeDirection(currentAsset.content?.creative_direction || null) ||
            buildDeterministicCreativeDirection({
              canonicalConcept: flyerRevisedConcept.concept,
              shopBrand: { logoUrl: shopRow.data?.logo_url || null }
            });
          const persisted = await persistGeneratedAsset(client, {
            shopId,
            userId: user.id,
            persona: "Lily",
            assetType: "flyer",
            provider: "cloudflare",
            model: gen.model,
            content: {
              // Carries the template/regions/palette/canvas/brand/style
              // forward unchanged — only the fields this revision actually
              // touched are overridden below. Requirement 8: a reload reads
              // this same row back and renders identically.
              ...currentAsset.content,
              ...flyerFields,
              ...backgroundFields,
              caption: gen.content.body,
              brand_traits_used: gen.content.brand_traits_used,
              visual_traits_used: gen.content.visual_traits_used,
              revision_instruction: instruction,
              revision_traits: appliedTraits,
              // Batch 4, Part B/D/E: the canonical concept this revision
              // inherited, or — for an explicit concept change — the same
              // concept with only the named fields updated.
              canonical_concept: flyerRevisedConcept.concept,
              ...(flyerRevisedConcept.changedFields.length
                ? { concept_change: { changed_fields: flyerRevisedConcept.changedFields, reason: instruction } }
                : {}),
              creative_direction: flyerRevisedCreativeDirection,
              ...(renderStale ? { url: null, storage_path: null, mime: null, width: null, height: null, render_status: null, rendered_at: null } : {})
            },
            parentAssetId: currentAsset.id,
            status: "completed"
          });
          if (!persisted.ok) throw new Error(persisted.error);
          await repointVariants(persisted.asset.id, {
            caption: gen.content.body,
            hashtags: gen.content.hashtags || [],
            aiContentType: generativeImageUsed ? "generative_image" : "none",
            generativeImageUsed
          });
          await writeCommandAudit(client, user.id, "marketing_content_revised", { shopId, targetType: "marketing_content_items", targetId: body.content_item_id, assetType: "flyer" });
          return json(200, {
            item: { id: currentItem.data.id, status: currentItem.data.status },
            asset: { id: persisted.asset.id, type: "flyer", parent_asset_id: currentAsset.id, content: persisted.asset.content }
          });
        }

        if (currentAsset.asset_type === "social_copy" || currentAsset.asset_type === "video_concept") {
          const { preferences: brandPrefs } = await loadBrandBrain(client, shopId);
          const brandVoiceSummary = buildBrandSummary(brandPrefs);
          const { preferences: visualPrefs } = await loadStyleMemory(client, shopId);
          const visualStyleSummary = buildVisualStyleSummary(visualPrefs);
          const primaryPlatform = variants[0]?.platform || "facebook";

          if (currentAsset.asset_type === "video_concept") {
            const priorText = [currentAsset.content?.script, currentAsset.content?.concept].filter(Boolean).join(" ");
            const requestText = buildWordingRevisionRequestText({ instruction, brief: currentItem.data.brief, priorText });
            const gen = await generateVideoConcept({ persona: "Lily", channel: primaryPlatform, occasion: currentItem.data.title, shop: { name: shopName }, requestText, brandVoiceSummary, visualStyleSummary });
            if (!gen.ok) return json(400, { error: gen.error });
            const newText = [gen.content.script, gen.content.concept].filter(Boolean).join(" ");
            if (!factsPreserved(priorText, newText)) {
              return json(400, { error: "That revision would have changed an exact phone number, date, price, or link — nothing was changed. Try rephrasing the request." });
            }
            // Batch 1 rebuild: video_concept revisions previously ran ONLY
            // factsPreserved — no weak-copy, inventory-claim, closure/
            // invented-content, or visual-fiction check at all (see
            // buildVideoConceptTask's own gap: no sympathy handling and no
            // unconditional anti-fabrication rule either). Detection-only
            // here (video's script/scenes/captions have no headline/body/
            // cta shape to repair field-by-field) — a flagged revision is
            // rejected outright rather than silently patched.
            const videoConceptText = [gen.content.concept, gen.content.script, ...(gen.content.scenes || []), ...(gen.content.captions || [])].filter(Boolean).join(" ");
            const videoEval = evaluateMarketingOutput({
              route: "revise_content",
              request: `${currentItem.data.brief} ${instruction} ${priorText}`,
              shopEvidence: { name: shopName, phone: shopRow.data?.phone },
              inventoryEvidence: currentAsset.content?.grounded_in_inventory || [],
              candidate: videoConceptText,
              component: "video_concept",
              isRetryAttempt: true
            });
            structuredLog("info", "marketing_revise_content_safety", {
              traceId: reviseTraceId,
              route: "revise_content",
              assetType: "video_concept",
              component: "video_concept",
              checksRun: videoEval.checksRun,
              decision: videoEval.reasons.length ? "reject" : "pass",
              reasonCount: videoEval.reasons.length
            });
            if (videoEval.reasons.length) {
              return json(400, { error: "That revision came back with wording Lily can't safely use yet — nothing was changed. Try rephrasing the request." });
            }
            const videoRevisedConcept = buildRevisedConcept({ bodyText: newText });
            const persisted = await persistGeneratedAsset(client, {
              shopId, userId: user.id, persona: "Lily", assetType: "video_concept", model: gen.model,
              content: {
                ...gen.content,
                revision_instruction: instruction,
                revision_traits: appliedTraits,
                canonical_concept: videoRevisedConcept.concept,
                ...(videoRevisedConcept.changedFields.length
                  ? { concept_change: { changed_fields: videoRevisedConcept.changedFields, reason: instruction } }
                  : {})
              },
              parentAssetId: currentAsset.id, status: "completed"
            });
            if (!persisted.ok) throw new Error(persisted.error);
            await repointVariants(persisted.asset.id, { caption: gen.content.script || gen.content.concept || null, hashtags: gen.content.hashtags || [], aiContentType: "none" });
            await writeCommandAudit(client, user.id, "marketing_content_revised", { shopId, targetType: "marketing_content_items", targetId: body.content_item_id, assetType: "video_concept" });
            return json(200, { item: { id: currentItem.data.id, status: currentItem.data.status }, asset: { id: persisted.asset.id, type: "video_concept", parent_asset_id: currentAsset.id, content: persisted.asset.content } });
          }

          const priorText = currentAsset.content?.body || "";
          const requestText = buildWordingRevisionRequestText({ instruction, brief: currentItem.data.brief, priorText });
          const gen = await generateSocialPost({ persona: "Lily", channel: primaryPlatform, occasion: currentItem.data.title, shop: { name: shopName }, requestText, brandVoiceSummary, visualStyleSummary });
          if (!gen.ok) return json(400, { error: gen.error });
          if (!factsPreserved(priorText, gen.content.body)) {
            return json(400, { error: "That revision would have changed an exact phone number, date, price, or link — nothing was changed. Try rephrasing the request." });
          }
          if (detectPermanentClosureMismatch(`${currentItem.data.brief} ${instruction}`, `${gen.content.headline} ${gen.content.body}`)) {
            return json(400, {
              error:
                "That revision came back reading like a permanent closing, but nothing about this post asked for that — nothing was changed. Try rephrasing the request."
            });
          }
          if (detectInventedOperationalContent(`${currentItem.data.brief} ${instruction}`, `${gen.content.headline} ${gen.content.body}`)) {
            return json(400, {
              error: "That revision came back with wording you didn't ask for — an invented reason, urgency, or future plan — nothing was changed. Try rephrasing the request."
            });
          }
          const socialCopyEval = evaluateMarketingOutput({
            route: "revise_content",
            request: `${currentItem.data.brief} ${instruction} ${priorText}`,
            shopEvidence: { name: shopName, phone: shopRow.data?.phone },
            inventoryEvidence: currentAsset.content?.grounded_in_inventory || [],
            candidate: gen.content,
            component: "caption",
            isRetryAttempt: true
          });
          structuredLog("info", "marketing_revise_content_safety", {
            traceId: reviseTraceId,
            route: "revise_content",
            assetType: "social_copy",
            component: "caption",
            checksRun: socialCopyEval.checksRun,
            decision: socialCopyEval.reasons.length ? "reject" : socialCopyEval.repaired ? "repair" : "pass",
            reasonCount: socialCopyEval.reasons.length,
            repaired: socialCopyEval.repaired
          });
          if (socialCopyEval.reasons.length) {
            return json(400, { error: "That revision came back with wording Lily can't safely use yet — nothing was changed. Try rephrasing the request." });
          }
          if (socialCopyEval.safeCandidate) {
            gen.content.headline = socialCopyEval.safeCandidate.headline;
            gen.content.body = socialCopyEval.safeCandidate.body;
            gen.content.cta = socialCopyEval.safeCandidate.cta;
          }
          const socialRevisedConcept = buildRevisedConcept({ ctaText: gen.content.cta, bodyText: gen.content.body });
          const persisted = await persistGeneratedAsset(client, {
            shopId, userId: user.id, persona: "Lily", assetType: "social_copy", provider: "cloudflare", model: gen.model,
            content: {
              headline: gen.content.headline, body: gen.content.body, cta: gen.content.cta, hashtags: gen.content.hashtags,
              brand_traits_used: gen.content.brand_traits_used, visual_traits_used: gen.content.visual_traits_used,
              revision_instruction: instruction, revision_traits: appliedTraits,
              canonical_concept: socialRevisedConcept.concept,
              ...(socialRevisedConcept.changedFields.length
                ? { concept_change: { changed_fields: socialRevisedConcept.changedFields, reason: instruction } }
                : {})
            },
            parentAssetId: currentAsset.id, status: "completed"
          });
          if (!persisted.ok) throw new Error(persisted.error);
          await repointVariants(persisted.asset.id, { caption: gen.content.body, hashtags: gen.content.hashtags || [], aiContentType: "none" });
          await writeCommandAudit(client, user.id, "marketing_content_revised", { shopId, targetType: "marketing_content_items", targetId: body.content_item_id, assetType: "social_copy" });
          return json(200, { item: { id: currentItem.data.id, status: currentItem.data.status }, asset: { id: persisted.asset.id, type: "social_copy", parent_asset_id: currentAsset.id, content: persisted.asset.content } });
        }

        return json(400, { error: `Revising a "${currentAsset.asset_type}" content type isn't supported yet.` });
      }

      // Closes the durability gap a real verification pass caught before
      // this shipped: public/flyer-renderer.js only ever draws a canvas in
      // the florist's own browser — nothing server-side ever produced a
      // real, retrievable file. A flyer asset is created with content.url
      // deliberately null (see generate_content/revise_content above); THIS
      // is the only place that ever fills it in, and only once the exact
      // bytes the florist's browser actually rendered have been uploaded
      // through the same real storage pipeline every other image asset
      // already uses. Until this succeeds, approve_content refuses to
      // approve the item (see below) — a client-side render succeeding is
      // never sufficient on its own.
      //
      // Hardening pass (a real security/durability review before approval):
      // this is a POST accepting arbitrary bytes from the browser, so every
      // field is verified server-side, nothing is trusted from the client
      // beyond "here is a candidate render for this specific asset":
      //   - file validation: real PNG signature, decoded byte-size ceiling,
      //     malformed-base64 rejection, real width/height from the PNG's
      //     own IHDR chunk — see flyer-render.js. SVG/HTML/anything else is
      //     rejected by construction (only image/png is ever accepted).
      //   - ownership: the content item and the asset must both belong to
      //     THIS session's shop — never the client-supplied shop_id alone.
      //   - currency: the client must name the exact asset_id it rendered,
      //     and the server verifies that asset is STILL the item's current
      //     active revision before writing anything. A browser tab that
      //     finishes rendering a since-superseded revision is declined
      //     quietly (nothing about the CURRENT item changes) rather than
      //     silently overwriting the wrong asset's file.
      //   - idempotency: uploadFlyerRenderBuffer always writes to the same
      //     deterministic path for a given asset (upsert:true) — a retry of
      //     this exact call can never create a second, competing file.
      if (action === "finalize_flyer_render" && method === "POST") {
        requireSuperAdminOrShopActor(admin, shopActorAuthorized);
        const shopId = requireShopId(qs, body);
        if (!body.content_item_id) return json(400, { error: "content_item_id is required." });
        if (!body.asset_id) return json(400, { error: "asset_id is required." });
        if (!body.data_url) return json(400, { error: "data_url is required." });

        // File validation FIRST — before any database or storage call at
        // all, so a malformed/oversized/wrong-format payload never even
        // reaches a query.
        const validated = validateFlyerRenderDataUrl(body.data_url);
        if (!validated.valid) return json(400, { error: validated.error });

        // Ownership: the content item must be a real row in THIS shop.
        const itemResult = await client.from("marketing_content_items").select("id").eq("id", body.content_item_id).eq("shop_id", shopId).maybeSingle();
        if (itemResult.error) throw itemResult.error;
        if (!itemResult.data) return json(404, { error: "Content item not found." });

        const variantsResult = await client
          .from("marketing_platform_variants")
          .select("id,asset_id")
          .eq("content_item_id", body.content_item_id)
          .eq("shop_id", shopId);
        if (variantsResult.error) throw variantsResult.error;
        const currentAssetId = (variantsResult.data || []).find((v) => v.asset_id)?.asset_id || null;
        if (!currentAssetId) return json(404, { error: "No generated asset found for this content item." });

        // Currency/stale-revision guard: the render being finalized must be
        // for the item's CURRENT active asset — never an older one a
        // since-run revision has already replaced. A stale finalize is
        // declined without touching anything (not an error the florist
        // needs to see — a different tab or a later revision already moved
        // this item forward).
        if (String(body.asset_id) !== String(currentAssetId)) {
          return json(409, { error: "This flyer has since been revised — reload to see the latest version.", stale: true });
        }

        const assetResult = await client.from("ai_generated_assets").select("id,asset_type,content").eq("id", currentAssetId).eq("shop_id", shopId).maybeSingle();
        if (assetResult.error) throw assetResult.error;
        if (!assetResult.data) return json(404, { error: "Asset not found." });
        if (assetResult.data.asset_type !== "flyer") return json(400, { error: "This content item's asset isn't a flyer." });

        const uploaded = await uploadFlyerRenderBuffer(client, shopId, currentAssetId, { buffer: validated.buffer, mime: validated.mime });
        if (!uploaded.ok) return json(400, { error: uploaded.error });
        const url = publicWebsiteMediaUrl(client, uploaded.path);

        const nextContent = {
          ...assetResult.data.content,
          url,
          storage_path: uploaded.path,
          mime: validated.mime,
          width: validated.width,
          height: validated.height,
          render_status: "rendered",
          rendered_at: new Date().toISOString()
        };
        const updatedAsset = await client
          .from("ai_generated_assets")
          .update({ content: nextContent })
          .eq("id", currentAssetId)
          .eq("shop_id", shopId)
          .select("id,content")
          .single();
        if (updatedAsset.error) throw updatedAsset.error;

        await writeCommandAudit(client, user.id, "marketing_flyer_render_finalized", {
          shopId,
          targetType: "marketing_content_items",
          targetId: body.content_item_id,
          assetId: currentAssetId
        });
        return json(200, { asset: { id: currentAssetId, url, content: updatedAsset.data.content } });
      }

      // "Undo"/"go back to the previous version" — one step back along the
      // SAME parent_asset_id chain revise_content builds. Never deletes
      // anything; just repoints every variant at the parent asset, exactly
      // the way revise_content repoints them at a new child.
      if (action === "revert_content_revision" && method === "POST") {
        requireSuperAdminOrShopActor(admin, shopActorAuthorized);
        const shopId = requireShopId(qs, body);
        if (!body.content_item_id) return json(400, { error: "content_item_id is required." });

        const currentItem = await client
          .from("marketing_content_items")
          .select("id,status")
          .eq("id", body.content_item_id)
          .eq("shop_id", shopId)
          .maybeSingle();
        if (currentItem.error) throw currentItem.error;
        if (!currentItem.data) return json(404, { error: "Content item not found." });

        const variantsResult = await client
          .from("marketing_platform_variants")
          .select("id,platform,asset_id")
          .eq("content_item_id", body.content_item_id)
          .eq("shop_id", shopId);
        if (variantsResult.error) throw variantsResult.error;
        const variants = variantsResult.data || [];
        const currentAssetId = variants.find((v) => v.asset_id)?.asset_id || null;
        if (!currentAssetId) return json(400, { error: "Nothing generated yet — there's no version to undo." });

        const assetResult = await client.from("ai_generated_assets").select("id,parent_asset_id,asset_type").eq("id", currentAssetId).eq("shop_id", shopId).maybeSingle();
        if (assetResult.error) throw assetResult.error;
        if (!assetResult.data) return json(404, { error: "Couldn't find the current version." });
        if (!assetResult.data.parent_asset_id) return json(400, { error: "This is already the original version — nothing to undo." });

        const parentResult = await client.from("ai_generated_assets").select("*").eq("id", assetResult.data.parent_asset_id).eq("shop_id", shopId).maybeSingle();
        if (parentResult.error) throw parentResult.error;
        const parentAsset = parentResult.data;
        if (!parentAsset) return json(404, { error: "Couldn't find the previous version to restore." });

        // A flyer's caption lives in content.caption, same as an image
        // asset's — separate from the on-image headline/body/cta text.
        // Repointing asset_id below restores that whole content object
        // atomically, so undo restores the caption AND the flyer's exact
        // wording together (requirement 9) — no separate flyer-undo path
        // needed.
        const caption =
          parentAsset.asset_type === "image" || parentAsset.asset_type === "flyer"
            ? parentAsset.content?.caption || null
            : parentAsset.asset_type === "video_concept"
            ? parentAsset.content?.script || parentAsset.content?.concept || null
            : parentAsset.content?.body || null;
        const hashtags = parentAsset.content?.hashtags || [];
        // A real photo the florist uploaded herself is never a generative
        // image even though its url is non-null — same real gap fixed at
        // creation time and in revise_content's own disclosure computation.
        const aiContentType =
          parentAsset.asset_type === "image" && parentAsset.content?.url && !parentAsset.content?.user_uploaded_photo ? "generative_image" : "none";

        for (const v of variants) {
          await client
            .from("marketing_platform_variants")
            .update({
              asset_id: parentAsset.id,
              caption,
              hashtags,
              ...computeDisclosureFields({ platform: v.platform, generativeImageUsed: aiContentType === "generative_image", aiContentType })
            })
            .eq("id", v.id)
            .eq("shop_id", shopId);
        }
        await writeCommandAudit(client, user.id, "marketing_content_revision_reverted", { shopId, targetType: "marketing_content_items", targetId: body.content_item_id, restoredAssetId: parentAsset.id });
        return json(200, { item: { id: currentItem.data.id, status: currentItem.data.status }, asset: { id: parentAsset.id, type: parentAsset.asset_type, parent_asset_id: parentAsset.parent_asset_id, content: parentAsset.content } });
      }

      // Stage D — real creative generation for one planned content item.
      // image_post/story/carousel: a real image (Cloudflare) + real copy.
      // reel/short_video/long_video: a real script/storyboard/captions —
      // never a rendered video (no video/AI Clone provider is connected;
      // see marketing-video renderingAvailable:false on the returned
      // asset). Only runs from status 'idea' — refuses to silently
      // re-generate (and re-bill) an item that already has creative.
      // Ad-hoc single-item creation (Phase 1 of the "Florist-Facing
      // Marketing Studio" pass): plan_month is a whole-month occasion
      // planner — there was previously no way to create just ONE content
      // item for a florist's own free-form request ("create a Facebook
      // post for a fresh flower arrangement"). This is the smallest
      // correct addition to close that gap: one idea-status content item
      // + its platform variant rows, the exact same row shape plan_month
      // already inserts, so generate_content/list_content need no changes
      // to work with it.
      if (action === "create_content_item" && method === "POST") {
        requireSuperAdminOrShopActor(admin, shopActorAuthorized);
        const shopId = requireShopId(qs, body);
        const contentType = String(body.content_type || "image_post");
        const title = String(body.title || "").trim();
        const brief = String(body.brief || "").trim();
        if (!brief) return json(400, { error: "Describe what you'd like Lily to create." });
        const platforms = Array.isArray(body.platforms) && body.platforms.length ? body.platforms.filter((p) => SUPPORTED_PLATFORMS.includes(p)) : ["facebook"];
        if (!platforms.length) return json(400, { error: "platforms must include at least one supported platform." });

        const inserted = await client
          .from("marketing_content_items")
          .insert({
            shop_id: shopId,
            campaign_id: body.campaign_id || null,
            created_by: user.id,
            content_type: contentType,
            title: title || brief.slice(0, 80),
            brief,
            status: "idea",
            uses_ai_clone: false,
            requires_human_approval: true
          })
          .select("id,content_type,title,brief,status")
          .single();
        if (inserted.error) {
          if (missingRelation(inserted.error)) throw friendlyMissing();
          throw inserted.error;
        }

        const variantRows = platforms.map((platform) => ({ shop_id: shopId, content_item_id: inserted.data.id, platform, status: "pending" }));
        const insertedVariants = await client.from("marketing_platform_variants").insert(variantRows).select("id,content_item_id,platform");
        if (insertedVariants.error) throw insertedVariants.error;

        await writeCommandAudit(client, user.id, "marketing_content_item_created", { shopId, targetType: "marketing_content_items", targetId: inserted.data.id });
        return json(201, { item: { ...inserted.data, variants: insertedVariants.data || [] } });
      }

      if (action === "generate_content" && method === "POST") {
        requireSuperAdminOrShopActor(admin, shopActorAuthorized);
        const shopId = requireShopId(qs, body);
        if (!body.content_item_id) return json(400, { error: "content_item_id is required." });

        // Phase 2 rebuild, priority-7 gap (observability): one real trace
        // ID threading the actual pipeline stages of this generation
        // through Netlify's own function logs — GROUND -> WRITE ->
        // ART DIRECT -> GENERATE -> QUALITY CHECK -> FACT CHECK -> PERSIST.
        // Deliberately never logs customer PII or full generated text —
        // only shape (lengths/booleans/enum values) and ids, matching
        // every other structuredLog call already in this codebase. This is
        // additive only: no return value, persisted content, or control
        // flow changes based on anything logged here.
        const genTraceId = crypto.randomUUID();
        structuredLog("info", "marketing_generate_content_start", { traceId: genTraceId, shopId, contentItemId: body.content_item_id });

        const currentItem = await client
          .from("marketing_content_items")
          .select("id,content_type,title,brief,status")
          .eq("id", body.content_item_id)
          .eq("shop_id", shopId)
          .maybeSingle();
        if (currentItem.error) {
          if (missingRelation(currentItem.error)) throw friendlyMissing();
          throw currentItem.error;
        }
        if (!currentItem.data) return json(404, { error: "Content item not found." });
        if (currentItem.data.status !== "idea") {
          return json(400, {
            error: `Cannot generate for a content item in status '${currentItem.data.status}'. Only 'idea' items can be generated — this avoids silently re-billing an already-generated piece.`
          });
        }

        // Photo-source choice: Ashley's own real complaint was that a plain
        // "image" post (no on-image text — the decorative/celebratory case,
        // never the flyer path below) always got generic AI stock
        // photography instead of a real photo of her actual shop. Her own
        // answer was "ask me each time" rather than picking one default —
        // so for exactly the requests that would otherwise go straight to
        // AI image generation, short-circuit BEFORE the budget check/status
        // lock/any provider spend and let the client ask. A retry that
        // already answered (photo_choice is "upload", "generate", or —
        // Phase 2 rebuild's asset-routing gap — "reuse") falls straight
        // through untouched. Video concepts and text posts never touch a
        // photo at all, so they're excluded exactly like the real branch
        // below excludes them.
        if (
          currentItem.data.content_type !== "text_post" &&
          !VIDEO_CONTENT_TYPES.has(currentItem.data.content_type) &&
          !requestNeedsFlyerWording(currentItem.data.brief) &&
          body.photo_choice !== "upload" &&
          body.photo_choice !== "generate" &&
          body.photo_choice !== "reuse"
        ) {
          // Real gap an audit found: every plain decorative post defaulted
          // straight to a fresh AI generation or a brand-new upload —
          // nothing ever offered a real photo the florist had already
          // uploaded for an earlier post, even though the shop's own real
          // photography is exactly what Ashley asked for over generic AI
          // stock imagery in the first place. Surfaced here as a third
          // choice alongside upload/generate, never forced — the florist
          // still decides per Ashley's own "ask me each time" answer.
          // Scoped to this shop only (real tenant isolation, not a
          // cross-shop photo library); quarantined assets are excluded.
          // Approval status is intentionally NOT filtered on — a photo's
          // own pixels are just as real and reusable whether or not that
          // earlier POST's wording was ever approved.
          const reusableCandidates = await client
            .from("ai_generated_assets")
            .select("id,content,created_at")
            .eq("shop_id", shopId)
            .eq("asset_type", "flyer")
            .is("quarantine_reason", null)
            .order("created_at", { ascending: false })
            .limit(30);
          const reusablePhotos = (reusableCandidates.data || [])
            .filter((row) => row.content?.user_uploaded_photo === true && row.content?.background_url)
            .slice(0, 6)
            .map((row) => ({
              asset_id: row.id,
              url: row.content.background_url,
              label: row.content.creative_brief?.primary_subject || row.content.visual_brief || null,
              created_at: row.created_at
            }));
          return json(200, { needs_photo_choice: true, item: currentItem.data, reusable_photos: reusablePhotos });
        }

        // Batch 3, Part A/B: the atomic generation claim — a true
        // one-winner conditional UPDATE, not the read-then-write this
        // replaces. The plain read above (currentItem.data.status !==
        // "idea") is only a fast, friendly early rejection for an
        // obviously wrong state (already approved, etc.) — it can NEVER be
        // the real enforcement, because two concurrent requests can both
        // pass that read before either write lands. This UPDATE re-checks
        // status = 'idea' itself, inside the single write, so whichever
        // request's UPDATE actually lands first is the only one that can
        // ever see its own row come back — the second (or Nth) concurrent
        // request's identical UPDATE simply matches zero rows and gets an
        // honest conflict below, never a duplicate claim. Same proven
        // pattern already shipped in marketing-publishing-worker.js's
        // claimDueJobs() (its own docstring explains the same guarantee);
        // no locking table, RPC, or migration needed — plain PostgREST
        // chaining does this safely.
        //
        // This claim happens BEFORE budget/usage reservation and BEFORE
        // any provider call (Part B) — a loser must spend nothing: no
        // provider call, no usage row, no generated asset.
        const claimResult = await client
          .from("marketing_content_items")
          .update({ status: "generating", updated_at: new Date().toISOString() })
          .eq("id", body.content_item_id)
          .eq("shop_id", shopId)
          .eq("status", "idea")
          .select("id,status");
        if (claimResult.error) {
          if (missingRelation(claimResult.error)) throw friendlyMissing();
          throw claimResult.error;
        }
        // Checks the actual returned row's own id, not just "exactly one
        // row came back" — defense in depth against ever mistaking some
        // other coincidentally-one-row response for a real winning claim.
        if (!claimResult.data || claimResult.data.length !== 1 || claimResult.data[0]?.id !== body.content_item_id) {
          // Lost the race (or the status genuinely changed between the
          // read above and this UPDATE) — a clean, honest conflict, never
          // a duplicate generation. Nothing was spent, nothing was
          // claimed, nothing needs to be reverted.
          return json(409, {
            error: "This item is already being generated (or was just generated) by another request — nothing new was started here.",
            already_generating: true
          });
        }

        // Defined here, right after the claim, so EVERY early-return path
        // from this point forward — including the budget-gate refusal just
        // below, which runs AFTER the claim now that Part B moved it there
        // — can put the item back to a retryable 'idea' rather than
        // leaving it stuck in 'generating' (Part C).
        async function revertToIdea() {
          await client
            .from("marketing_content_items")
            .update({ status: "idea", updated_at: new Date().toISOString() })
            .eq("id", body.content_item_id)
            .eq("shop_id", shopId);
        }

        const variantsResult = await client
          .from("marketing_platform_variants")
          .select("id,platform")
          .eq("content_item_id", body.content_item_id)
          .eq("shop_id", shopId);
        if (variantsResult.error) {
          // Part C: this read now runs AFTER the atomic claim — revert
          // before surfacing a genuine DB error, same reasoning as the
          // budget-check failure path below.
          await revertToIdea();
          throw variantsResult.error;
        }
        const variants = variantsResult.data || [];

        // Priority 8/2: a real pre-spend budget gate — estimate what THIS
        // generation would cost (copy always; +image for anything but a
        // video concept/text post/a real uploaded photo — matches exactly
        // what the branches below actually bill via recordUsage) and
        // refuse before any real provider call if the effective cap would
        // be exceeded. The effective cap combines the shop's persisted
        // default (once 20260828000000_marketing_studio_budget_controls.sql
        // is applied — degrades to "none" until then) with an optional
        // caller-supplied budget_cap_cents override, which can be stricter
        // but can never be used to exceed a configured shop hard cap.
        {
          // Real gap an independent review found: photo_choice "upload"
          // never calls recordUsage("image", ...) below (a real photo the
          // florist supplies herself costs nothing to generate) — this
          // estimate must skip that line item too, or a shop close to its
          // cap could have a genuinely free upload wrongly refused as
          // "over budget" for a cost it was never actually going to incur.
          // "reuse" (Phase 2 rebuild's asset-routing gap) is the same: an
          // already-generated photo being referenced again incurs no new
          // image spend either.
          // Batch 2: the image line item must be a WORST-CASE BOUNDED
          // estimate, not a single-attempt one — runMarketingImageQuality's
          // own bounded retry (default maxAttempts: 2) can spend up to 2
          // real image-generation calls AND 2 real vision-inspection calls
          // before it ever resolves to PASS/FALLBACK/FAIL. Checking only
          // the cost of ONE image attempt here would let a genuinely
          // over-budget shop slip through on the strength of an estimate
          // that assumed the best case, then get billed for the retry
          // anyway — this must be refused up front instead.
          const needsImageBudget =
            !VIDEO_CONTENT_TYPES.has(currentItem.data.content_type) &&
            currentItem.data.content_type !== "text_post" &&
            body.photo_choice !== "upload" &&
            body.photo_choice !== "reuse";
          const estimatedAdditionalCents =
            (estimateCostCents({ purpose: "copy", unitType: "request", units: 1 }) || 0) +
            (needsImageBudget ? calculateWorstCaseBoundedCostCents({ maxImageAttempts: 2, maxVisionInspections: 2 }) : 0);
          const budgetCheck = await checkMonthlyBudgetForRequest(client, {
            shopId,
            additionalCostCents: estimatedAdditionalCents,
            requestedCapCents: body.budget_cap_cents != null ? Number(body.budget_cap_cents) : null
          });
          if (!budgetCheck.allowed) {
            if (budgetCheck.reason === "budget_check_failed" || budgetCheck.reason === "shop_budget_lookup_failed") {
              // Part C: the item was already claimed (flipped to
              // 'generating') above, before this budget check — unlike the
              // pre-Batch-3 ordering, where the budget check ran before any
              // lock existed. A genuine budget-check failure here must not
              // leave the item stuck; revert before surfacing the error.
              await revertToIdea();
              throw new Error(budgetCheck.error);
            }
            // Part C: same reasoning as above — the item was already
            // claimed before this check now runs, so a real over-budget
            // refusal must revert it to 'idea' (retryable — e.g. once the
            // shop's spend resets next month, or the cap is raised) rather
            // than leaving it stuck at 'generating' forever.
            await revertToIdea();
            return json(400, {
              error: `Generating this would bring this month's committed spend to $${(budgetCheck.wouldBeCents / 100).toFixed(2)}, over the $${(budgetCheck.capCents / 100).toFixed(2)} budget cap (${budgetCheck.capSource === "shop_default" ? "this shop's configured default" : "the budget given for this request"}) — nothing was generated.`,
              current_spend_cents: budgetCheck.currentSpendCents,
              would_be_cents: budgetCheck.wouldBeCents,
              cap_cents: budgetCheck.capCents,
              cap_source: budgetCheck.capSource
            });
          }
        }

        // The row was already atomically claimed (status flipped idea ->
        // generating) above, before the budget check — no second lock
        // needed or safe to repeat here (an unconditional update at this
        // point would just be the old, race-prone pattern this batch
        // replaces).
        async function recordUsage(purpose, unitType, units) {
          await client.from("marketing_generation_usage").insert({
            shop_id: shopId,
            content_item_id: body.content_item_id,
            provider: "cloudflare",
            purpose,
            unit_type: unitType,
            units,
            estimated_cost_cents: estimateCostCents({ purpose, unitType, units }),
            status: "estimated"
          });
        }

        // "name,phone" — phone is a new read here: a flyer's brand contact
        // line (public/flyer-renderer.js's drawContact) needs the shop's
        // real phone number, and this is the one place generate_content
        // already round-trips the shops table.
        // city,state added for the new "magazine" composition's contact
        // block — only ever shown when the shop's own real profile has one
        // on file (see the brand object below); never fabricated when null.
        // logo_url added (Creative Direction Phase 1, Part C): the
        // deterministic brand-identifier rule needs to know whether this
        // shop actually has a verified logo on file — never invented
        // when absent, see marketing-creative-direction.js's
        // resolveDefaultBrandIdentifier.
        const shopRow = await client.from("shops").select("name,phone,primary_color,accent_color,city,state,logo_url").eq("id", shopId).maybeSingle();
        // Security correction (Ashley, before the live visual test): the
        // shop's own name for branding must come ONLY from this trusted,
        // authenticated shops-table lookup — never from the request text
        // (untrusted: a florist's message could name another business —
        // a competitor, an event venue — and that must never become the
        // flyer's branding authority) and never a silent fallback. If
        // this lookup can't be verified (a real error, no matching row,
        // or a row somehow missing its own name), fail the request
        // closed — log the real failure, revert the item, and return a
        // recoverable error — rather than generating a potentially
        // misbranded flyer or falling back to a generic pronoun.
        // Two genuinely different failures used to share one message and
        // one status code, and the shared message was wrong for the more
        // common of them. A real, live-found case: this shop's own row
        // exists and reads back fine, but its `name` is an empty string —
        // the florist simply hasn't set a shop name yet. That is permanent
        // until someone edits the shop, so "Try Generate again in a
        // moment" was advice that could never work, and it hid the one
        // thing the florist actually had to do. UI wording must match real
        // backend state: a transient lookup failure stays a retryable 502,
        // an unset shop name becomes an actionable 409.
        const shopNameRaw = typeof shopRow.data?.name === "string" ? shopRow.data.name.trim() : "";
        if (shopRow.error || !shopRow.data) {
          console.warn(
            JSON.stringify({
              level: "warn",
              fn: "marketing-studio",
              message: "shop_row_lookup_failed_in_generate_content",
              shopId,
              contentItemId: body.content_item_id,
              reason: shopRow.error ? String(shopRow.error.message || shopRow.error) : "no matching shop row"
            })
          );
          await revertToIdea();
          return json(502, {
            error: "Couldn't verify your shop's information just now, so nothing was generated — nothing was saved. Try Generate again in a moment; contact support if this keeps happening."
          });
        }
        if (!shopNameRaw) {
          console.warn(
            JSON.stringify({
              level: "warn",
              fn: "marketing-studio",
              message: "shop_row_missing_name_in_generate_content",
              shopId,
              contentItemId: body.content_item_id,
              reason: "shop row missing a name"
            })
          );
          await revertToIdea();
          return json(409, {
            error:
              "Your shop doesn't have a name saved yet, and your posts have to show which shop they came from — so nothing was generated and nothing was saved. Add your shop name in Settings, then try Generate again."
          });
        }
        const shopName = shopNameRaw;
        const primaryPlatform = variants[0]?.platform || "facebook";

        // Comparison only, per Ashley's explicit requirement: the
        // request's own wording may be COMPARED against the authenticated
        // shop's real name for visibility (a florist could be describing
        // or mentioning a different business by name), but the result is
        // NEVER used to set or override branding — see
        // extractShopNameFromRequestText's docstring in
        // marketing-content-revision.js. Log-only, never blocks, never
        // changes what gets generated.
        {
          const mentionedName = extractShopNameFromRequestText(currentItem.data.brief);
          if (mentionedName && mentionedName.trim().toLowerCase() !== shopName.trim().toLowerCase()) {
            console.warn(
              JSON.stringify({
                level: "warn",
                fn: "marketing-studio",
                message: "request_text_names_different_business",
                shopId,
                contentItemId: body.content_item_id,
                authenticatedShopName: shopName,
                requestMentionedName: mentionedName
              })
            );
          }
        }

        // Priority F / Phase 4 wiring ("one authoritative shop context
        // layer"): Brand Brain, My Style, and real inventory are all real,
        // shop-scoped grounding for content generation — previously each
        // loaded independently here with its own inline query pair. Now
        // loaded through the one shared loader every marketing-content-
        // generation call site uses (marketing-compound-orchestrator.js,
        // ai-orchestrator.js's general Lily chat path) — see
        // marketing-generation-grounding.js's own docstring for why a
        // single shared layer matters here. Brand Brain's own
        // buildBrandSummary()/My Style's buildStyleSummary() were
        // previously documented as "handed to Lily's content-generation
        // prompts" without ever actually being called at generation time —
        // this closes that read-time gap; the prompts themselves
        // (buildSocialPostTask/buildVideoConceptTask) frame each as a
        // DEFAULT the request's own explicit instructions still override.
        // Real current inventory means "I have 40 roses I need to sell,
        // make a Facebook post" is grounded in the shop's actual stock, not
        // invented — an empty shop degrades to no inventory section at
        // all, never a fabricated one. Every read here is shop-scoped via
        // each underlying loader's own .eq("shop_id", shopId).
        // Phase 9 ("connect intelligence to marketing"): "audience" opted
        // in explicitly (it's not one of loadGenerationGrounding's default
        // three) — real subscriber/segment counts now ground the same
        // generation calls brand voice and inventory already do.
        // Phase 2 rebuild, priority-4 gap: "recent" also opted in here —
        // this shop's own real recent post captions, so back-to-back
        // requests don't land on the same opening line week after week.
        // excludeContentItemId is this item's own id so a later revision
        // pass over the SAME item never sees its own prior caption in its
        // own "don't repeat this" list.
        const { brandVoiceSummary, visualStyleSummary, inventorySummary, inventorySources, audienceSummary, recentContentSummary, recentContentHistory } = await loadGenerationGrounding(
          client,
          shopId,
          { needs: ["brand", "style", "inventory", "audience", "recent"], excludeContentItemId: body.content_item_id }
        );
        // GROUND stage — booleans only, never the summaries' own text.
        structuredLog("info", "marketing_generate_content_grounded", {
          traceId: genTraceId,
          hasBrandVoice: Boolean(brandVoiceSummary),
          hasVisualStyle: Boolean(visualStyleSummary),
          hasInventory: Boolean(inventorySummary),
          hasAudience: Boolean(audienceSummary),
          hasRecentContent: Boolean(recentContentSummary)
        });

        if (VIDEO_CONTENT_TYPES.has(currentItem.data.content_type)) {
          await recordUsage("copy", "request", 1);
          const gen = await generateVideoConcept({
            persona: "Lily",
            channel: primaryPlatform,
            occasion: currentItem.data.title,
            shop: { name: shopName },
            requestText: currentItem.data.brief,
            brandVoiceSummary,
            visualStyleSummary,
            inventorySummary,
            audienceSummary,
            recentContentSummary
          });
          if (!gen.ok) {
            await revertToIdea();
            return json(400, { error: gen.error });
          }
          // Batch 4 ("persisted canonical concept + revision enforcement"):
          // the video branch runs before the richer `concept` object below
          // is ever built (no copyGen/objective exists yet for a video
          // request), so its own canonical concept is derived directly from
          // the same real signals available here — the request text, the
          // model's own one-sentence pitch as the closest thing to a
          // primary subject, and the same bereavement detector every other
          // branch uses. Never a duplicate concept system: same module,
          // same enums, same classifiers.
          const videoCanonicalConcept = buildCanonicalConcept({
            requestText: currentItem.data.brief,
            occasionTitle: currentItem.data.title,
            platform: primaryPlatform,
            contentType: currentItem.data.content_type,
            assetType: "video_concept",
            primarySubject: gen.content.concept || null,
            bodyText: gen.content.script || "",
            isSympathy: BEREAVEMENT_CONTEXT_RE.test(currentItem.data.brief),
            invGroundedCount: inventorySources.length
          });
          const persisted = await persistGeneratedAsset(client, {
            shopId,
            userId: user.id,
            persona: "Lily",
            assetType: "video_concept",
            provider: "cloudflare",
            model: gen.model,
            // grounded_in_inventory: the same real-source-list convention
            // compound.generateImage already records — [] when nothing was
            // available to ground on, never a guess at what the model used.
            content: { ...gen.content, grounded_in_inventory: inventorySources, canonical_concept: videoCanonicalConcept },
            status: "completed"
          });
          if (!persisted.ok) {
            await revertToIdea();
            throw new Error(persisted.error);
          }
          if (variants.length) {
            // Launch-blocker fix (Blocker 1): compute+persist disclosure
            // fields the moment content is attached, per-platform — never
            // leave ai_disclosure_required at its fail-open DB default
            // waiting for a separate manual set_content_disclosure call.
            // This is a script/storyboard/caption ONLY (Section 6 of the
            // launch audit: nothing here actually renders a video), so no
            // avatar/voice/generative-video/generative-image flag is true
            // — the determination correctly comes back not-required, and
            // that "checked, not required" state is now recorded
            // explicitly instead of silently defaulting.
            for (const v of variants) {
              await client
                .from("marketing_platform_variants")
                .update({
                  asset_id: persisted.asset.id,
                  caption: gen.content.script || gen.content.concept || null,
                  hashtags: gen.content.hashtags || [],
                  // aiContentType is deliberately "none", not
                  // "generative_video" — no video is actually rendered
                  // here, only a text script/storyboard/caption plan.
                  ...computeDisclosureFields({ platform: v.platform, aiContentType: "none" })
                })
                .eq("id", v.id)
                .eq("shop_id", shopId);
            }
          }
          const updated = await client
            .from("marketing_content_items")
            .update({ status: "draft", updated_at: new Date().toISOString() })
            .eq("id", body.content_item_id)
            .eq("shop_id", shopId)
            .select("id,status")
            .single();
          if (updated.error) throw updated.error;
          await writeCommandAudit(client, user.id, "marketing_content_generated", {
            shopId,
            targetType: "marketing_content_items",
            targetId: body.content_item_id,
            assetType: "video_concept"
          });
          return json(200, {
            item: updated.data,
            asset: { id: persisted.asset.id, type: "video_concept", content: gen.content },
            note: "NOT LIVE — PROVIDER CONNECTION REQUIRED for actual video rendering. This is the finished script/storyboard/captions only — connect a generative video or AI Clone provider (Stage E) to render it."
          });
        }

        // Real, live-found failure (Ashley's real branch-deploy tests,
        // twice now): a plain operational notice ("closing at 2:30 today,
        // call to order") kept reaching an AI paraphrase step at all —
        // even a "safe" (non-invented, non-permanent-misread) paraphrase
        // still silently dropped the actual closing time, and a request
        // that fully passed every safety guard still got needlessly
        // reworded. Architecture fix, per the explicit requirement: for a
        // plain operational notice whose material facts can be verified
        // up front, there is exactly ONE authoritative grounded content
        // object (buildDeterministicNoticeContent) — built directly from
        // the request's own facts, NEVER asked of AI — and the caption
        // (and, below, the flyer's on-image text) consume it directly.
        // This is computed and used BEFORE ever calling generateSocialPost,
        // not as a reactive check afterward, so no AI paraphrase of a
        // verified operational notice happens in the first place. A
        // request that isn't a plain operational notice at all (a normal
        // creative post, a sale, an event) never enters this branch —
        // requestSignalsPlainOperationalNotice is the same narrow,
        // promotional-signal-excluding gate the reactive guards already
        // used, so ordinary creative/sale/event generation is completely
        // unaffected.
        let noticeFallback = requestSignalsPlainOperationalNotice(currentItem.data.brief)
          ? buildDeterministicNoticeContent({ requestText: currentItem.data.brief, shopName, shopPhone: shopRow.data?.phone })
          : null;

        let copyGen;
        if (noticeFallback) {
          // No AI call at all for the wording — a real generation still
          // happened (usage/budget accounting stays honest), it's just
          // deterministic rather than model-produced.
          await recordUsage("copy", "request", 1);
          copyGen = {
            ok: true,
            model: "deterministic",
            content: {
              platform: primaryPlatform,
              headline: noticeFallback.headline,
              body: noticeFallback.caption,
              cta: noticeFallback.cta,
              visual_brief: "",
              hashtags: [],
              asset_requirements: [],
              brand_traits_used: [],
              visual_traits_used: [],
              // Creative Direction Phase 1 correctness fix: this branch
              // never set `objective` before, so a REAL deterministic
              // operational notice's own canonical_concept.occasionCategory
              // (which keys off objective === "operational" — see
              // classifyOccasionCategory in marketing-canonical-concept.js)
              // silently fell through to "general" instead of
              // "operational_notice" — the AI-authored path already sets
              // this; the deterministic path was the one gap. Needed for
              // Creative Direction's own family resolution (Part D) to
              // correctly recognize a real notice through this exact path.
              objective: "operational"
            }
          };
          // FACT CHECK stage, deterministic path: the wording was never
          // paraphrased by AI at all — built directly from the request's
          // own verified facts — so there is nothing for the reactive
          // detectors below to check. Logged for the same reason the AI
          // path's own fact-safety tag is logged: one real record of what
          // actually happened, not an assumption from which branch ran.
          structuredLog("info", "marketing_generate_content_fact_safety", { traceId: genTraceId, deterministic: true });
        } else {
          await recordUsage("copy", "request", 1);
          const socialPostArgs = {
            persona: "Lily",
            channel: primaryPlatform,
            occasion: currentItem.data.title,
            shop: { name: shopName },
            requestText: currentItem.data.brief,
            brandVoiceSummary,
            visualStyleSummary,
            inventorySummary,
            audienceSummary,
            recentContentSummary
          };
          copyGen = await generateSocialPost(socialPostArgs);
          if (!copyGen.ok) {
            await revertToIdea();
            return json(400, { error: copyGen.error });
          }
          // Copy can be wrong in TONE while every fact in it is true, and
          // every existing guard here checks facts. A post asking for funeral
          // work came back framing a death as a milestone to celebrate,
          // wrapped in filler that would suit any business on earth — nothing
          // invented, nothing caught, unpublishable.
          //
          // Batch 1 rebuild: this whole block (quality retry, contact-number/
          // inventory-claim/visual-fiction stripping, and the closure/
          // invented-content hard gate) is now ONE call to the shared
          // evaluateMarketingOutput() evaluator — the authoritative Marketing
          // output-safety pipeline every route uses, rather than this route's
          // own hand-wired subset of detectors. Nothing here is a new check:
          // every detector evaluateMarketingOutput calls already existed and
          // was already wired at this exact call site before this refactor.
          const captionShopEvidence = { name: shopName, phone: shopRow.data?.phone };
          const captionInventoryEvidence = inventorySources || [];
          let captionEval = evaluateMarketingOutput({
            route: "generate_content",
            request: currentItem.data.brief,
            shopEvidence: captionShopEvidence,
            inventoryEvidence: captionInventoryEvidence,
            candidate: copyGen.content,
            component: "caption"
          });
          // Batch 5, Part E/F: a lightweight, NOT-persisted preview of
          // this candidate's own canonical concept, built purely to give
          // the diversity evaluator real structured fields to compare
          // against — the ad-hoc `concept`/the actually-persisted
          // canonical_concept are still built later, from the FINAL kept
          // draft, exactly as Batch 4 left them. Never a second concept
          // system: same buildCanonicalConcept, same signals.
          const buildDiversityPreviewConcept = (content) =>
            buildCanonicalConcept({
              requestText: currentItem.data.brief,
              occasionTitle: currentItem.data.title,
              platform: primaryPlatform,
              contentType: currentItem.data.content_type,
              objective: content?.objective || null,
              primarySubject: content?.creative_brief?.primary_subject || content?.visual_brief || null,
              ctaText: content?.cta || null,
              bodyText: content?.body || "",
              isSympathy: BEREAVEMENT_CONTEXT_RE.test(`${currentItem.data.brief} ${content?.body || ""}`),
              creativeBrief: content?.creative_brief || null,
              invGroundedCount: (inventorySources || []).length
            });
          let diversityEval = evaluateMarketingDiversity({
            candidate: copyGen.content,
            canonicalConcept: buildDiversityPreviewConcept(copyGen.content),
            recentHistory: recentContentHistory,
            platform: primaryPlatform,
            contentItemId: body.content_item_id
          });
          structuredLog("info", "marketing_generate_content_diversity", {
            traceId: genTraceId,
            decision: diversityEval.decision,
            repeatedSignals: diversityEval.repeatedSignals
          });
          if (captionEval.reasons.length || diversityEval.decision === "retry") {
            await recordUsage("copy", "request", 1);
            // Real regression an independent review found: appending the
            // rejection reasons here used to dilute the brief enough that
            // requestIsJustShopName no longer recognized it (too many
            // extra words), so sanitizedRequestForModel's own internal
            // check silently stopped substituting the neutral placeholder
            // — letting the literal shop-name-only text leak straight back
            // into the model's Input JSON on exactly the retry that exists
            // BECAUSE the first attempt fixated on that same text. Sanitize
            // the brief FIRST, then append the correction feedback (which
            // is safe — it's a warning against the fixation, not a restated
            // topic) — never let the two get concatenated before the check
            // runs. Batch 5: the SAME bounded retry now also carries the
            // diversity evaluator's own reasons — never a second, separate
            // retry call (Part E: "do not create recursive diversity
            // retries").
            const combinedReasons = [...captionEval.reasons, ...diversityEval.reasons];
            const retry = await generateSocialPost({
              ...socialPostArgs,
              requestText:
                `${sanitizedRequestForModel(currentItem.data.brief, shopName)}\n\nA previous attempt was rejected for these reasons — do not repeat them:\n- ${combinedReasons.join("\n- ")}`
            });
            // The retry is not automatically the better one. Handed its own
            // faults back, a model can fix the named phrase and introduce two
            // more, and the florist would have been shown the worse of the two
            // drafts with no way to know a better one existed. Keep whichever
            // attempt actually has fewer COMBINED problems (safety + diversity);
            // a tie keeps the retry, since it is the one that was told what
            // was wrong.
            if (retry.ok && retry.content?.body) {
              const retryEval = evaluateMarketingOutput({
                route: "generate_content",
                request: currentItem.data.brief,
                shopEvidence: captionShopEvidence,
                inventoryEvidence: captionInventoryEvidence,
                candidate: retry.content,
                component: "caption",
                isRetryAttempt: true
              });
              const retryDiversityEval = evaluateMarketingDiversity({
                candidate: retry.content,
                canonicalConcept: buildDiversityPreviewConcept(retry.content),
                recentHistory: recentContentHistory,
                platform: primaryPlatform,
                contentItemId: body.content_item_id
              });
              const currentBadCount = captionEval.reasons.length + diversityEval.reasons.length;
              const retryBadCount = retryEval.reasons.length + retryDiversityEval.reasons.length;
              if (retryBadCount <= currentBadCount) {
                copyGen = retry;
                captionEval = retryEval;
                diversityEval = retryDiversityEval;
              }
            }
          }
          // Whatever draft was kept, its deterministically-repaired fields
          // (a fabricated contact number substituted, an unverified
          // inventory/visual-fiction claim cut) are always applied — the
          // bounded retry above is a second opinion, not a guarantee.
          if (captionEval.safeCandidate) {
            copyGen.content.headline = captionEval.safeCandidate.headline;
            copyGen.content.body = captionEval.safeCandidate.body;
            copyGen.content.cta = captionEval.safeCandidate.cta;
          }

          // Reactive safety net for the rare case that reaches here at
          // all — requestSignalsPlainOperationalNotice already said this
          // ISN'T a plain notice (a sale/event framing, most often), so an
          // AI paraphrase is legitimately expected; this still catches an
          // outright invented/mismatched result and recovers with the
          // same deterministic content when the request's own facts allow
          // it — never reverting the florist to idea when a safe fallback
          // exists, only when genuinely nothing can be built from.
          //
          // Phase 2 rebuild, priority-6 gap ("unified fact-safety
          // tagging"): named here, not re-implemented — this repo already
          // has real, independently-tested fact-safety detectors, all of
          // them run above via evaluateMarketingOutput. A SECOND detection
          // engine duplicating that logic was explicitly ruled out. The
          // structuredLog call below IS the unified tag: one real event
          // naming every check that ran for this generation and its
          // outcome — reason CODES and counts only, never the customer's
          // actual generated text.
          let rescued = false;
          if (captionEval.reasons.length) {
            // Regression repair: by construction, reaching this branch at
            // all means requestSignalsPlainOperationalNotice() already
            // said this ISN'T a plain notice (the `if (noticeFallback)`
            // branch above would have short-circuited before any AI call
            // or evaluation ever ran). So this is always the
            // non-operational creative case — the deterministic NOTICE
            // rescue must never be used here; it produced "Store Notice /
            // has an update for you" for an ordinary creative request.
            const rescueFallback = buildDeterministicCreativeRescueContent({ shopName, shopPhone: shopRow.data?.phone });
            // Reused as `nf` by generateFlyerCopy below — this is what
            // stops the flyer's on-image wording from independently
            // re-attempting an AI call (and its own cost) for content
            // the caption already determined needs a safe rescue. Same
            // mechanism the operational-notice case already relied on;
            // only the object's shape (creative vs. notice) differs.
            noticeFallback = rescueFallback;
            copyGen.content.headline = rescueFallback.headline;
            copyGen.content.body = rescueFallback.caption;
            copyGen.content.cta = rescueFallback.cta;
            copyGen.content.hashtags = [];
            copyGen.content.brand_traits_used = [];
            copyGen.content.visual_traits_used = [];
            // Distinguishes a safe rescue from a normal successful AI
            // creative draft — never presented internally as if the model
            // wrote it, and never hidden from the florist (they still see
            // and can edit/regenerate it like any other draft).
            copyGen.content.creative_rescue_used = true;
            rescued = true;
          }
          structuredLog("info", "marketing_generate_content_fact_safety", {
            traceId: genTraceId,
            deterministic: false,
            route: "generate_content",
            component: "caption",
            checksRun: captionEval.checksRun,
            decision: captionEval.reasons.length ? "reject" : captionEval.repaired ? "repair" : "pass",
            reasonCount: captionEval.reasons.length,
            repaired: captionEval.repaired,
            rescued
          });
        }

        // Phase 3 live-test fix (one-concept contract, requirement 5): the
        // real root cause of the live failure was never a missing check —
        // it was that the caption and the flyer's own on-image text were
        // two fully independent AI calls, each free to re-derive its own
        // idea of "what is this post about" from the same bare brief, with
        // nothing carrying the FIRST successful generation's own decision
        // forward. `concept` is that missing contract: the caption call
        // (copyGen) already decided a real subject/objective/tone for this
        // post, and this is what generateFlyerCopy/generateFlyerContent
        // below are now told to write FROM, rather than re-deciding their
        // own. Deliberately reuses copyGen's own already-produced fields —
        // no new AI call, per the explicit "prefer threading the existing
        // copyGen result downstream" instruction.
        //
        // objective is validated here, not just trusted from the model's
        // own self-report (Phase 2's normalizeObjective only checks it's a
        // real enum value, never that it's actually SUPPORTED) —
        // "promotion" is itself a business claim, exactly like a shipment
        // or a phone number, and must never survive un-evidenced just
        // because it sounds like a more exciting objective to have
        // written for.
        // Product rule (Phase 3 follow-up, "no independent flower
        // choice"): creative_brief.primary_subject and visual_brief
        // describe what this post's IMAGE actually depicts — never an
        // educational aside — so any named flower there needs the same
        // real evidence a current-stock claim would, unconditionally
        // (see sanitizeUngroundedFlowerNames's own docstring for why this
        // is a separate check from the claim-sentence detector above).
        // Sanitized here, once, before concept/image-prompt construction
        // ever reads either field, so every downstream use — concept.
        // primarySubject just below, the actual image-generation prompt,
        // and the persisted content — already sees the cleaned value.
        // Batch 1 rebuild: routed through the same shared
        // evaluateMarketingOutput() evaluator (component: "creative_scene")
        // rather than calling sanitizeUngroundedFlowerNames directly — the
        // underlying check is unchanged, this just makes the primary
        // generation route go through the one authoritative pipeline like
        // every other component here.
        const sceneShopEvidence = { name: shopName, phone: shopRow.data?.phone };
        const sceneInventoryEvidence = inventorySources || [];
        if (copyGen.content?.visual_brief) {
          const visualBriefEval = evaluateMarketingOutput({
            route: "generate_content",
            request: currentItem.data.brief,
            shopEvidence: sceneShopEvidence,
            inventoryEvidence: sceneInventoryEvidence,
            candidate: copyGen.content.visual_brief,
            component: "creative_scene"
          });
          if (visualBriefEval.decision === "repair") copyGen.content.visual_brief = visualBriefEval.safeCandidate;
        }
        if (copyGen.content?.creative_brief?.primary_subject) {
          const primarySubjectEval = evaluateMarketingOutput({
            route: "generate_content",
            request: currentItem.data.brief,
            shopEvidence: sceneShopEvidence,
            inventoryEvidence: sceneInventoryEvidence,
            candidate: copyGen.content.creative_brief.primary_subject,
            component: "creative_scene"
          });
          if (primarySubjectEval.decision === "repair") copyGen.content.creative_brief.primary_subject = primarySubjectEval.safeCandidate;
        }

        const conceptObjective =
          copyGen.content?.objective === "promotion" && !requestSignalsRealPromotion(currentItem.data.brief) ? null : copyGen.content?.objective || null;
        const concept = {
          objective: conceptObjective,
          primarySubject: copyGen.content?.creative_brief?.primary_subject || copyGen.content?.visual_brief || null,
          captionExcerpt: copyGen.content?.body || "",
          isSympathy: BEREAVEMENT_CONTEXT_RE.test(`${currentItem.data.brief} ${copyGen.content?.body || ""}`),
          // Independent-review fix: the flyer's own creative rescue
          // (generateFlyerCopy, below) gates its CTA on this field — it
          // was previously always undefined here (dead code, always
          // defaulting to "allow a call CTA"), the same classifier
          // buildCanonicalConcept uses later at persistence time, applied
          // to the caption's actual (possibly already-rescued) CTA text,
          // so the gate reflects what this post's CTA is really doing.
          ctaIntent: classifyCtaIntent(copyGen.content?.cta || "")
        };

        // Batch 4 ("persisted canonical concept + revision enforcement",
        // Part A/B/C): `concept` above is the existing, already-tested
        // ad-hoc contract between the caption call and generateFlyerCopy —
        // deliberately left untouched. This builds the richer, PERSISTED
        // canonical concept from the exact same real signals, once per
        // branch below, at the point each branch actually knows its own
        // real assetType/photoStrategy/styleTier — never guessed ahead of
        // time, never a second competing concept system. This is what
        // caption, flyer, image, and CTA all end up sharing on the
        // persisted asset, and what every future revision must inherit
        // from (see marketing-canonical-concept.js).
        function buildConceptForAsset({ assetType, ctaText = null, bodyText = "", photoStrategy = null, styleTier = null, userUploadedPhoto: uploadedPhoto = false, reusedFromAssetId = null }) {
          return buildCanonicalConcept({
            requestText: currentItem.data.brief,
            occasionTitle: currentItem.data.title,
            platform: primaryPlatform,
            contentType: currentItem.data.content_type,
            assetType,
            objective: concept.objective,
            primarySubject: concept.primarySubject,
            ctaText,
            bodyText,
            isSympathy: concept.isSympathy,
            creativeBrief: copyGen.content?.creative_brief || null,
            photoStrategy,
            styleTier,
            userUploadedPhoto: uploadedPhoto,
            reusedFromAssetId,
            invGroundedCount: (inventorySources || []).length
          });
        }

        // Every flyer-typed asset needs its own real on-image wording
        // (headline/body/cta) — a SEPARATE generation call from the
        // Facebook caption above, checked independently for the same
        // failure modes, with the same safe-fallback recovery (never a
        // dead-end revert to idea). Extracted once both the exact-facts
        // flyer path AND the subject-forward "designed graphic, real
        // photo" path below need it — a real request/live-test finding:
        // Ashley's own actual ChatGPT reference for an ordinary decorative
        // post is a fully designed, branded flyer with her shop's own
        // name, tagline, occasions served, and contact info woven right
        // onto a real bouquet photo — not a bare, undesigned photograph.
        // Never duplicated: the same retry/fallback guarantees this
        // wording gets on the exact-facts path apply here too, rather than
        // a second, independently-drifting copy of the same logic.
        async function generateFlyerCopy({ noticeFallback: nf, brief, occasionTitle, concept: flyerConcept = null }) {
          if (nf) {
            // The caption already needed the safe deterministic fallback
            // — this request's topic is safety-sensitive, so the on-image
            // text uses the SAME safe wording rather than risking a
            // second, independent AI call that could invent something
            // different (or differently wrong). No API call, no usage
            // charged for one that didn't happen.
            return {
              ok: true,
              model: "deterministic",
              content: {
                headline: nf.headline,
                body: nf.body,
                cta: nf.cta,
                // Only set when `nf` is the non-operational creative
                // rescue (identified by its own `kind`) — an operational
                // notice's on-image text is deterministic-by-design, not
                // a safety rescue, and keeps its existing unflagged shape.
                ...(nf.kind === "creative_rescue" ? { creative_rescue_used: true } : {})
              }
            };
          }
          await recordUsage("copy", "request", 1);
          // Phase 3 live-test fix (one-concept contract): `flyerConcept`,
          // when supplied by a caller that already has a caption for this
          // same post, is what stops this call from independently
          // re-deciding what the post is about — see its own construction
          // above for why. Optional so a caller with no caption yet (the
          // exact-facts branch's own retry pattern, or a future standalone
          // caller) still works exactly as before.
          let flyerGen = await generateFlyerContent({ persona: "Lily", message: brief, occasion: occasionTitle, shop: { name: shopName }, concept: flyerConcept });
          // The flyer is where a wording failure does the most damage —
          // it is the picture that gets shared, long after the caption
          // scrolls away. Ashley was shown one reading "Funeral / SERVICES
          // AVAILABLE" above her shop name and phone number: "it reads
          // like I'm going to hold funeral services here at the flower
          // shop." One bounded retry with the reason handed back.
          //
          // Batch 1 rebuild: the same shared evaluateMarketingOutput()
          // evaluator the caption uses above — component "flyer_text",
          // with `canonicalConcept: flyerConcept` so the coherence/CTA
          // checks run exactly when a concept exists to check against,
          // same as before. Nothing here is a new check.
          const flyerShopEvidence = { name: shopName, phone: shopRow.data?.phone };
          const flyerInventoryEvidence = inventorySources || [];
          let flyerEval = null;
          if (flyerGen.ok && flyerGen.content) {
            flyerEval = evaluateMarketingOutput({
              route: "generate_content",
              request: brief,
              shopEvidence: flyerShopEvidence,
              inventoryEvidence: flyerInventoryEvidence,
              canonicalConcept: flyerConcept,
              candidate: flyerGen.content,
              component: "flyer_text"
            });
            if (flyerEval.reasons.length) {
              await recordUsage("copy", "request", 1);
              // Sanitize the brief BEFORE appending the rejection reasons,
              // so the diluted, longer compound text can't slip past
              // sanitizedRequestForModel's own internal check on the way
              // into generateFlyerContent.
              const flyerRetry = await generateFlyerContent({
                persona: "Lily",
                message: `${sanitizedRequestForModel(brief, shopName)}\n\nA previous attempt was rejected for these reasons — do not repeat them:\n- ${flyerEval.reasons.join("\n- ")}`,
                occasion: occasionTitle,
                shop: { name: shopName },
                concept: flyerConcept
              });
              // Same reasoning as the caption retry above: this wording is
              // printed on the graphic itself, where a florist cannot edit
              // it before it goes out, so shipping the worse of two drafts
              // matters more here, not less.
              if (flyerRetry.ok && flyerRetry.content?.headline) {
                const flyerRetryEval = evaluateMarketingOutput({
                  route: "generate_content",
                  request: brief,
                  shopEvidence: flyerShopEvidence,
                  inventoryEvidence: flyerInventoryEvidence,
                  canonicalConcept: flyerConcept,
                  candidate: flyerRetry.content,
                  component: "flyer_text",
                  isRetryAttempt: true
                });
                if (flyerRetryEval.reasons.length <= flyerEval.reasons.length) {
                  flyerGen = flyerRetry;
                  flyerEval = flyerRetryEval;
                }
              }
            }
          }
          if (!flyerGen.ok) return { ok: false, error: flyerGen.error };
          // Whatever draft was kept, its deterministically-repaired fields
          // are always applied first (a fabricated number, an unverified
          // inventory/visual-fiction claim) — the bounded retry above is a
          // second opinion, not a guarantee.
          if (flyerEval?.safeCandidate) {
            flyerGen.content.headline = flyerEval.safeCandidate.headline;
            flyerGen.content.body = flyerEval.safeCandidate.body;
            flyerGen.content.cta = flyerEval.safeCandidate.cta;
          }
          structuredLog("info", "marketing_generate_content_coherence", {
            traceId: genTraceId,
            checked: Boolean(flyerConcept),
            mismatch: Boolean(flyerEval?.reasons?.length),
            reason: flyerEval?.reasons?.[0] || null
          });
          // Real, live-found failure: the flyer's own on-image wording
          // must be checked independently for the same invented/mismatched
          // content a caption can suffer, with the same safe-fallback
          // recovery — a florist can just as easily hit this on the flyer
          // text alone. Last gate before the wording reaches the canvas.
          //
          // Regression repair: by construction, this function already
          // returned early via the `if (nf) {...}` branch above when the
          // request WAS a plain operational notice — so reaching here at
          // all means it wasn't. The deterministic NOTICE rescue must
          // never fire in this branch; it produced "Store Notice / has an
          // update for you" on-image for an ordinary creative flyer.
          if (flyerEval?.reasons?.length) {
            const flyerFallback = buildDeterministicCreativeRescueContent({
              shopName,
              shopPhone: shopRow.data?.phone,
              ctaIntent: flyerConcept?.ctaIntent ?? null
            });
            flyerGen.content.headline = flyerFallback.headline;
            flyerGen.content.body = flyerFallback.body;
            flyerGen.content.cta = flyerFallback.cta;
            flyerGen.content.creative_rescue_used = true;
          }
          return { ok: true, model: flyerGen.model, content: flyerGen.content };
        }

        let assetId = null;
        let imageUrl = null;
        let generatedAssetType = null;
        // True only when this asset's photo came from the florist's own
        // upload rather than an AI image call — read below when computing
        // per-platform AI disclosure, so a real uploaded photo never gets
        // labeled "generative_image" just because imageUrl is non-null.
        let userUploadedPhoto = false;
        if (currentItem.data.content_type !== "text_post") {
          // Ashley's own real example of what she's actually after (a
          // ChatGPT-produced post she pointed at directly): a real photo
          // and a well-written caption underneath it — nothing drawn onto
          // the image itself. Her own follow-up confirmed it genuinely
          // depends on the request: an operational notice (a closing time,
          // a phone number, a deadline) still needs that wording visible
          // and exact ON the graphic, since it can be shared or
          // screenshotted standalone — that's requestNeedsFlyerWording,
          // Florisyn's own deterministic flyer path below, unchanged. An
          // ordinary decorative/celebratory request ("fresh roses just
          // arrived", a mascot post) goes back to being a real photo with
          // NO on-image text at all — the plain "image" asset type, exactly
          // as it worked before this session's now-reverted "every post
          // gets the poster treatment" change, which was a real miss: it
          // read her rejection of a badly-composited photo as a request for
          // MORE on-image graphic design, when what she actually wanted was
          // less of it, not more.
          if (requestNeedsFlyerWording(currentItem.data.brief)) {
            const flyerCopyResult = await generateFlyerCopy({ noticeFallback, brief: currentItem.data.brief, occasionTitle: currentItem.data.title, concept });
            if (!flyerCopyResult.ok) {
              await revertToIdea();
              return json(400, { error: flyerCopyResult.error });
            }
            const flyerGen = { model: flyerCopyResult.model, content: flyerCopyResult.content };
            const template = pickFlyerTemplate({ occasion: currentItem.data.title });
            const aspectRatio = pickAspectRatio(primaryPlatform);
            const groundedFlowerNames = (inventorySources || []).map((i) => i.name).filter(Boolean);
            // Tier A by default (a real, photographic background — Ashley's
            // explicit design direction: the default poster must never be a
            // flat brand-color rectangle) — falls back to Tier B (the
            // template's own brand palette) automatically and silently if the
            // image call fails for any reason (no credentials, provider
            // error, budget cap). Never allowed to fail generate_content
            // itself or touch a single word of the deterministic text above.
            // One bounded retry (see runMarketingImageQuality, called with
            // failClosedOnInfraError: false below to preserve this exact
            // Tier A/Tier B behavior): a flyer with no photograph can
            // never meet the bright/colourful floral standard, so a
            // single transient provider failure is
            // worth one more attempt — asking for a DIFFERENT composition
            // rather than resending the identical prompt.
            const flyerBackgroundQuality = await runMarketingImageQuality({
              client,
              shopId,
              promptFor: (attempt) =>
                buildFlyerBackgroundPrompt({
                  visualBrief: copyGen.content.visual_brief,
                  creativeBrief: copyGen.content.creative_brief,
                  occasion: currentItem.data.title,
                  brandColor: shopRow.data?.primary_color || null,
                  groundedFlowers: groundedFlowerNames,
                  variationSeed: attempt
                }),
              filenameFor: (attempt) =>
                attempt === 0
                  ? `flyer-background-${body.content_item_id}.jpg`
                  : `flyer-background-${body.content_item_id}-retry${attempt}.jpg`,
              visualBrief: copyGen.content.visual_brief,
              creativeBrief: copyGen.content.creative_brief,
              occasion: currentItem.data.title,
              usage: { traceId: genTraceId, contentItemId: body.content_item_id },
              // Tier A/Tier B: falls back to the template's own brand
              // palette (Tier B) automatically and silently for ANY
              // failure reason (no credentials, provider error, budget
              // cap, or a storage error) — this decorative background is
              // never the whole point of the post the way a plain-image
              // post's photo is, so this call site keeps its pre-existing
              // "never fail generate_content over a background photo"
              // design exactly as it worked before this quality gate.
              buildFallback: async () => ({ ok: true, kind: "template", url: null }),
              failClosedOnInfraError: false
            });
            structuredLog("info", "marketing_generate_content_quality_check", {
              traceId: genTraceId,
              state: flyerBackgroundQuality.state,
              attempts: flyerBackgroundQuality.attempts.length,
              rejectedCount: flyerBackgroundQuality.rejectedAssetPaths.length
            });
            const backgroundGen = { ok: flyerBackgroundQuality.state === "PASS", url: flyerBackgroundQuality.gen?.url || null };
            // Computed once so canonical_concept and creative_direction
            // below share the exact same concept object, never two
            // independently-derived copies that could disagree.
            const flyerExactFactsConcept = buildConceptForAsset({
              assetType: "flyer",
              ctaText: flyerGen.content.cta,
              bodyText: flyerGen.content.body,
              photoStrategy: "calm_backdrop",
              styleTier: backgroundGen.ok ? "generated" : "template"
            });
            const persisted = await persistGeneratedAsset(client, {
              shopId,
              userId: user.id,
              persona: "Lily",
              assetType: "flyer",
              provider: "cloudflare",
              model: flyerGen.model,
              content: {
                ...flyerGen.content,
                template_id: template.id,
                aspect_ratio: aspectRatio,
                style_tier: backgroundGen.ok ? "generated" : "template",
                background_url: backgroundGen.ok ? backgroundGen.url : null,
                // Durable-render fields — never set at generation time. The
                // renderer is browser-only (canvas), so nothing has been
                // rendered or persisted yet; finalize_flyer_render is the
                // only thing that ever sets these, once a real file exists
                // in storage. approve_content refuses to approve a flyer
                // until render_status is "rendered" and every other field
                // here is real (see flyerApprovalBlockReason) — a
                // client-side render success alone is never enough.
                url: null,
                storage_path: null,
                mime: null,
                width: null,
                height: null,
                render_status: null,
                rendered_at: null,
                traits_used: [],
                style: defaultVisualStyle(),
                // The client-side renderer (public/flyer-renderer.js) draws
                // the actual canvas — it needs the full layout, not just an
                // id, so the server stays the single source of truth for
                // region placement rather than a second, drift-prone copy
                // of flyer-templates.js living in the browser bundle.
                regions: template.regions,
                palette: template.palette,
                canvas: ASPECT_RATIOS[aspectRatio],
                // The Facebook caption is a SEPARATE piece of text from the
                // on-image headline/body/cta above — same separation the
                // "image" asset type always used (content.caption vs. the
                // image itself). Requirement 5: the caption independently
                // carries the same real facts.
                caption: copyGen.content.body,
                // Ashley's explicit live-test feedback: "these flyers can
                // now be made in any color, it is not set to navy or dark
                // colors — this is a flower shop, it should [be] happiness."
                // The gradient band (drawGradientBand, below) was reading a
                // hardcoded navy regardless of shop — this is what actually
                // threads the shop's OWN real brand color through so the
                // band reflects it instead. Falls back to the shops table's
                // own DB default (a warm rose, never navy) when a shop
                // hasn't set one — see 20260804000000_greenfield_baseline.sql.
                brand: { shopName, phone: shopRow.data?.phone || null, primaryColor: shopRow.data?.primary_color || null, accentColor: shopRow.data?.accent_color || null, city: shopRow.data?.city || null, state: shopRow.data?.state || null },
                brand_traits_used: copyGen.content.brand_traits_used,
                visual_traits_used: copyGen.content.visual_traits_used,
                grounded_in_inventory: inventorySources,
                visual_brief: copyGen.content.visual_brief || null,
                // Structured art-director breakdown of the same concept as
                // visual_brief (see CREATIVE_BRIEF_SCHEMA in
                // ai-creative-engine.js) — persisted for the same reason
                // visual_brief itself is: a later revise_content call, or a
                // human debugging a flyer, has the real concrete brief to
                // reference instead of re-deriving it from prose.
                creative_brief: copyGen.content.creative_brief || null,
                // The real marketing objective this post was actually
                // written for (see SOCIAL_POST_OBJECTIVES in
                // ai-creative-engine.js) — persisted for observability and
                // a future "learn" loop; never invented if the model gave
                // nothing that matched the fixed enum.
                objective: concept.objective,
                // A flyer produced by this path is always the calm-backdrop
                // strategy now — subject-forward requests never reach this
                // branch at all, they take the plain "image" path below —
                // recorded anyway so the client poster renderer and any
                // pre-existing rows from the earlier "every post" period
                // still read back consistently.
                photo_strategy: "calm_backdrop",
                // Batch 4, Part B: the one persisted canonical concept this
                // flyer, its caption, and its image all actually share.
                canonical_concept: flyerExactFactsConcept,
                // Creative Direction Phase 1 ("schema + deterministic
                // constraints only" — see _shared/marketing-creative-
                // direction.js): a complete, valid deterministic Direction
                // object, persisted for observability and for Phase 2+ to
                // consume. Does NOT change what actually renders yet —
                // public/flyer-renderer.js does not read this field.
                creative_direction: buildDeterministicCreativeDirection({
                  canonicalConcept: flyerExactFactsConcept,
                  shopBrand: { logoUrl: shopRow.data?.logo_url || null }
                }),
                // Batch 2 (Part 3): this branch exists ONLY for requests
                // requestNeedsFlyerWording() already identified as needing
                // exact on-image wording (operational notices, exact
                // hours/dates/prices) — marketing-engine-router.js would
                // route these to "exact_layout" regardless, so no router
                // call is needed here; persisted directly for observability
                // and so the client/UI never has to guess which engine
                // rendered a given asset. Never "fallback" in user-facing
                // language (Part 13) — this branch IS Exact Layout, not a
                // degraded substitute for anything.
                creative_engine: "exact_layout"
              },
              mediaId: null,
              status: "completed"
            });
            if (!persisted.ok) {
              await revertToIdea();
              throw new Error(persisted.error);
            }
            assetId = persisted.asset.id;
            imageUrl = backgroundGen.ok ? backgroundGen.url : null;
            generatedAssetType = "flyer";
          } else {
            // Real product-direction change (Ashley's own explicit ChatGPT
            // reference, "this is what I want. Stop guessing and fix it."):
            // an ordinary decorative "today's post" request is ALSO a
            // fully designed, branded flyer now — the shop's own name, a
            // short body, and its real contact info drawn onto a real
            // bouquet photo via Florisyn's existing deterministic renderer
            // — never a bare, undesigned photograph. This reuses the exact
            // same flyer machinery the exact-facts branch above uses
            // (generateFlyerCopy, pickFlyerTemplate, persistGeneratedAsset
            // as assetType "flyer") — only the PHOTO strategy differs.
            //
            // The photo is SUBJECT-FORWARD (the actual bouquet/scene the
            // request describes) rather than the calm negative-space
            // backdrop the exact-facts branch uses — photo_strategy below
            // is what tells the client-side poster renderer that, so it
            // correctly excludes the one composition (editorial) built to
            // need calm space WITHIN the photo itself, rather than
            // confining the photo to its own frame the way the others do.
            // No separate inventory wiring needed for the photo prompt:
            // this call always supplies visualBrief (from copyGen, itself
            // already grounded in real inventory above), so
            // buildImagePrompt's own products fallback path never runs.
            //
            // The photo can come from a real upload, an AI generation, or —
            // Phase 2 rebuild's asset-routing gap — reusing one of this
            // shop's own recent real uploaded photos, per the florist's own
            // "ask me each time" answer — generate_content's photo_choice
            // short-circuit above is what actually asks; by the time
            // execution reaches here she's already answered, so
            // photo_choice is "upload", "generate", or "reuse". Flyer text
            // is generated FIRST (cheaper, one request) so a wording
            // failure never wastes an image spend.
            const flyerCopyResult = await generateFlyerCopy({ noticeFallback, brief: currentItem.data.brief, occasionTitle: currentItem.data.title, concept });
            if (!flyerCopyResult.ok) {
              await revertToIdea();
              return json(400, { error: flyerCopyResult.error });
            }
            const flyerGen = { model: flyerCopyResult.model, content: flyerCopyResult.content };

            let imageGen;
            let reusedFromAssetId = null;
            // Batch 2: hoisted so the persisted content object below (Part
            // 3) can record which engine actually produced this asset's
            // photo regardless of which photo_choice branch ran — a real
            // upload/reuse never invokes either image engine at all, so
            // both stay "exact_layout" (Florisyn's own deterministic path
            // handled the whole asset) unless the "generate" branch below
            // actually attempts and succeeds at Premium AI Creative.
            let creativeEngineUsed = "exact_layout";
            let premiumCreativeOverlays = null;
            // Batch 3 staging-acceptance fix ("STRICT EVIDENCE MODE — durable
            // runtime trace"): null for photo_choice upload/reuse (routing
            // never runs there — see the comment above this block), set
            // once the "generate" branch below actually computes a router
            // decision. Persisted onto the asset itself (never onto a log
            // line an account has already found impractical to retrieve)
            // so router->flag->environment->provider->reservation->
            // provider-call->fallback is readable from Supabase after the
            // fact, without erasing which engine actually rendered
            // (creative_engine stays the honest FINAL engine; this field
            // is the honest ATTEMPTED route).
            let premiumCreativeDiagnostic = null;
            userUploadedPhoto = body.photo_choice === "upload" || body.photo_choice === "reuse";
            if (body.photo_choice === "reuse") {
              if (typeof body.reuse_asset_id !== "string" || !body.reuse_asset_id) {
                await revertToIdea();
                return json(400, { error: "photo_choice was 'reuse' but no reuse_asset_id was provided." });
              }
              // Real tenant-isolation check: the candidate list offered to
              // the florist (the needs_photo_choice short-circuit above)
              // only ever lists THIS shop's own assets, but a caller could
              // still hand back any asset id — refetch and re-verify
              // shop_id here rather than trusting the id round-tripped from
              // the client at all.
              const sourceAsset = await client.from("ai_generated_assets").select("id,shop_id,content").eq("id", body.reuse_asset_id).eq("shop_id", shopId).maybeSingle();
              if (sourceAsset.error) throw sourceAsset.error;
              const sourcePhotoUrl = sourceAsset.data?.content?.background_url;
              // Reuse is only ever offered/honored for a REAL photo the
              // florist uploaded herself — never a prior AI generation —
              // so the disclosure math below (generativeImageUsed) stays
              // correct without any special-casing.
              if (!sourceAsset.data || sourceAsset.data.content?.user_uploaded_photo !== true || !sourcePhotoUrl) {
                await revertToIdea();
                return json(400, { error: "That photo isn't available to reuse anymore." });
              }
              reusedFromAssetId = sourceAsset.data.id;
              // No new website_media row and no new storage upload — this
              // is the exact same already-stored file, just referenced
              // again; imageGen.path stays null so the website_media
              // insert below is skipped entirely for this branch.
              imageGen = { ok: true, path: null, url: sourcePhotoUrl, mime: null, provider: "reused_upload", model: null, prompt: null };
            } else if (body.photo_choice === "upload") {
              if (typeof body.photo_data_url !== "string" || !body.photo_data_url) {
                await revertToIdea();
                return json(400, { error: "photo_choice was 'upload' but no photo_data_url was provided." });
              }
              const uploaded = await uploadWebsiteMedia(client, shopId, {
                dataUrl: body.photo_data_url,
                filename: body.photo_filename || `marketing-${body.content_item_id}.jpg`
              });
              if (!uploaded.ok) {
                await revertToIdea();
                return json(400, { error: uploaded.error });
              }
              imageGen = { ok: true, path: uploaded.path, url: publicWebsiteMediaUrl(client, uploaded.path), mime: uploaded.mime, provider: "user_upload", model: null, prompt: null };
            } else {
              const subjectVisualBrief = copyGen.content.visual_brief || currentItem.data.brief;
              const subjectCreativeBrief = copyGen.content.creative_brief;

              // Hybrid Marketing Studio Batch 2 ("staging-only OpenAI
              // routing"): a PURE routing decision (marketing-engine-
              // router.js, no AI classifier) using the exact same real
              // occasion/sympathy/promotion/fact-requirement signals this
              // asset's own persisted canonical concept will carry —
              // routing never depends on styleTier/photo source, so this
              // routing-only concept (built before the photo itself is
              // chosen) is accurate for that decision even though the
              // FINAL persisted concept below is built again afterward
              // with the real styleTier/userUploadedPhoto/reusedFromAssetId
              // once they're known.
              //
              // Conservative default, unchanged from Batch 1: this call
              // site does not yet derive a real "the promotion's own offer
              // facts are independently verified" signal from the live
              // pipeline, so a real promotion always fails closed to Exact
              // Layout for now (Ashley's own instruction: "unverified
              // promotional claim must not reach Premium AI Creative with
              // invented offer facts"). A future batch that adds real
              // offer-fact verification can flip this without touching
              // the router itself.
              const routingConcept = buildConceptForAsset({
                assetType: "flyer",
                ctaText: flyerGen.content.cta,
                bodyText: flyerGen.content.body,
                photoStrategy: "subject_forward",
                styleTier: "generated"
              });
              const engineRouteDecision = routeMarketingEngine({ canonicalConcept: routingConcept, verifiedOfferFactsPresent: false });

              // Batch 3 staging-acceptance fix, Part (observability gap
              // closed): logged UNCONDITIONALLY, for every request, cheap
              // and synchronous — this is the exact information a real
              // staging failure investigation needed and did not have:
              // before this, when the `if` below evaluated false, NOTHING
              // was ever logged distinguishing "the router itself chose
              // exact_layout" from "the router chose premium but the flag
              // read false" from "premium was attempted and failed" — all
              // three looked identical from the outside (a plain
              // exact_layout asset with zero OpenAI usage rows). This one
              // line makes the router's own real decision observable on
              // every request without changing any behavior.
              structuredLog("info", "marketing_generate_content_engine_route_decision", {
                traceId: genTraceId,
                engine: engineRouteDecision.engine,
                reason: engineRouteDecision.reason
              });

              // Batch 3 staging-acceptance fix ("STRICT EVIDENCE MODE"):
              // the durable diagnostic, initialized to the honest default
              // for a router decision that is NOT premium-eligible at all
              // — `fallback.reason` is overwritten below only as later
              // gates actually run; a request that never gets past this
              // point (router chose exact_layout on its own) persists
              // exactly that and nothing more, per Ashley's own example
              // ("do not collapse all failures into exact_layout").
              premiumCreativeDiagnostic = {
                version: 1,
                trace_id: genTraceId,
                router: { engine: engineRouteDecision.engine, reason: engineRouteDecision.reason },
                eligibility: { feature_flag_enabled: null },
                environment: { preview_guard_ok: null, preview_guard_errors: null },
                provider: { configured: null, selected: null, name: OPENAI_PROVIDER_NAME, model: null },
                usage: { reservation_attempted: false, reservation_id: null, reservation_status: null },
                execution: { provider_generate_entered: false, provider_http_status: null, provider_result_ok: null },
                orchestrator: { attempted: false, status: null, reason: null },
                fallback: { occurred: true, final_engine: "exact_layout", reason: PREMIUM_CREATIVE_REASON_CODES.ROUTER_EXACT_LAYOUT }
              };

              // Part 2: flag OFF → current behavior only. Checked ONLY
              // when the pure router already chose premium — an
              // operational/exact-facts/sympathy/unverified-promotion
              // concept never reaches this check at all, flag or no flag.
              // Extracted into its own variable (rather than inline in the
              // `if` below) SOLELY so its real value can be logged before
              // the branch decision is made — the short-circuit itself is
              // unchanged: this still only ever runs when the router
              // already chose premium_ai_creative, exactly as before.
              //
              // Independent-review fix: deliberately NO `{ client }` here,
              // unlike featureGate()'s own call a few hundred lines above
              // this handler. `client` at this point in the code is the
              // FLORIST path's own member-scoped, RLS-enforced session
              // client whenever deps.florist is set (the overwhelmingly
              // common real entry point to generate_content) —
              // shop_admin_config has no RLS grant for the authenticated
              // role at all (see shop-feature-access.js's own module doc),
              // so passing that client here would make this check silently
              // read false forever, regardless of the row's real value.
              // This is exactly the failure mode featureGate()'s own
              // adjacent comment already documents and works around by
              // skipping itself entirely on the florist path. Omitting
              // `client` lets isShopFeatureEnabled build its own real
              // service-role client instead (its own documented contract:
              // "Omit for production; this module creates its own
              // service-role client") — correct for both the florist path
              // and the admin path, since a fresh service-role client is
              // equivalent to the admin path's already-service-role client.
              const premiumRouterEligible = engineRouteDecision.engine === "premium_ai_creative";
              // Batch 4, Part K testability: `deps.isShopFeatureEnabled`
              // (default: the real import, identical to before) is the
              // ONLY thing this line changed for — production behavior is
              // byte-for-byte identical (createMarketingStudioHandler() with
              // no deps still calls the exact same real function, which
              // still builds its own real service-role client per the
              // comment above). This is what makes it possible to
              // integration-test the actual Premium-eligible async job
              // kickoff path through the real dispatch, rather than only
              // ever observing this flag as unreadable-therefore-false.
              const checkPremiumFeatureEnabled = deps.isShopFeatureEnabled || isShopFeatureEnabled;
              const premiumFeatureEnabled = premiumRouterEligible ? await checkPremiumFeatureEnabled(shopId, "marketing_openai_premium_creative") : false;
              // Diagnostic default above already covers "router chose
              // exact_layout on its own"; a router-eligible request
              // overwrites both fields honestly, whether or not the flag
              // turns out to be on — never left as the router-ineligible
              // default once the router itself said premium.
              if (premiumRouterEligible) {
                premiumCreativeDiagnostic.eligibility.feature_flag_enabled = premiumFeatureEnabled;
                if (!premiumFeatureEnabled) {
                  premiumCreativeDiagnostic.fallback = { occurred: true, final_engine: "exact_layout", reason: PREMIUM_CREATIVE_REASON_CODES.FEATURE_FLAG_DISABLED };
                }
                structuredLog("info", "marketing_generate_content_premium_eligibility", {
                  traceId: genTraceId,
                  premiumFeatureEnabled
                });
              }
              // Batch 4 ("async job architecture" — a real staging 504
              // proved a synchronous OpenAI image call cannot safely live
              // inside generate_content's own request/response cycle): this
              // branch never calls provider.generate() (nor even the
              // reserve+execute combo attemptPremiumCreativeGeneration())
              // directly anymore. It does the FAST part only — find/create
              // the durable job, reserve usage, hand off to the Background
              // Function — and returns immediately. The real network call
              // happens out of band in marketing-premium-creative-
              // background.js, which reuses the exact same orchestrator
              // (executeReservedPremiumCreativeGeneration) and the exact
              // same OpenAI provider adapter; nothing here duplicates that
              // logic.
              if (premiumRouterEligible && premiumFeatureEnabled) {
                premiumCreativeDiagnostic.orchestrator.attempted = true;
                const premiumCreativeDirection = buildDeterministicCreativeDirection({
                  canonicalConcept: routingConcept,
                  shopBrand: { logoUrl: shopRow.data?.logo_url || null }
                });
                const premiumFactSafeCopyPlan = {
                  headline: flyerGen.content.headline,
                  body: flyerGen.content.body,
                  cta: flyerGen.content.cta,
                  caption: copyGen.content.body
                };
                const premiumVerifiedShopBrandData = { name: shopName, phone: shopRow.data?.phone || null };
                const premiumAspectRatio = resolveOpenAiAspectRatio(ASPECT_RATIOS[pickAspectRatio(primaryPlatform)]);
                const premiumFilename = `marketing-premium-${body.content_item_id}.png`;
                const premiumFlyerAssetContext = {
                  on_image_headline: flyerGen.content.headline,
                  on_image_body: flyerGen.content.body,
                  on_image_cta: flyerGen.content.cta,
                  caption: copyGen.content.body,
                  hashtags: copyGen.content.hashtags || [],
                  brand_traits_used: copyGen.content.brand_traits_used || [],
                  visual_traits_used: copyGen.content.visual_traits_used || [],
                  grounded_in_inventory: inventorySources || [],
                  visual_brief: copyGen.content.visual_brief || null,
                  creative_brief: copyGen.content.creative_brief || null,
                  objective: concept.objective,
                  occasion_title: currentItem.data.title,
                  primary_platform: primaryPlatform
                };

                // Batch 4.1 ("close the premium job idempotency race"):
                // createOrContinuePremiumJob() is the ONE authoritative
                // create-or-get call — its correctness rests on a real
                // database unique index (ai_execution_jobs.idempotency_key),
                // not on this read winning a race against a concurrent
                // request's own read. The old separate
                // findActivePremiumJobForContentItem() pre-check proved
                // insufficient on its own (a real TOCTOU window: two
                // concurrent requests could both observe "no active job"
                // and both create one) — it's gone; the database conflict
                // is now the only thing that decides this.
                const jobResult = await createOrContinuePremiumJob(client, {
                  shopId,
                  userId: user.id,
                  contentItemId: body.content_item_id,
                  title: currentItem.data.title || "",
                  traceId: genTraceId
                });

                if (!jobResult.ok) {
                  // Part A: no durable job could even be created — fall
                  // through to the existing Exact Layout path exactly as a
                  // reservation failure always has, rather than risk a
                  // provider call with nowhere durable to record it.
                  structuredLog("warn", "marketing_generate_content_premium_job_create_failed", { traceId: genTraceId, error: jobResult.error });
                  premiumCreativeDiagnostic.fallback = { occurred: true, final_engine: "exact_layout", reason: "job_create_failed" };
                } else if (jobResult.mode === "active_duplicate" || jobResult.mode === "already_completed") {
                  // Part 3: some other request (concurrent, or this exact
                  // one already succeeded moments ago) already owns this
                  // content item's Premium job — never a second
                  // reservation, never a second Background Function
                  // dispatch. Return the SAME job's real status.
                  structuredLog("info", "marketing_generate_content_premium_creative_attempt", {
                    traceId: genTraceId,
                    ok: true,
                    state: jobResult.mode,
                    jobId: jobResult.job.id
                  });
                  premiumCreativeDiagnostic.orchestrator.status = PREMIUM_CREATIVE_STATES.RESERVED;
                  premiumCreativeDiagnostic.orchestrator.reason = PREMIUM_CREATIVE_REASON_CODES.PREMIUM_PENDING;
                  premiumCreativeDiagnostic.fallback = { occurred: false, final_engine: "premium_ai_creative", reason: null };
                  structuredLog("info", "marketing_generate_content_premium_creative_diagnostic", { traceId: genTraceId, diagnostic: premiumCreativeDiagnostic });
                  return json(200, {
                    premium_generation_pending: jobResult.mode !== "already_completed",
                    job_id: jobResult.job.id,
                    content_item_id: body.content_item_id,
                    status: "generating"
                  });
                } else if (jobResult.mode === "max_attempts_reached") {
                  // Part 6: this content item's Premium job already used
                  // every attempt PREMIUM_JOB_MAX_ATTEMPTS allows and every
                  // one failed — fall through to Exact Layout, never spend
                  // again on the same logical attempt.
                  structuredLog("info", "marketing_generate_content_premium_creative_attempt", { traceId: genTraceId, ok: false, state: "max_attempts_reached", jobId: jobResult.job.id });
                  premiumCreativeDiagnostic.fallback = { occurred: true, final_engine: "exact_layout", reason: "premium_job_max_attempts_reached" };
                } else {
                  // mode is "fresh" (a brand-new attempt-0 job) or
                  // "continue_failed" (this content item's existing job
                  // already failed at least once and has room left — an
                  // ordinary "Generate" click after the item reverted to
                  // 'idea' and an explicit Retry both converge on this
                  // exact same path, appending a new attempt to the SAME
                  // one job rather than ever creating a second job row).
                  const job = jobResult.job;
                  const attemptIndex = jobResult.attemptIndex;
                  const reserved = await reservePremiumCreativeGeneration({
                    client,
                    shopId,
                    contentItemId: body.content_item_id,
                    jobId: job.id,
                    canonicalConcept: routingConcept,
                    creativeDirection: premiumCreativeDirection,
                    factSafeCopyPlan: premiumFactSafeCopyPlan,
                    verifiedShopBrandData: premiumVerifiedShopBrandData,
                    aspectRatio: premiumAspectRatio,
                    traceId: genTraceId,
                    attemptIndex
                  });
                  structuredLog("info", "marketing_generate_content_premium_creative_attempt", {
                    traceId: genTraceId,
                    ok: reserved.ok,
                    state: reserved.state,
                    jobId: job.id,
                    attemptIndex,
                    alreadyExisted: Boolean(reserved.alreadyExisted)
                  });
                  // Merge in the orchestrator's OWN diagnostic verbatim —
                  // every one of these sub-objects was already computed,
                  // field by field, exactly where each real gate ran (see
                  // reservePremiumCreativeGeneration's own doc); never
                  // recomputed or re-derived here.
                  if (reserved.diagnostic) {
                    premiumCreativeDiagnostic.environment = reserved.diagnostic.environment;
                    premiumCreativeDiagnostic.provider = reserved.diagnostic.provider;
                    premiumCreativeDiagnostic.usage = reserved.diagnostic.usage;
                    premiumCreativeDiagnostic.execution = reserved.diagnostic.execution;
                    premiumCreativeDiagnostic.orchestrator = reserved.diagnostic.orchestrator;
                  }

                  if (!reserved.ok) {
                    // Part 9: on any non-success state, creativeEngineUsed
                    // stays "exact_layout" and execution falls through to
                    // the EXISTING Exact Layout path below, completely
                    // unchanged — an explicit, honest fallback, never a
                    // silent substitution presented as Premium Creative.
                    premiumCreativeDiagnostic.fallback = {
                      occurred: true,
                      final_engine: "exact_layout",
                      reason: reserved.diagnostic?.orchestrator?.reason || null
                    };
                    // Only settle the job failed for a genuinely FRESH job
                    // this request just created and could not reserve for
                    // — never settle a job we're merely CONTINUING (that
                    // job already has real history from a prior attempt;
                    // a reservation failure on this new attempt must not
                    // erase or override it).
                    if (jobResult.mode === "fresh") {
                      await settlePremiumJobFailed(client, job.id, { reason: reserved.diagnostic?.orchestrator?.reason || "reservation_failed" });
                    }
                  } else if (reserved.alreadyExisted) {
                    // Part 3 defense-in-depth: the reservation-level
                    // unique index itself caught a duplicate this
                    // request's own job-level check didn't (structurally
                    // shouldn't happen, but never assume) — a concurrent
                    // winner already owns this attempt's real reservation
                    // and (per its own request) will have already
                    // dispatched or is dispatching the Background
                    // Function; this request creates nothing further.
                    premiumCreativeDiagnostic.fallback = { occurred: false, final_engine: "premium_ai_creative", reason: null };
                    structuredLog("info", "marketing_generate_content_premium_creative_diagnostic", { traceId: genTraceId, diagnostic: premiumCreativeDiagnostic });
                    return json(200, {
                      premium_generation_pending: true,
                      job_id: reserved.jobId,
                      content_item_id: body.content_item_id,
                      status: "generating"
                    });
                  } else {
                    const attemptStep = buildPlannedAttemptStep({ attemptIndex, reservationId: reserved.reservation.usageId });
                    const addAttempt = await addPremiumJobAttempt(client, job.id, attemptStep, {
                      context: {
                        canonical_concept: routingConcept,
                        creative_direction: premiumCreativeDirection,
                        fact_safe_copy_plan: premiumFactSafeCopyPlan,
                        verified_shop_brand_data: premiumVerifiedShopBrandData,
                        aspect_ratio: premiumAspectRatio,
                        quality_tier: "medium",
                        filename: premiumFilename,
                        // Batch 4, Part D: everything the Background
                        // Function needs to persist the FINAL asset in the
                        // exact same shape the (now-bypassed) synchronous
                        // flyer-persistence path always produced — a
                        // separate process shares no memory with this
                        // request, so every generative output that can't
                        // be safely RE-derived (already-generated wording,
                        // already-evaluated traits/grounding) is captured
                        // here verbatim. Facts that ARE safe to re-derive
                        // (the shop's own current brand row, the flyer
                        // template for this occasion, the platform-based
                        // canvas size) are deliberately left OUT — the
                        // Background Function loads those fresh from
                        // Supabase itself (Part D: "load all authoritative
                        // state from Supabase") rather than trusting a
                        // possibly-stale copy from request time.
                        flyer_asset_context: premiumFlyerAssetContext
                      }
                    });
                    if (!addAttempt.ok) {
                      // A reservation exists but couldn't be durably
                      // attached to the job's plan — provider.generate()
                      // was never entered (Part F: RESERVED_NOT_STARTED),
                      // so it's safe to fail the reservation outright
                      // rather than leave it dangling at "estimated"
                      // forever the way the three historical rows did.
                      structuredLog("warn", "marketing_generate_content_premium_job_attach_failed", { traceId: genTraceId, error: addAttempt.error });
                      await failProviderCall(client, reserved.reservation.usageId, { error: "job_attempt_attach_failed" });
                      if (jobResult.mode === "fresh") {
                        await settlePremiumJobFailed(client, job.id, { reason: "job_attempt_attach_failed" });
                      }
                      premiumCreativeDiagnostic.fallback = { occurred: true, final_engine: "exact_layout", reason: "job_attempt_attach_failed" };
                    } else {
                      // Fire-and-forget: never lets an enqueue failure
                      // crash this request — the job row itself (status
                      // 'planned', a real attempt attached) is the durable
                      // source of truth; a future reconciliation pass (Part
                      // H) is what catches a job whose worker never fired.
                      const invoke = await invokePremiumCreativeBackgroundFunction({ jobId: job.id });
                      structuredLog("info", "marketing_generate_content_premium_job_dispatch", {
                        traceId: genTraceId,
                        jobId: job.id,
                        invoked: invoke.ok,
                        invokeError: invoke.ok ? null : invoke.error
                      });
                      premiumCreativeDiagnostic.fallback = { occurred: false, final_engine: "premium_ai_creative", reason: null };
                      structuredLog("info", "marketing_generate_content_premium_creative_diagnostic", { traceId: genTraceId, diagnostic: premiumCreativeDiagnostic });
                      // Part C: return HTTP success immediately — the real
                      // provider call has been handed off. Never a 504 just
                      // because the image is still being created.
                      return json(200, {
                        premium_generation_pending: true,
                        job_id: job.id,
                        content_item_id: body.content_item_id,
                        status: "generating"
                      });
                    }
                  }
                }
              }

              // Batch 2 rebuild: this exact path used to hand a florist a
              // photo with invented, garbled pseudo-branding painted into a
              // corner (buildImagePrompt's unconditional no-text directive
              // is a statistical nudge to a diffusion model, not a hard
              // constraint) — generateImageCheckingText's own vision-check
              // retry loop existed to catch that, but read
              // assessGeneratedMarketingPhoto's own `accepted` field, which
              // DEFAULTS TO TRUE whenever the vision call itself failed —
              // so a vision-provider outage, or a genuinely unreadable
              // reply, was silently treated as a pass, and a second
              // still-rejected candidate was returned anyway. This is now
              // the one authoritative Marketing image-quality state
              // machine (runMarketingImageQuality) instead: it reads
              // check.ok/check.readable directly, so a real inspection
              // failure can only ever resolve to a safe fallback or an
              // honest failure — never a pass. Every actual provider call
              // (each image attempt, each vision inspection) gets its own
              // usage-ledger row via the shared provider-usage service,
              // replacing the old single flat recordUsage("image") estimate.
              if (creativeEngineUsed !== "premium_ai_creative") {
                const quality = await runMarketingImageQuality({
                  client,
                  shopId,
                  promptFor: (attempt, prior) => {
                    const base = buildImagePrompt({ occasion: currentItem.data.title, shopName, visualBrief: subjectVisualBrief, creativeBrief: subjectCreativeBrief });
                    const priorReason = prior[prior.length - 1]?.check?.reason;
                    return attempt === 0 || !priorReason
                      ? base
                      : `${base} IMPORTANT — a prior attempt was rejected for this exact reason, do not repeat it: ${priorReason}`;
                  },
                  filenameFor: (attempt) => (attempt === 0 ? `marketing-${body.content_item_id}.jpg` : `marketing-${body.content_item_id}-retry${attempt}.jpg`),
                  creativeBrief: subjectCreativeBrief,
                  visualBrief: subjectVisualBrief,
                  occasion: currentItem.data.title,
                  usage: { traceId: genTraceId, contentItemId: body.content_item_id },
                  // Honest fallback for a general floral/awareness post with
                  // no safe generated photo: the SAME deterministic Tier B
                  // (template, no photo) this file's own flyer-background
                  // path already falls back to when its own image call fails
                  // outright — never an unsafe/rejected AI image just
                  // because nothing better was generated.
                  buildFallback: async () => ({ ok: true, kind: "deterministic", url: null })
                });
                structuredLog("info", "marketing_generate_content_quality_check", {
                  traceId: genTraceId,
                  state: quality.state,
                  attempts: quality.attempts.length,
                  rejectedCount: quality.rejectedAssetPaths.length
                });
                if (quality.state === "PASS") {
                  imageGen = {
                    ok: true,
                    path: quality.gen.path,
                    url: quality.gen.url,
                    mime: quality.gen.mime,
                    provider: quality.gen.provider,
                    model: quality.gen.model,
                    qualityCheck: quality.check,
                    styleTier: "generated"
                  };
                } else if (quality.state === "FALLBACK") {
                  imageGen = { ok: true, path: null, url: quality.fallback.url || null, mime: null, provider: "cloudflare", model: null, qualityCheck: null, styleTier: "template" };
                } else {
                  await revertToIdea();
                  // quality.error is only ever set when EVERY attempt failed
                  // for a genuine, non-retryable infrastructure reason (a
                  // storage/config failure — never a quality rejection) —
                  // surface the real error verbatim rather than the generic
                  // quality-check message, so an actionable bug (e.g. a
                  // storage RLS policy denying uploads) is visible instead of
                  // being reported the same way as an ordinary rejected photo.
                  return json(400, {
                    error: quality.error
                      ? `Couldn't save your photo: ${quality.error}`
                      : "The generated photo didn't pass Lily's quality check, and no safe fallback was available — nothing was saved. Try Generate again."
                  });
                }
              }
            }
            // A reused photo has no NEW file at all — it's the exact same
            // already-stored website_media row a prior post's upload
            // created, just referenced again — so imageGen.path is null and
            // this insert is skipped entirely rather than creating a
            // duplicate storage_path row (or crashing on a null .split()).
            const mediaRow = imageGen.path
              ? await client
                  .from("website_media")
                  .insert({
                    shop_id: shopId,
                    storage_path: imageGen.path,
                    filename: imageGen.path.split("/").pop(),
                    source: userUploadedPhoto ? "upload" : "generated",
                    mime: imageGen.mime || "image/jpeg"
                  })
                  .select()
                  .single()
              : { data: null };
            const template = pickFlyerTemplate({ occasion: currentItem.data.title });
            const aspectRatio = pickAspectRatio(primaryPlatform);
            // Computed once so canonical_concept and creative_direction
            // below share the exact same concept object, never two
            // independently-derived copies that could disagree.
            const flyerSubjectForwardConcept = buildConceptForAsset({
              assetType: "flyer",
              ctaText: flyerGen.content.cta,
              bodyText: flyerGen.content.body,
              photoStrategy: "subject_forward",
              styleTier: userUploadedPhoto ? "upload" : imageGen.styleTier || "generated",
              userUploadedPhoto,
              reusedFromAssetId
            });
            const persisted = await persistGeneratedAsset(client, {
              shopId,
              userId: user.id,
              persona: "Lily",
              assetType: "flyer",
              provider: "cloudflare",
              model: flyerGen.model,
              content: {
                ...flyerGen.content,
                template_id: template.id,
                aspect_ratio: aspectRatio,
                style_tier: userUploadedPhoto ? "upload" : imageGen.styleTier || "generated",
                background_url: imageGen.url,
                // Durable-render fields — never set at generation time, same
                // as the exact-facts flyer branch above. finalize_flyer_render
                // is the only thing that ever sets these.
                url: null,
                storage_path: null,
                mime: null,
                width: null,
                height: null,
                render_status: null,
                rendered_at: null,
                traits_used: [],
                style: defaultVisualStyle(),
                regions: template.regions,
                palette: template.palette,
                canvas: ASPECT_RATIOS[aspectRatio],
                // The Facebook caption is a SEPARATE piece of text from the
                // on-image headline/body/cta above — content.caption vs.
                // the image itself.
                caption: copyGen.content.body,
                brand: { shopName, phone: shopRow.data?.phone || null, primaryColor: shopRow.data?.primary_color || null, accentColor: shopRow.data?.accent_color || null, city: shopRow.data?.city || null, state: shopRow.data?.state || null },
                brand_traits_used: copyGen.content.brand_traits_used,
                visual_traits_used: copyGen.content.visual_traits_used,
                grounded_in_inventory: inventorySources,
                // visual_brief persisted so a later revise_content call has
                // something real to reference instead of the item's generic
                // brief text.
                visual_brief: copyGen.content.visual_brief || null,
                creative_brief: copyGen.content.creative_brief || null,
                // The real marketing objective this post was actually
                // written for (see SOCIAL_POST_OBJECTIVES in
                // ai-creative-engine.js) — persisted for observability and
                // a future "learn" loop; never invented if the model gave
                // nothing that matched the fixed enum.
                objective: concept.objective,
                // The quality-control gate's own verdict on this specific
                // photo (florist-ai-vision.js's assessGeneratedMarketingPhoto,
                // run inside runMarketingImageQuality above) — null for a
                // real uploaded photo, since the gate never runs on those.
                // Never blocks generation on its own (see that function's
                // docstring); persisted purely for observability/debugging.
                quality_check: imageGen.qualityCheck || null,
                photo_strategy: "subject_forward",
                // Real gap the photo-choice feature's own review closed:
                // a real uploaded photo must never be disclosed as a
                // generative image just because background_url is
                // non-null — read below alongside imageUrl.
                user_uploaded_photo: userUploadedPhoto,
                // Provenance for the asset-routing "reuse" choice — null
                // for a fresh upload or a fresh AI generation, the source
                // asset's own id when this photo is a reuse of one already
                // uploaded for an earlier post.
                reused_from_asset_id: reusedFromAssetId,
                // Batch 4, Part B/K: the one persisted canonical concept
                // this flyer, its caption, and its image all actually
                // share — assetRoute derives from the exact same real
                // photo-choice signals (userUploadedPhoto/reusedFromAssetId/
                // styleTier) already computed above for this branch.
                canonical_concept: flyerSubjectForwardConcept,
                // Creative Direction Phase 1 (schema + deterministic
                // constraints only) — see the exact-facts flyer branch
                // above for the full explanation; identical wiring here.
                creative_direction: buildDeterministicCreativeDirection({
                  canonicalConcept: flyerSubjectForwardConcept,
                  shopBrand: { logoUrl: shopRow.data?.logo_url || null }
                }),
                // Batch 2 (Part 3/7): which engine actually produced this
                // asset's photo — "exact_layout" for a real upload/reuse or
                // whenever Premium AI Creative wasn't used/available;
                // "premium_ai_creative" only when attemptPremiumCreative
                // Generation() above actually succeeded. Never surfaced to
                // the florist as raw provider/engine terminology (Part 13)
                // — this is observability/debugging data on the asset
                // record, not UI copy.
                creative_engine: creativeEngineUsed,
                // Fact-critical text reserved for Florisyn's own
                // deterministic overlay (Part 8) — null whenever Exact
                // Layout rendered the whole asset itself, since Exact
                // Layout already draws 100% of the on-image text and has
                // no separate "overlay onto a generated background" step.
                premium_creative_overlays: premiumCreativeOverlays,
                // Batch 3 staging-acceptance fix ("STRICT EVIDENCE MODE —
                // durable runtime trace"): the honest ATTEMPTED route,
                // separate from creative_engine (the honest FINAL engine)
                // above — router decision, feature-flag value, preview
                // guard result, provider configured/selected, usage-
                // ledger reservation, the real provider call, and exactly
                // why any fallback to Exact Layout occurred, all read back
                // from Supabase after the fact instead of requiring
                // Netlify function-log access this account has already
                // found impractical to retrieve. Null only for a real
                // upload/reuse photo, where routing never runs at all (see
                // this field's own initialization above). No secret is
                // ever persisted here — see this field's own construction
                // above and premium-creative-orchestrator.js's diagnostic
                // contract.
                premium_creative_diagnostic: premiumCreativeDiagnostic
              },
              mediaId: mediaRow.data?.id || null,
              status: "completed"
            });
            if (!persisted.ok) {
              await revertToIdea();
              throw new Error(persisted.error);
            }
            assetId = persisted.asset.id;
            imageUrl = imageGen.url;
            generatedAssetType = "flyer";
          }
        } else {
          // text_post: no image, but the copy itself (and whichever Brand
          // Brain traits shaped it) still needs a real row to be readable
          // back at approval time — previously nothing was persisted here
          // at all, so a text_post's variants had no backing asset and a
          // florist's approval of one could never reinforce Brand Brain.
          const persisted = await persistGeneratedAsset(client, {
            shopId,
            userId: user.id,
            persona: "Lily",
            assetType: "social_copy",
            provider: "cloudflare",
            model: copyGen.model,
            content: {
              headline: copyGen.content.headline,
              body: copyGen.content.body,
              cta: copyGen.content.cta,
              hashtags: copyGen.content.hashtags,
              brand_traits_used: copyGen.content.brand_traits_used,
              visual_traits_used: copyGen.content.visual_traits_used,
              grounded_in_inventory: inventorySources,
              objective: concept.objective,
              // Batch 4, Part B: text_post has no image/flyer sibling, but
              // still gets the same persisted canonical concept — a later
              // "make it shorter" revision, or an explicit "turn this into
              // a sympathy post" change, needs the same real contract to
              // inherit from as every other asset type.
              canonical_concept: buildConceptForAsset({
                assetType: "social_copy",
                ctaText: copyGen.content.cta,
                bodyText: copyGen.content.body
              })
            },
            status: "completed"
          });
          if (!persisted.ok) {
            await revertToIdea();
            throw new Error(persisted.error);
          }
          assetId = persisted.asset.id;
          generatedAssetType = "social_copy";
        }

        if (variants.length) {
          // Launch-blocker fix (Blocker 1): same as the video-concept
          // branch above — compute+persist disclosure fields per-platform
          // the moment content attaches. generativeImageUsed only reflects
          // a real AI-rendered image — a flyer's Tier-B template background
          // is NOT a generative image (it's Florisyn's own deterministic
          // render, so imageUrl is already null for it), and a plain
          // "image" post's REAL uploaded photo isn't one either even
          // though imageUrl is non-null for it — userUploadedPhoto is what
          // tells those two non-generative cases apart.
          const generativeImageUsed = Boolean(imageUrl) && !userUploadedPhoto;
          for (const v of variants) {
            await client
              .from("marketing_platform_variants")
              .update({
                asset_id: assetId,
                caption: copyGen.content.body,
                hashtags: copyGen.content.hashtags || [],
                ...computeDisclosureFields({
                  platform: v.platform,
                  generativeImageUsed,
                  aiContentType: generativeImageUsed ? "generative_image" : "none"
                })
              })
              .eq("id", v.id)
              .eq("shop_id", shopId);
          }
        }

        const updated = await client
          .from("marketing_content_items")
          .update({ status: "draft", updated_at: new Date().toISOString() })
          .eq("id", body.content_item_id)
          .eq("shop_id", shopId)
          .select("id,status")
          .single();
        if (updated.error) throw updated.error;
        await writeCommandAudit(client, user.id, "marketing_content_generated", {
          shopId,
          targetType: "marketing_content_items",
          targetId: body.content_item_id,
          assetType: generatedAssetType
        });
        // PERSIST/complete stage — the trace's final event for a
        // successful generation.
        structuredLog("info", "marketing_generate_content_complete", {
          traceId: genTraceId,
          assetId,
          assetType: generatedAssetType,
          objective: copyGen.content?.objective || null
        });
        return json(200, { item: updated.data, asset: assetId ? { id: assetId, type: generatedAssetType, url: imageUrl } : null, copy: copyGen.content });
      }

      // Batch 4, Part I: the narrow poll endpoint the UI hits every 2-3s
      // after generate_content returns premium_generation_pending — reads
      // ONLY already-durably-persisted job state (never triggers any
      // provider work itself), scoped to this shop the same way every
      // other read here is (RLS via the florist's own session client, plus
      // an explicit shop_id match as defense in depth).
      if (action === "premium_job_status") {
        const shopId = requireShopId(qs, body);
        const jobId = qs.job_id || body.job_id;
        if (!jobId) return json(400, { error: "job_id is required." });
        const jobRow = await client.from("ai_execution_jobs").select("*").eq("id", jobId).eq("shop_id", shopId).maybeSingle();
        if (jobRow.error) throw jobRow.error;
        if (!jobRow.data) return json(404, { error: "Premium generation job not found." });
        const job = jobRow.data;
        const terminal = job.status === "completed" || job.status === "failed";
        return json(200, {
          job_id: job.id,
          status: job.status,
          terminal,
          content_item_id: job.result?.content_item_id || null,
          asset_id: terminal ? job.result?.asset_id || null : null,
          background_image_url: terminal ? job.result?.background_image_url || null : null,
          error: job.status === "failed" ? job.error || "Lily's Premium design couldn't be created this time." : null
        });
      }

      // Batch 4, Part J: an EXPLICIT user Retry after a known failed
      // Premium job — never automatic. Appends a NEW attempt onto the SAME
      // job (never overwrites attempt-0's history), creates exactly one
      // new usage reservation, and re-dispatches the Background Function.
      // Requires the content item to actually be in the honest 'failed'
      // state the background function itself sets on a real provider
      // failure — never retryable from 'generating' (still in flight) or
      // any already-succeeded state.
      if (action === "retry_premium_generation" && method === "POST") {
        const shopId = requireShopId(qs, body);
        if (!body.content_item_id) return json(400, { error: "content_item_id is required." });

        const currentItem = await client
          .from("marketing_content_items")
          .select("id,title,status")
          .eq("id", body.content_item_id)
          .eq("shop_id", shopId)
          .maybeSingle();
        if (currentItem.error) throw currentItem.error;
        if (!currentItem.data) return json(404, { error: "Content item not found." });
        if (currentItem.data.status !== "failed") {
          return json(400, { error: "Only a failed Premium generation can be retried." });
        }

        const activeJobLookup = await findActivePremiumJobForContentItem(client, { shopId, contentItemId: body.content_item_id });
        if (activeJobLookup.ok && activeJobLookup.job) {
          return json(409, { error: "A Premium generation is already in progress for this item.", job_id: activeJobLookup.job.id, already_generating: true });
        }

        const latestJobLookup = await findLatestPremiumJobForContentItem(client, { shopId, contentItemId: body.content_item_id });
        if (!latestJobLookup.ok) throw new Error(latestJobLookup.error);
        const priorJob = latestJobLookup.job;
        if (!priorJob || priorJob.status !== "failed") {
          return json(404, { error: "No failed Premium generation was found to retry." });
        }
        const priorPlan = Array.isArray(priorJob.plan) ? priorJob.plan : [];
        const nextAttemptIndex = priorPlan.length;
        if (nextAttemptIndex >= PREMIUM_JOB_MAX_ATTEMPTS) {
          return json(400, { error: "This item has already reached its Premium generation retry limit. Start a fresh post to try again." });
        }

        // Re-claim the content item back to 'generating' (same atomic
        // pattern as the original request — see generate_content's own
        // claim above) so a second concurrent Retry click can't both win.
        const reclaim = await client
          .from("marketing_content_items")
          .update({ status: "generating", updated_at: new Date().toISOString() })
          .eq("id", body.content_item_id)
          .eq("shop_id", shopId)
          .eq("status", "failed")
          .select("id,status");
        if (reclaim.error) throw reclaim.error;
        if (!reclaim.data || reclaim.data.length !== 1) {
          return json(409, { error: "This item is already being retried by another request." });
        }
        async function revertRetryToFailed() {
          await client
            .from("marketing_content_items")
            .update({ status: "failed", updated_at: new Date().toISOString() })
            .eq("id", body.content_item_id)
            .eq("shop_id", shopId);
        }

        const context = priorJob.result || {};
        const reserved = await reservePremiumCreativeGeneration({
          client,
          shopId,
          contentItemId: body.content_item_id,
          jobId: priorJob.id,
          canonicalConcept: context.canonical_concept,
          creativeDirection: context.creative_direction,
          factSafeCopyPlan: context.fact_safe_copy_plan || {},
          verifiedShopBrandData: context.verified_shop_brand_data || {},
          aspectRatio: context.aspect_ratio || "1:1",
          qualityTier: context.quality_tier || "medium",
          traceId: context.trace_id || null,
          attemptIndex: nextAttemptIndex
        });
        if (!reserved.ok) {
          await revertRetryToFailed();
          return json(502, { error: reserved.reason || "Couldn't start a new Premium generation attempt.", diagnostic: reserved.diagnostic });
        }

        const attemptStep = buildPlannedAttemptStep({ attemptIndex: nextAttemptIndex, reservationId: reserved.reservation.usageId });
        const addAttempt = await addPremiumJobAttempt(client, priorJob.id, attemptStep, {});
        if (!addAttempt.ok) {
          await failProviderCall(client, reserved.reservation.usageId, { error: "job_attempt_attach_failed" });
          await revertRetryToFailed();
          return json(502, { error: "Couldn't start a new Premium generation attempt." });
        }

        const invoke = await invokePremiumCreativeBackgroundFunction({ jobId: priorJob.id });
        structuredLog("info", "marketing_retry_premium_generation_dispatch", {
          shopId,
          contentItemId: body.content_item_id,
          jobId: priorJob.id,
          attemptIndex: nextAttemptIndex,
          invoked: invoke.ok
        });
        return json(200, {
          premium_generation_pending: true,
          job_id: priorJob.id,
          content_item_id: body.content_item_id,
          status: "generating"
        });
      }

      // Priority 7 ("finish everything that can safely be completed
      // without Ashley" pass): the video-render CONTRACT layer
      // (marketing-video-render-engine.js's planVideoRender) was real and
      // tested but genuinely unreachable from the actual API surface —
      // nothing ever called it. This makes it real end to end: given a
      // content item whose generate_content already produced a real
      // video_concept (script/storyboard/captions), and real source
      // image/video URLs the admin supplies, builds the complete,
      // structured technical render plan and persists it onto that same
      // asset — never fabricates a rendered video, never invents a new
      // asset_type (content stays JSON on the existing video_concept row,
      // so no schema migration is needed for this).
      if (action === "plan_video_render" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.content_item_id) return json(400, { error: "content_item_id is required." });
        const hasImages = Array.isArray(body.source_image_urls) && body.source_image_urls.filter(Boolean).length > 0;
        if (!hasImages && !body.source_video_url) {
          return json(400, { error: "Provide source_image_urls (real, public image URLs) or source_video_url." });
        }

        const variantsResult = await client.from("marketing_platform_variants").select("id,asset_id").eq("content_item_id", body.content_item_id).eq("shop_id", shopId);
        if (variantsResult.error) {
          if (missingRelation(variantsResult.error)) throw friendlyMissing();
          throw variantsResult.error;
        }
        const withAsset = (variantsResult.data || []).find((v) => v.asset_id);
        if (!withAsset) {
          return json(400, { error: "This content item has no generated video concept yet — run generate_content first." });
        }

        const assetResult = await client.from("ai_generated_assets").select("id,asset_type,content,status").eq("id", withAsset.asset_id).eq("shop_id", shopId).maybeSingle();
        if (assetResult.error) throw assetResult.error;
        if (!assetResult.data) return json(400, { error: "The linked video concept asset could not be found." });
        if (assetResult.data.asset_type !== "video_concept") {
          return json(400, { error: `Expected a video_concept asset, found "${assetResult.data.asset_type}".` });
        }
        if (assetResult.data.status === "quarantined") {
          return json(400, { error: "This asset is quarantined (consent was revoked) and cannot be planned for rendering." });
        }

        const existingContent = assetResult.data.content || {};
        const plan = planVideoRender({
          sourceImageUrls: body.source_image_urls,
          sourceVideoUrl: body.source_video_url || null,
          backgroundUrl: body.background_url || null,
          motion: body.motion,
          transitions: body.transitions,
          textOverlays: body.text_overlays,
          captions: existingContent.script || (Array.isArray(existingContent.captions) ? existingContent.captions.join(" ") : existingContent.captions) || null,
          logoOverlayUrl: body.logo_overlay_url || null,
          audioReference: body.audio_reference || null,
          durationSeconds: body.duration_seconds || existingContent.suggested_length_seconds,
          aspectRatio: body.aspect_ratio,
          resolutionTier: body.resolution_tier
        });
        if (!plan.ok) return json(400, { error: plan.error });

        const nextContent = { ...existingContent, renderPlan: plan.plan };
        const updated = await client.from("ai_generated_assets").update({ content: nextContent }).eq("id", assetResult.data.id).eq("shop_id", shopId).select("id,content").single();
        if (updated.error) throw updated.error;

        await writeCommandAudit(client, user.id, "marketing_video_render_planned", {
          shopId,
          targetType: "ai_generated_assets",
          targetId: assetResult.data.id
        });

        return json(200, {
          asset_id: assetResult.data.id,
          plan: plan.plan,
          note: "NOT LIVE — PROVIDER CONNECTION REQUIRED. This is the complete, real technical render plan (timed shot list, motion, transitions, captions, aspect ratio) — no video-rendering provider is connected yet, so no video is actually produced. Connect a provider to encode it."
        });
      }

      // AI Clone (Digital Twin Studio) — Section 10/11. Consent is always
      // captured for real and is independently revocable. Actual avatar/
      // voice profile creation goes through the same provider router as
      // everything else in Stages B/D — today that router has no
      // configured provider, so every enrollment attempt honestly comes
      // back not_live. No fake 'ready'/'training' profile is ever created.
      // Convenience upload used only by the AI Clone enrollment form: HeyGen's
      // Photo Avatar Group API requires real, publicly-fetchable photo URLs
      // (not uploaded blobs), so the admin console uploads each reference
      // photo here first and passes the returned URL into
      // request_clone_enrollment's reference_photo_urls. Reuses the same
      // public website-media bucket as Website Studio images — this is not
      // a Website Studio asset and never appears in that library.
      if (action === "upload_clone_reference_photo" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.data_url) return json(400, { error: "data_url is required." });
        const uploaded = await uploadWebsiteMedia(client, shopId, { dataUrl: body.data_url, filename: body.filename });
        if (!uploaded.ok) return json(400, { error: uploaded.error });
        return json(200, { url: publicWebsiteMediaUrl(client, uploaded.path) });
      }

      if (action === "request_clone_enrollment" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const validation = validateCloneConsentBody(body);
        if (!validation.valid) return json(400, { error: validation.error });

        const cloneRegistry = buildConfiguredCloneProviderRegistry({ env: process.env });
        const provider = selectCloneProvider({}, cloneRegistry);
        const providerIsLive = provider !== notLiveCloneProvider;

        // Reference media is required to enroll for real (HeyGen needs
        // real photo URLs, ElevenLabs needs real recorded audio) — check
        // this BEFORE writing the consent row so a request that can't
        // possibly succeed never creates a half-finished consent grant.
        if (providerIsLive && validation.sanitized.avatar_permission) {
          if (!Array.isArray(body.reference_photo_urls) || body.reference_photo_urls.length === 0) {
            return json(400, { error: "avatar_permission requires reference_photo_urls (at least one real, publicly-fetchable photo URL of the consented person)." });
          }
        }
        if (providerIsLive && validation.sanitized.voice_permission) {
          if (!Array.isArray(body.reference_audio_samples) || body.reference_audio_samples.length === 0) {
            return json(400, { error: "voice_permission requires reference_audio_samples (at least one real recorded audio sample of the consented person, as a data URL)." });
          }
        }

        const consent = await client
          .from("marketing_clone_consent")
          .insert({
            shop_id: shopId,
            person_name: validation.sanitized.person_name,
            avatar_permission: validation.sanitized.avatar_permission,
            voice_permission: validation.sanitized.voice_permission,
            approved_usage: validation.sanitized.approved_usage,
            approved_platforms: validation.sanitized.approved_platforms,
            granted_by: user.id
          })
          .select("id,person_name,avatar_permission,voice_permission,approved_usage,approved_platforms,granted_at")
          .single();
        if (consent.error) {
          if (missingRelation(consent.error)) throw friendlyMissing();
          throw consent.error;
        }

        const enrollment = {};
        if (validation.sanitized.avatar_permission) {
          try {
            const result = await provider.createAvatarProfile({
              personName: validation.sanitized.person_name,
              referencePhotoUrls: body.reference_photo_urls
            });
            if (providerIsLive) {
              const profileRow = await client
                .from("marketing_avatar_profiles")
                .insert({
                  shop_id: shopId,
                  consent_id: consent.data.id,
                  provider: result.provider || provider.name,
                  provider_profile_id: result.providerProfileId,
                  status: result.status || "training",
                  display_name: validation.sanitized.person_name,
                  created_by: user.id
                })
                .select("id,status,provider_profile_id")
                .single();
              enrollment.avatar = profileRow.error ? { status: "error", error: profileRow.error.message } : { status: profileRow.data.status, profile_id: profileRow.data.id };
            } else {
              enrollment.avatar = { status: "ready" };
            }
          } catch (error) {
            enrollment.avatar = { status: "not_live", error: error.message };
          }
        }
        if (validation.sanitized.voice_permission) {
          try {
            let audioFiles;
            if (providerIsLive) {
              audioFiles = body.reference_audio_samples.map((sample, i) => {
                const parsed = parseDataUrl(sample?.data_url);
                if (!parsed) throw new Error(`reference_audio_samples[${i}] is not a valid data URL.`);
                return { blob: new Blob([parsed.buffer], { type: parsed.mime }), filename: sample.filename || `sample-${i}.mp3` };
              });
            }
            const result = await provider.createVoiceProfile({
              personName: validation.sanitized.person_name,
              referenceAudioFiles: audioFiles,
              description: `Florisyn AI Clone voice for ${validation.sanitized.person_name}`
            });
            if (providerIsLive) {
              const profileRow = await client
                .from("marketing_voice_profiles")
                .insert({
                  shop_id: shopId,
                  consent_id: consent.data.id,
                  provider: result.provider || provider.name,
                  provider_profile_id: result.providerProfileId,
                  status: result.status || "ready",
                  display_name: validation.sanitized.person_name,
                  created_by: user.id
                })
                .select("id,status,provider_profile_id")
                .single();
              enrollment.voice = profileRow.error ? { status: "error", error: profileRow.error.message } : { status: profileRow.data.status, profile_id: profileRow.data.id };
            } else {
              enrollment.voice = { status: "ready" };
            }
          } catch (error) {
            enrollment.voice = { status: "not_live", error: error.message };
          }
        }

        await writeCommandAudit(client, user.id, "marketing_clone_consent_granted", {
          shopId,
          targetType: "marketing_clone_consent",
          targetId: consent.data.id,
          providerLive: providerIsLive
        });

        return json(201, {
          consent: consent.data,
          enrollment,
          note: providerIsLive
            ? undefined
            : "NOT LIVE — PROVIDER CONNECTION REQUIRED. Consent is recorded and independently revocable, but no avatar/voice provider is connected yet — nothing was trained."
        });
      }

      // Real-time sanity check before committing to a full enrollment —
      // synthesizes a short line with an already-cloned ElevenLabs voice
      // (and, if avatarProfileId is given, a short HeyGen preview video)
      // so Ashley can hear/see the clone before approving it for real
      // campaign use. Requires the voice/avatar profile to already exist
      // (i.e. request_clone_enrollment has already run for real).
      if (action === "preview_clone_profile" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.voice_profile_id && !body.avatar_profile_id) {
          return json(400, { error: "voice_profile_id or avatar_profile_id is required." });
        }
        if (!body.script) return json(400, { error: "script is required." });

        const cloneRegistry = buildConfiguredCloneProviderRegistry({
          env: process.env,
          uploadAudio: (buffer, filename) => uploadClonedVoiceAudio(client, shopId, buffer, filename)
        });
        const provider = selectCloneProvider({}, cloneRegistry);
        if (provider === notLiveCloneProvider) {
          return json(200, { note: "NOT LIVE — PROVIDER CONNECTION REQUIRED. No avatar/voice provider is connected yet." });
        }

        try {
          const result = await provider.preview({
            voiceProfileId: body.voice_profile_id,
            avatarProfileId: body.avatar_profile_id,
            script: body.script
          });
          if (result.audioBuffer) {
            return json(200, { kind: "audio", audioBase64: result.audioBuffer.toString("base64"), mime: result.mime });
          }
          // Job correlation: persist the mapping from HeyGen's own job id
          // back to this shop BEFORE returning, so heygen-webhook.js has
          // something real to correlate against once HeyGen calls back —
          // without this row the webhook would have no way to know which
          // shop a bare video_id belongs to. A failure here never turns an
          // otherwise-successful render kickoff into a false error — the
          // caller still gets a real jobId and can fall back to polling
          // (clone_job_status) exactly as before this pass.
          try {
            await recordCloneVideoJob(client, {
              shopId,
              provider: result.provider || "heygen",
              providerJobId: result.jobId,
              source: "preview"
            });
          } catch (correlationError) {
            console.warn(JSON.stringify({ level: "warn", fn: "marketing-studio", message: "clone_video_job_record_failed", reason: String(correlationError?.message || correlationError) }));
          }
          return json(200, { kind: "video", jobId: result.jobId, status: result.status });
        } catch (error) {
          return json(502, { error: error.message });
        }
      }

      // Polls a HeyGen video-render job started by generateVideo/preview's
      // video path. Voice-only previews never produce a jobId (synthesis is
      // synchronous), so this only ever matters for the avatar-video path.
      //
      // Checks the webhook-updated persisted job row FIRST: if
      // heygen-webhook.js already correlated a completion/failure event for
      // this job, that's returned directly — cheaper and faster than a live
      // HeyGen call, and it means a client polling right after the webhook
      // fires sees the result immediately rather than racing HeyGen's own
      // eventual-consistency window. If no persisted row exists, or it's
      // still 'rendering' (no webhook has landed yet), this falls straight
      // through to the exact same live-poll behavior as before this pass —
      // the polling fallback is fully preserved, not replaced.
      if (action === "clone_job_status") {
        const shopId = requireShopId(qs, body);
        const jobId = qs.job_id || body.job_id;
        if (!jobId) return json(400, { error: "job_id is required." });

        try {
          const persisted = await getCloneVideoJob(client, { provider: "heygen", providerJobId: jobId });
          if (persisted && persisted.shop_id === shopId && persisted.status !== "rendering") {
            // Revoked-media hardening (Section 8): a quarantined job's
            // render genuinely finished at the provider, but that output is
            // not a usable Florisyn asset — the URL is never handed back
            // through this poll response, matching the fact that no
            // ai_generated_assets row exists for it either.
            const quarantined = persisted.disposition === "quarantined";
            return json(200, {
              status: persisted.status,
              terminal: true,
              resultUrl: quarantined ? null : persisted.result_url,
              error: persisted.error_message,
              quarantined,
              source: "webhook"
            });
          }
        } catch (persistedLookupError) {
          console.warn(JSON.stringify({ level: "warn", fn: "marketing-studio", message: "clone_video_job_lookup_failed", reason: String(persistedLookupError?.message || persistedLookupError) }));
        }

        const cloneRegistry = buildConfiguredCloneProviderRegistry({
          env: process.env,
          uploadAudio: (buffer, filename) => uploadClonedVoiceAudio(client, shopId, buffer, filename)
        });
        const provider = selectCloneProvider({}, cloneRegistry);
        if (provider === notLiveCloneProvider) {
          return json(200, { note: "NOT LIVE — PROVIDER CONNECTION REQUIRED. No avatar/voice provider is connected yet." });
        }
        try {
          const result = await provider.getJobStatus(jobId);
          // Convergence point (Section 7): a live poll discovering
          // completion runs through the EXACT SAME idempotent
          // finalization path a webhook delivery does — never a second,
          // independently-maintained "poll completion" code path that
          // could drift. If a webhook already finalized this job in the
          // window between the persisted-row check above and this poll
          // landing, finalizeDigitalTwinJob's underlying
          // applyWebhookStatusUpdate sees alreadyTerminal:true and safely
          // no-ops — no duplicate asset, no double-counted cost.
          if (result.terminal) {
            const finalized = await finalizeDigitalTwinJob(client, {
              provider: "heygen",
              providerJobId: jobId,
              status: result.status,
              resultUrl: result.resultUrl,
              error: result.error
            });
            // Same rule as the webhook-cached branch above: quarantined
            // output never carries its resultUrl back to the caller, even
            // though the raw provider poll (`result`) genuinely has one.
            return json(200, {
              ...result,
              resultUrl: finalized.quarantined ? null : result.resultUrl,
              source: "poll",
              assetCreated: finalized.assetCreated,
              assetId: finalized.asset?.id || null,
              quarantined: Boolean(finalized.quarantined)
            });
          }
          return json(200, { ...result, source: "poll" });
        } catch (error) {
          return json(502, { error: error.message });
        }
      }

      // Records AI-content provenance/disclosure metadata on a platform
      // variant — the write side of the disclosure gate run_publishing_queue
      // enforces below. Recomputes ai_disclosure_required from the variant's
      // actual platform + the provenance flags given here (never trusts a
      // caller-supplied ai_disclosure_required directly) so the requirement
      // can never silently drift from PLATFORM_DISCLOSURE_POLICY.
      if (action === "set_content_disclosure" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.platform_variant_id) return json(400, { error: "platform_variant_id is required." });

        const variantResult = await client
          .from("marketing_platform_variants")
          .select("id,platform")
          .eq("id", body.platform_variant_id)
          .eq("shop_id", shopId)
          .maybeSingle();
        if (variantResult.error) {
          if (missingRelation(variantResult.error)) throw friendlyMissing();
          throw variantResult.error;
        }
        if (!variantResult.data) return json(404, { error: "Platform variant not found." });

        const avatarUsed = Boolean(body.avatar_used);
        const voiceUsed = Boolean(body.voice_used);
        const generativeVideoUsed = Boolean(body.generative_video_used);
        const generativeImageUsed = Boolean(body.generative_image_used);
        const humanEdited = Boolean(body.human_edited);

        const determination = determineDisclosureRequirement({
          platform: variantResult.data.platform,
          avatarUsed,
          voiceUsed,
          generativeVideoUsed,
          generativeImageUsed,
          humanEdited
        });

        const updated = await client
          .from("marketing_platform_variants")
          .update({
            ai_content_type: body.ai_content_type || null,
            avatar_used: avatarUsed,
            voice_used: voiceUsed,
            generative_video_used: generativeVideoUsed,
            generative_image_used: generativeImageUsed,
            human_edited: humanEdited,
            ai_disclosure_required: determination.required,
            disclosure_method: determination.mechanism,
            disclosure_applied: Boolean(body.disclosure_applied),
            disclosure_policy_version: determination.policyVersion,
            disclosure_checked_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("id", body.platform_variant_id)
          .eq("shop_id", shopId)
          .select("id,platform,ai_disclosure_required,disclosure_method,disclosure_applied,disclosure_policy_version")
          .single();
        if (updated.error) throw updated.error;

        await writeCommandAudit(client, user.id, "marketing_content_disclosure_set", {
          shopId,
          targetType: "marketing_platform_variants",
          targetId: body.platform_variant_id
        });

        return json(200, { variant: updated.data, determination });
      }

      if (action === "list_clone_consent") {
        const shopId = requireShopId(qs, body);
        const { data, error } = await client
          .from("marketing_clone_consent")
          .select("id,person_name,avatar_permission,voice_permission,approved_usage,approved_platforms,granted_at,revoked_at")
          .eq("shop_id", shopId)
          .order("granted_at", { ascending: false });
        if (error) {
          if (missingRelation(error)) throw friendlyMissing();
          throw error;
        }
        return json(200, { items: (data || []).map((row) => ({ ...row, active: isConsentActive(row) })) });
      }

      if (action === "revoke_clone_consent" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.consent_id) return json(400, { error: "consent_id is required." });
        const updated = await client
          .from("marketing_clone_consent")
          .update({ revoked_at: new Date().toISOString(), revoked_by: user.id, updated_at: new Date().toISOString() })
          .eq("id", body.consent_id)
          .eq("shop_id", shopId)
          .select("id,revoked_at")
          .maybeSingle();
        if (updated.error) throw updated.error;
        if (!updated.data) return json(404, { error: "Consent record not found." });
        // Never leave a profile marked usable once its consent is gone.
        await client.from("marketing_avatar_profiles").update({ status: "suspended", updated_at: new Date().toISOString() }).eq("consent_id", body.consent_id).eq("shop_id", shopId);
        await client.from("marketing_voice_profiles").update({ status: "suspended", updated_at: new Date().toISOString() }).eq("consent_id", body.consent_id).eq("shop_id", shopId);

        // Revoked-media hardening (Section 6, Case D): a completed asset
        // this consent already covers does not remain usable just because
        // it was generated before revocation — demote it to quarantined
        // in place. This is the one path where an ai_generated_assets row
        // already exists and must be defended after the fact (every
        // in-flight case never creates the row at all — see
        // digital-twin-finalization.js). Best-effort/non-fatal: a failure
        // here never unwinds the consent revocation itself, which already
        // took effect above.
        try {
          const quarantinedAssets = await client
            .from("ai_generated_assets")
            .update({ status: "quarantined", quarantine_reason: "consent_revoked", quarantined_at: new Date().toISOString() })
            .eq("consent_id", body.consent_id)
            .eq("shop_id", shopId)
            .eq("status", "completed")
            .select("id");
          if (quarantinedAssets.error) throw quarantinedAssets.error;
          const quarantinedIds = (quarantinedAssets.data || []).map((row) => row.id);
          // Any not-yet-published variant built from one of these assets
          // can no longer proceed into (or stay queued for) publishing —
          // run_publishing_queue's own asset-status gate is the durable
          // enforcement; this cancellation just keeps the queue honest
          // instead of leaving a doomed variant sitting in it.
          if (quarantinedIds.length > 0) {
            await client
              .from("marketing_platform_variants")
              .update({ status: "canceled", last_error: "Source asset was quarantined after consent revocation." })
              .in("asset_id", quarantinedIds)
              .eq("shop_id", shopId)
              .neq("status", "published");
          }
        } catch (quarantineCascadeError) {
          console.warn(
            JSON.stringify({
              level: "warn",
              fn: "marketing-studio",
              message: "revoked_consent_asset_quarantine_failed",
              shopId,
              consentId: body.consent_id,
              reason: String(quarantineCascadeError?.message || quarantineCascadeError)
            })
          );
        }

        await writeCommandAudit(client, user.id, "marketing_clone_consent_revoked", {
          shopId,
          targetType: "marketing_clone_consent",
          targetId: body.consent_id
        });
        return json(200, { ok: true, consent_id: body.consent_id });
      }

      // ── Personal Brand Studio ────────────────────────────────────────
      // Lily learns how THIS florist wants themselves represented — not
      // their shop's brand voice (marketing-brand-brain.js) or general
      // visual style (ai-style-memory.js), a third independent domain.
      // Reuses marketing_clone_consent for the avatar/voice/publish
      // consent dimensions (see personal-brand-consent.js's docstring);
      // reuses ai_generated_assets/persistGeneratedAsset for every
      // generated concept; reuses the existing content_item/platform-
      // variant pipeline for the Marketing Studio handoff (Section 10) —
      // nothing here is a parallel AI or publishing system.

      if (action === "get_personal_brand_profile") {
        const shopId = requireShopId(qs, body);
        const { profile, exists, error } = await loadPersonalBrandProfile(client, shopId);
        if (error && missingRelation({ message: error })) throw friendlyMissing();
        return json(200, { profile, exists, style_summary: buildPersonalBrandStyleSummary(profile.preferences) });
      }

      if (action === "update_personal_brand_profile" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const { ok, error, profile } = await savePersonalBrandProfileFields(client, shopId, body.fields || {}, { userId: user.id });
        if (!ok) {
          if (missingRelation({ message: error })) throw friendlyMissing();
          throw new Error(error);
        }
        await writeCommandAudit(client, user.id, "personal_brand_profile_updated", { shopId, targetType: "marketing_personal_brand_profiles", targetId: shopId });
        return json(200, { profile });
      }

      if (action === "update_personal_brand_preferences" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!Array.isArray(body.updates) || body.updates.length === 0) {
          return json(400, { error: "updates must be a non-empty array." });
        }
        const { profile: current } = await loadPersonalBrandProfile(client, shopId);
        const next = applyExplicitPersonalBrandUpdates(current.preferences, body.updates);
        const { ok, error } = await savePersonalBrandPreferences(client, shopId, next);
        if (!ok) throw new Error(error);
        await writeCommandAudit(client, user.id, "personal_brand_preferences_updated", { shopId, targetType: "marketing_personal_brand_profiles", targetId: shopId });
        return json(200, { preferences: next, style_summary: buildPersonalBrandStyleSummary(next) });
      }

      if (action === "forget_personal_brand_trait" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.category || !body.text) return json(400, { error: "category and text are required." });
        const { profile: current } = await loadPersonalBrandProfile(client, shopId);
        const next = forgetPersonalBrandTrait(current.preferences, { category: body.category, text: body.text });
        const { ok, error } = await savePersonalBrandPreferences(client, shopId, next);
        if (!ok) throw new Error(error);
        return json(200, { preferences: next, style_summary: buildPersonalBrandStyleSummary(next) });
      }

      if (action === "reset_personal_brand_preferences" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const next = resetPersonalBrandPreferences();
        const { ok, error } = await savePersonalBrandPreferences(client, shopId, next);
        if (!ok) throw new Error(error);
        await writeCommandAudit(client, user.id, "personal_brand_preferences_reset", { shopId, targetType: "marketing_personal_brand_profiles", targetId: shopId });
        return json(200, { preferences: next, style_summary: "" });
      }

      // Approve/Favorite/Reject/"Don't do this again" on a generated
      // founder-concept asset — the repetition-based learning signal
      // (Section 4), never a one-shot promotion.
      if (action === "record_personal_brand_signal" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!["approved", "rejected"].includes(body.signal)) return json(400, { error: "signal must be 'approved' or 'rejected'." });
        if (!Array.isArray(body.traits) || body.traits.length === 0) return json(400, { error: "traits must be a non-empty array." });
        const { profile: current } = await loadPersonalBrandProfile(client, shopId);
        const next = recordPersonalBrandApprovalSignal(current.preferences, { traits: body.traits, signal: body.signal });
        const { ok, error } = await savePersonalBrandPreferences(client, shopId, next);
        if (!ok) throw new Error(error);
        return json(200, { preferences: next, style_summary: buildPersonalBrandStyleSummary(next) });
      }

      // ── Reference photo library (Section 5/6) ─────────────────────────
      // Three independent consent booleans per photo — see
      // personal-brand-consent.js's docstring for why this is never one
      // blanket checkbox. Reuses the same public website-media bucket
      // upload_clone_reference_photo already uses; this is a different
      // row/table (marketing_personal_brand_reference_photos), not the
      // same list.

      if (action === "upload_personal_brand_reference_photo" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const validation = validateReferencePhotoConsentBody(body);
        if (!validation.valid) return json(400, { error: validation.error });
        const uploaded = await uploadWebsiteMedia(client, shopId, { dataUrl: body.data_url, filename: body.filename });
        if (!uploaded.ok) return json(400, { error: uploaded.error });
        const inserted = await client
          .from("marketing_personal_brand_reference_photos")
          .insert({
            shop_id: shopId,
            media_url: publicWebsiteMediaUrl(client, uploaded.path),
            media_path: uploaded.path,
            label: validation.sanitized.label,
            consented_to_store: true,
            allow_image_generation: validation.sanitized.allow_image_generation,
            allow_avatar_generation: validation.sanitized.allow_avatar_generation,
            consent_recorded_at: new Date().toISOString(),
            created_by: user.id
          })
          .select("*")
          .single();
        if (inserted.error) {
          if (missingRelation(inserted.error)) throw friendlyMissing();
          throw inserted.error;
        }
        await writeCommandAudit(client, user.id, "personal_brand_reference_photo_uploaded", {
          shopId,
          targetType: "marketing_personal_brand_reference_photos",
          targetId: inserted.data.id
        });
        return json(201, { photo: inserted.data });
      }

      if (action === "list_personal_brand_reference_photos") {
        const shopId = requireShopId(qs, body);
        const { data, error } = await client
          .from("marketing_personal_brand_reference_photos")
          .select("*")
          .eq("shop_id", shopId)
          .order("created_at", { ascending: false });
        if (error) {
          if (missingRelation(error)) throw friendlyMissing();
          throw error;
        }
        return json(200, { items: data || [] });
      }

      // Updates label/consent flags on a reference photo already on file,
      // and doubles as the revoke path (pass revoked: true) — revocation
      // is a status change on the same row, never a silent delete, so the
      // audit trail (who consented, who revoked, when) stays intact.
      if (action === "update_personal_brand_reference_photo" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.photo_id) return json(400, { error: "photo_id is required." });
        const patch = { updated_at: new Date().toISOString() };
        if (typeof body.label === "string") {
          const validated = validateReferencePhotoConsentBody({ data_url: "x", consented_to_store: true, label: body.label });
          patch.label = validated.sanitized.label;
        }
        if (typeof body.allow_image_generation === "boolean") patch.allow_image_generation = body.allow_image_generation;
        if (typeof body.allow_avatar_generation === "boolean") patch.allow_avatar_generation = body.allow_avatar_generation;
        if (body.revoked === true) patch.revoked_at = new Date().toISOString();
        const updated = await client
          .from("marketing_personal_brand_reference_photos")
          .update(patch)
          .eq("id", body.photo_id)
          .eq("shop_id", shopId)
          .select("*")
          .maybeSingle();
        if (updated.error) throw updated.error;
        if (!updated.data) return json(404, { error: "Reference photo not found." });
        await writeCommandAudit(client, user.id, body.revoked === true ? "personal_brand_reference_photo_revoked" : "personal_brand_reference_photo_updated", {
          shopId,
          targetType: "marketing_personal_brand_reference_photos",
          targetId: body.photo_id
        });
        return json(200, { photo: updated.data });
      }

      // A real, permanent delete — distinct from revoke. Only ever called
      // when the florist wants the photo itself gone, not just its
      // permission to use it withdrawn.
      if (action === "delete_personal_brand_reference_photo" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.photo_id) return json(400, { error: "photo_id is required." });
        const deleted = await client
          .from("marketing_personal_brand_reference_photos")
          .delete()
          .eq("id", body.photo_id)
          .eq("shop_id", shopId)
          .select("id")
          .maybeSingle();
        if (deleted.error) throw deleted.error;
        if (!deleted.data) return json(404, { error: "Reference photo not found." });
        await writeCommandAudit(client, user.id, "personal_brand_reference_photo_deleted", {
          shopId,
          targetType: "marketing_personal_brand_reference_photos",
          targetId: body.photo_id
        });
        return json(200, { ok: true, photo_id: body.photo_id });
      }

      // ── Structured quality feedback (Section 14) ──────────────────────
      if (action === "submit_personal_brand_feedback" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.asset_id) return json(400, { error: "asset_id is required." });
        if (!FEEDBACK_REASONS.includes(body.reason)) {
          return json(400, { error: `reason must be one of: ${FEEDBACK_REASONS.join(", ")}.` });
        }
        const inserted = await client
          .from("marketing_personal_brand_feedback")
          .insert({
            shop_id: shopId,
            asset_id: body.asset_id,
            reason: body.reason,
            note: typeof body.note === "string" ? body.note.trim().slice(0, 500) : null,
            created_by: user.id
          })
          .select("*")
          .single();
        if (inserted.error) {
          if (missingRelation(inserted.error)) throw friendlyMissing();
          throw inserted.error;
        }
        return json(201, { feedback: inserted.data });
      }

      // ── Founder-concept generation ─────────────────────────────────────
      // "Generate expensively once" — this produces the text/founder-
      // presence concept only; it never itself calls an avatar/video
      // provider (see request_personal_brand_digital_twin for that, a
      // separate explicit step so a florist reviews the concept before
      // any provider spend).
      if (action === "generate_personal_brand_concept" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!PERSONAL_BRAND_MODE_KEYS.includes(body.mode)) {
          return json(400, { error: `mode must be one of: ${PERSONAL_BRAND_MODE_KEYS.join(", ")}.` });
        }
        const { profile } = await loadPersonalBrandProfile(client, shopId);
        const styleSummary = buildPersonalBrandStyleSummary(profile.preferences);
        const gen = await generatePersonalBrandConcept({
          mode: body.mode,
          profile,
          styleSummary,
          toneHint: ["professional", "casual", "humorous"].includes(body.tone_hint) ? body.tone_hint : null,
          requestText: typeof body.message === "string" ? body.message : ""
        });
        if (!gen.ok) return json(400, { error: gen.error });

        await client.from("marketing_generation_usage").insert({
          shop_id: shopId,
          provider: "cloudflare",
          purpose: "copy",
          unit_type: "request",
          units: 1,
          estimated_cost_cents: estimateCostCents({ purpose: "copy", unitType: "request", units: 1 }),
          status: "estimated"
        });

        const persisted = await persistGeneratedAsset(client, {
          shopId,
          userId: user.id,
          persona: "Lily",
          assetType: "founder_concept",
          provider: "cloudflare",
          model: gen.model,
          content: gen.content,
          status: "completed"
        });
        if (!persisted.ok) throw new Error(persisted.error);

        await writeCommandAudit(client, user.id, "personal_brand_concept_generated", {
          shopId,
          targetType: "ai_generated_assets",
          targetId: persisted.asset.id,
          mode: body.mode
        });
        return json(201, { asset: persisted.asset, content: gen.content });
      }

      // ── Lily command entrypoint (Section 8/9) ─────────────────────────
      // Classifies the whole sentence via the real LLM classifier (never
      // regex-only), applies any standing memory statement immediately,
      // and — when the message resolves to a real creation mode — runs
      // the same generation path as generate_personal_brand_concept, all
      // in one call. This is what "Lily, make a funny 'warning before you
      // meet me' founder post about me" resolves through end to end.
      if (action === "personal_brand_command" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.message) return json(400, { error: "message is required." });

        const result = await runPersonalBrandCommand(client, { shopId, userId: user.id, message: body.message });
        if (!result.understood) return json(200, result);
        if (result.asset) {
          await writeCommandAudit(client, user.id, "personal_brand_command_executed", {
            shopId,
            targetType: "ai_generated_assets",
            targetId: result.asset.id,
            mode: result.classification.mode
          });
        }
        return json(result.asset ? 201 : 200, {
          understood: true,
          classification: result.classification,
          memory_ack: result.memoryAck,
          asset: result.asset,
          content: result.content,
          suggested_platforms: result.suggestedPlatforms,
          digital_twin: result.digitalTwin,
          error: result.error
        });
      }

      // ── Platform-variant planning (Section 10) ────────────────────────
      if (action === "plan_personal_brand_platform_variants" && method === "POST") {
        requireSuperAdmin(admin);
        requireShopId(qs, body);
        if (!PERSONAL_BRAND_MODE_KEYS.includes(body.mode)) {
          return json(400, { error: `mode must be one of: ${PERSONAL_BRAND_MODE_KEYS.join(", ")}.` });
        }
        const targetPlatforms = resolveTargetPlatforms({
          mode: body.mode,
          explicitPlatform: body.platform || null,
          requestedPlatforms: Array.isArray(body.platforms) ? body.platforms : null
        });
        const plan = planPersonalBrandPlatformVariants({ mode: body.mode, targetPlatforms });
        return json(200, { plan });
      }

      // ── Marketing Studio handoff (Section 10) ─────────────────────────
      // An approved founder concept becomes a real content_item + platform
      // variants through the EXISTING plan/generate/publish pipeline —
      // generate_content (already built, tested, wired to disclosure/cost/
      // publishing) then does the actual per-platform copy/image work,
      // completely unmodified by this pass.
      if (action === "personal_brand_concept_to_content_item" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.asset_id) return json(400, { error: "asset_id is required." });
        if (!PERSONAL_BRAND_MODE_KEYS.includes(body.mode)) {
          return json(400, { error: `mode must be one of: ${PERSONAL_BRAND_MODE_KEYS.join(", ")}.` });
        }
        // Revoked-media hardening (Section 9): a quarantined asset can
        // never be handed off into the content-item/publishing pipeline
        // via a direct asset_id, even one supplied for an otherwise-valid
        // founder concept.
        const asset = await client
          .from("ai_generated_assets")
          .select("id,content,asset_type")
          .eq("id", body.asset_id)
          .eq("shop_id", shopId)
          .neq("status", "quarantined")
          .maybeSingle();
        if (asset.error) throw asset.error;
        if (!asset.data || asset.data.asset_type !== "founder_concept") return json(404, { error: "Founder concept asset not found." });

        const targetPlatforms = resolveTargetPlatforms({
          mode: body.mode,
          explicitPlatform: null,
          requestedPlatforms: Array.isArray(body.platforms) ? body.platforms.filter((p) => SUPPORTED_PLATFORMS.includes(p)) : null
        });
        if (!targetPlatforms.length) return json(400, { error: "No valid target platforms." });

        const modeInfo = getPersonalBrandMode(body.mode);
        const contentType = targetPlatforms.some((p) => (planPersonalBrandPlatformVariants({ mode: body.mode, targetPlatforms: [p] })[0].destinations.some((d) => d.contentKind === "video")))
          ? "reel"
          : "image_post";

        const inserted = await client
          .from("marketing_content_items")
          .insert({
            shop_id: shopId,
            created_by: user.id,
            content_type: contentType,
            title: `${modeInfo.label} — ${asset.data.content?.headline || "Founder content"}`,
            brief: [asset.data.content?.body, asset.data.content?.founder_presence_brief].filter(Boolean).join("\n\n"),
            status: "idea",
            uses_ai_clone: Boolean(body.uses_ai_clone),
            requires_human_approval: true
          })
          .select("id,content_type,title,brief,status")
          .single();
        if (inserted.error) {
          if (missingRelation(inserted.error)) throw friendlyMissing();
          throw inserted.error;
        }

        // Launch-blocker fix (Blocker 1): a founder-concept handoff is
        // always real AI-generated content (Personal Brand Studio's
        // backdrop-compositing image engine at minimum; avatar+voice when
        // uses_ai_clone is true) — compute disclosure fields at insert
        // time instead of leaving them at the fail-open DB default.
        const usesAiClone = Boolean(body.uses_ai_clone);
        const variantRows = targetPlatforms.map((platform) => ({
          shop_id: shopId,
          content_item_id: inserted.data.id,
          platform,
          status: "pending",
          ...computeDisclosureFields({
            platform,
            avatarUsed: usesAiClone,
            voiceUsed: usesAiClone,
            generativeVideoUsed: usesAiClone && contentType === "reel",
            generativeImageUsed: !usesAiClone,
            aiContentType: usesAiClone ? "avatar_video" : "generative_image"
          })
        }));
        const insertedVariants = await client.from("marketing_platform_variants").insert(variantRows).select("id,platform");
        if (insertedVariants.error) throw insertedVariants.error;

        await writeCommandAudit(client, user.id, "personal_brand_concept_handed_off", {
          shopId,
          targetType: "marketing_content_items",
          targetId: inserted.data.id,
          sourceAssetId: body.asset_id
        });

        return json(201, { item: inserted.data, variants: insertedVariants.data || [] });
      }

      // Founder-story text specifically can also become a website About/
      // homepage section draft — reuses generateWebsiteSectionDraft
      // (already built for Website Builder X) rather than a new generator.
      // appliedToLivePage is always false here — writing it onto a live
      // page is a separate, explicitly-approved Website Studio action.
      if (action === "personal_brand_website_founder_content" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const { profile } = await loadPersonalBrandProfile(client, shopId);
        const shopRow = await client.from("shops").select("name").eq("id", shopId).maybeSingle();
        const gen = await generateWebsiteSectionDraft({
          persona: "Lily",
          occasion: "Founder story",
          shop: { name: shopRow.data?.name || null },
          requestText: profile.founder_story || body.message || ""
        });
        if (!gen.ok) return json(400, { error: gen.error });
        return json(200, { content: gen.content, note: "This is a draft only — applying it to the live public landing page requires a separate, explicitly-approved Website Studio step. Not applied here." });
      }

      // ── Digital Twin handoff (Section 11) ─────────────────────────────
      // Personal Brand Studio -> AvatarEngine/VoiceEngine -> Media Output
      // Pipeline -> Marketing Studio -> Approval -> Publishing. This step
      // only ever KICKS OFF a render through the existing clone provider
      // router (selectCloneProvider — same one preview_clone_profile and
      // request_clone_enrollment already use); it never connects, buys,
      // or activates a provider itself, and it authorizes strictly off
      // the existing marketing_clone_consent grant (Section 6, dimensions
      // 4/5) — a founder concept never gets rendered as a Digital Twin
      // video without an active, platform-approved consent record.
      if (action === "request_personal_brand_digital_twin" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const result = await requestDigitalTwinGeneration(client, {
          shopId,
          userId: user.id,
          assetId: body.asset_id,
          avatarProfileId: body.avatar_profile_id,
          voiceProfileId: body.voice_profile_id,
          consentId: body.consent_id,
          platform: body.platform,
          usage: body.usage
        });
        if (result.ok && result.statusCode === 202) {
          await writeCommandAudit(client, user.id, "personal_brand_digital_twin_requested", {
            shopId,
            targetType: "ai_generated_assets",
            targetId: body.asset_id,
            consentId: body.consent_id,
            platform: body.platform
          });
        }
        return json(result.statusCode, result.body);
      }

      // Launch-blocker fix (Blocker 4, real scheduling UI): the missing
      // link between "Ashley picks a date/time in the Calendar UI" and
      // enqueue_publish (which only ever reads whatever scheduled_at a
      // variant already has). Converts the shop's own local wall-clock
      // time — never a hardcoded timezone — into the correct UTC instant
      // via shopLocalDateTimeToUtcIso (DST-aware). Only touches
      // scheduled_at; approval/queueing stay exactly enqueue_publish's job.
      if (action === "schedule_content_item" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const platforms = Array.isArray(body.platforms) && body.platforms.length ? body.platforms : null;
        const result = await scheduleContentItemVariants(client, {
          shopId,
          contentItemId: body.content_item_id,
          scheduledAtLocal: body.scheduled_at_local,
          platforms
        });
        if (!result.ok) {
          if (result.code === "db_error" && missingRelation(result.dbError)) throw friendlyMissing();
          if (result.code === "not_found") return json(404, { error: result.error });
          return json(400, { error: result.error });
        }

        await writeCommandAudit(client, user.id, "marketing_content_scheduled", {
          shopId,
          targetType: "marketing_content_items",
          targetId: body.content_item_id,
          scheduledAtUtc: result.scheduledAtUtc,
          timezone: result.timezone
        });
        return json(200, { variants: result.variants, scheduled_at_utc: result.scheduledAtUtc, timezone: result.timezone });
      }

      // Priority 7 of the "as far as technically possible" pass: the two
      // disclosed UI gaps (no caption editing, no add/remove platforms).
      // Platform selection ("before approval/scheduling") locks the
      // moment EITHER the content item is approved/scheduled/published/
      // etc OR any one of its variants already carries a real
      // scheduled_at — matching the launch audit's own wording exactly,
      // not just the content item's own status column.
      if (action === "update_variant_caption" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.platform_variant_id) return json(400, { error: "platform_variant_id is required." });
        if (typeof body.caption !== "string" || !body.caption.trim()) return json(400, { error: "caption is required and cannot be empty." });
        const hashtags = Array.isArray(body.hashtags) ? body.hashtags.slice(0, 15).map((h) => String(h).slice(0, 50)) : undefined;

        const currentVariant = await client
          .from("marketing_platform_variants")
          .select("id,status,platform")
          .eq("id", body.platform_variant_id)
          .eq("shop_id", shopId)
          .maybeSingle();
        if (currentVariant.error) {
          if (missingRelation(currentVariant.error)) throw friendlyMissing();
          throw currentVariant.error;
        }
        if (!currentVariant.data) return json(404, { error: "Platform variant not found." });
        // The one hard boundary the audit named: never silently modify an
        // already-published (or actively publishing) variant.
        if (["published", "publishing"].includes(currentVariant.data.status)) {
          return json(400, {
            error: `Cannot edit the caption for a variant that is already '${currentVariant.data.status}' — a published post's caption can't be silently rewritten after the fact.`
          });
        }

        const updatePayload = { caption: body.caption.trim().slice(0, 3000), updated_at: new Date().toISOString() };
        if (hashtags) updatePayload.hashtags = hashtags;
        const updated = await client
          .from("marketing_platform_variants")
          .update(updatePayload)
          .eq("id", body.platform_variant_id)
          .eq("shop_id", shopId)
          .select("id,platform,caption,hashtags,status")
          .single();
        if (updated.error) throw updated.error;
        await writeCommandAudit(client, user.id, "marketing_variant_caption_updated", {
          shopId,
          targetType: "marketing_platform_variants",
          targetId: body.platform_variant_id,
          platform: currentVariant.data.platform
        });
        return json(200, { variant: updated.data });
      }

      if ((action === "add_content_platform" || action === "remove_content_platform") && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.content_item_id) return json(400, { error: "content_item_id is required." });
        const platform = String(body.platform || "").trim();
        if (!SUPPORTED_PLATFORMS.includes(platform)) {
          return json(400, { error: `platform must be one of: ${SUPPORTED_PLATFORMS.join(", ")}.` });
        }

        const currentItem = await client
          .from("marketing_content_items")
          .select("id,status")
          .eq("id", body.content_item_id)
          .eq("shop_id", shopId)
          .maybeSingle();
        if (currentItem.error) {
          if (missingRelation(currentItem.error)) throw friendlyMissing();
          throw currentItem.error;
        }
        if (!currentItem.data) return json(404, { error: "Content item not found." });

        const existingVariants = await client
          .from("marketing_platform_variants")
          .select("id,platform,status,scheduled_at,asset_id,caption,hashtags,ai_content_type,avatar_used,voice_used,generative_video_used,generative_image_used,human_edited")
          .eq("content_item_id", body.content_item_id)
          .eq("shop_id", shopId);
        if (existingVariants.error) throw existingVariants.error;
        const variants = existingVariants.data || [];

        const isLockedForApprovalOrScheduling =
          !PRE_APPROVAL_CONTENT_STATUSES.includes(currentItem.data.status) || variants.some((v) => v.scheduled_at);
        if (isLockedForApprovalOrScheduling) {
          return json(400, {
            error: "The platform set is locked once this content item has been approved or any of its platforms has been scheduled — remove the schedule first, or work with a fresh draft."
          });
        }

        if (action === "add_content_platform") {
          if (variants.some((v) => v.platform === platform)) {
            return json(400, { error: `${platform} is already a target platform for this content item.` });
          }
          // Real content facts (what AI capabilities actually produced
          // this content) are copied from an existing sibling variant —
          // they describe the CONTENT, never re-decided per platform. The
          // disclosure REQUIREMENT itself is always recomputed for the
          // new platform's own policy (computeDisclosureFields), never
          // copied verbatim — the same content can carry a different
          // disclosure rule on a different platform.
          const sibling = variants[0] || null;
          const inserted = await client
            .from("marketing_platform_variants")
            .insert({
              shop_id: shopId,
              content_item_id: body.content_item_id,
              platform,
              status: "pending",
              asset_id: sibling?.asset_id || null,
              caption: sibling?.caption || null,
              hashtags: sibling?.hashtags || [],
              ...computeDisclosureFields({
                platform,
                avatarUsed: sibling?.avatar_used || false,
                voiceUsed: sibling?.voice_used || false,
                generativeVideoUsed: sibling?.generative_video_used || false,
                generativeImageUsed: sibling?.generative_image_used || false,
                humanEdited: sibling?.human_edited || false,
                aiContentType: sibling?.ai_content_type || null
              })
            })
            .select("id,platform,caption,hashtags,status,ai_disclosure_required")
            .single();
          if (inserted.error) {
            if (missingRelation(inserted.error)) throw friendlyMissing();
            // Real concurrency safety: two concurrent add_content_platform
            // calls for the SAME platform can both pass the "not already a
            // target" check above and both reach this insert — the DB's own
            // unique (content_item_id, platform) constraint is the actual
            // backstop, and this turns that race into the same friendly
            // 400 a sequential duplicate call gets, not a raw 500.
            if (inserted.error.code === "23505") {
              return json(400, { error: `${platform} is already a target platform for this content item.` });
            }
            throw inserted.error;
          }
          await writeCommandAudit(client, user.id, "marketing_content_platform_added", { shopId, targetType: "marketing_content_items", targetId: body.content_item_id, platform });
          return json(200, {
            variant: inserted.data,
            copiedFromExisting: Boolean(sibling),
            note: sibling
              ? "Copied the caption from an existing platform as a starting point — edit it before approving."
              : "No content generated yet to copy from — generate content first, or write a caption manually."
          });
        }

        // remove_content_platform
        const target = variants.find((v) => v.platform === platform);
        if (!target) return json(404, { error: `${platform} is not a target platform for this content item.` });
        if (variants.length <= 1) {
          return json(400, { error: "Cannot remove the last remaining platform — a content item needs at least one target platform." });
        }
        const deleted = await client.from("marketing_platform_variants").delete().eq("id", target.id).eq("shop_id", shopId).select("id").maybeSingle();
        if (deleted.error) throw deleted.error;
        await writeCommandAudit(client, user.id, "marketing_content_platform_removed", { shopId, targetType: "marketing_content_items", targetId: body.content_item_id, platform });
        return json(200, { ok: true, platform, remainingPlatforms: variants.filter((v) => v.platform !== platform).map((v) => v.platform) });
      }

      // Priority 1 of the "as far as technically possible" pass: Lily
      // compound-request orchestration — "Create a Reel for this week's
      // wedding bouquet..., make versions for Instagram and TikTok, write
      // the captions in my style, schedule them for Friday evening, and
      // don't spend over $2" as ONE request. Reuses every underlying
      // engine above (never a second copy-generation/scheduling/cost
      // path) via marketing-compound-orchestrator.js; persists to
      // ai_execution_jobs so a job's real per-step outcome is always
      // inspectable, never just a chat reply. Every outcome — full
      // success, partial (a blocked Digital Twin/video-render step next
      // to completed ones), or over-budget-halted — is a 200 with a real
      // job row; only extraction failure or an empty/unactionable request
      // returns 400.
      if (action === "compound_request" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const message = String(body.message || "").trim();
        if (!message) return json(400, { error: "message is required — describe what Lily should create (e.g. \"Create a Reel for this week's wedding bouquet...\")." });

        const shopRow = await client.from("shops").select("name,timezone").eq("id", shopId).maybeSingle();
        if (shopRow.error && missingRelation(shopRow.error)) throw friendlyMissing();

        const result = await runCompoundRequest(client, {
          shopId,
          userId: user.id,
          persona: typeof body.persona === "string" && body.persona ? body.persona : "Lily",
          message,
          shop: { name: shopRow.data?.name || null },
          timezone: shopRow.data?.timezone || "America/New_York"
        });
        if (!result.ok) {
          if (missingRelation({ message: result.error })) throw friendlyMissing();
          return json(400, { error: result.error });
        }

        // Orchestration hardening (Priority 9): a deduped result means
        // nothing actually happened on THIS call — the original request's
        // own audit entry already exists, so writing a second one here
        // would misrepresent a no-op as a new admin action.
        if (!result.deduped) {
          await writeCommandAudit(client, user.id, "marketing_compound_request", {
            shopId,
            targetType: "ai_execution_jobs",
            targetId: result.job.id,
            status: result.job.status
          });
        }
        return json(200, { job: result.job, deduped: Boolean(result.deduped) });
      }

      // Stage E — the reliable-publishing queue. Approving content queues
      // it; running the queue actually attempts to publish. Every attempt
      // fails honestly today (no platform adapter is live — see
      // _shared/marketing-social-providers.js) and settles to 'failed'
      // immediately rather than retry-looping against a provider that
      // structurally doesn't exist (marketing-publishing-queue.js's
      // classifyPublishFailure). Nothing here ever claims a post published.
      if (action === "enqueue_publish" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.content_item_id) return json(400, { error: "content_item_id is required." });

        const currentItem = await client
          .from("marketing_content_items")
          .select("id,status")
          .eq("id", body.content_item_id)
          .eq("shop_id", shopId)
          .maybeSingle();
        if (currentItem.error) {
          if (missingRelation(currentItem.error)) throw friendlyMissing();
          throw currentItem.error;
        }
        if (!currentItem.data) return json(404, { error: "Content item not found." });
        if (currentItem.data.status !== "approved") {
          return json(400, { error: `Only an 'approved' content item can be queued for publishing (current status: '${currentItem.data.status}').` });
        }

        const variantsResult = await client
          .from("marketing_platform_variants")
          .select("id,platform,scheduled_at,asset_id")
          .eq("content_item_id", body.content_item_id)
          .eq("shop_id", shopId);
        if (variantsResult.error) throw variantsResult.error;
        const variants = variantsResult.data || [];
        if (!variants.length) return json(400, { error: "This content item has no platform variants to publish." });

        const jobRows = variants.map((v) => ({
          shop_id: shopId,
          platform_variant_id: v.id,
          idempotency_key: buildIdempotencyKey(v.id),
          status: "queued",
          next_attempt_at: v.scheduled_at || new Date().toISOString()
        }));
        // ignoreDuplicates makes this safe to call twice for the same
        // content item — a variant already queued keeps its existing job
        // (and its attempt history) instead of getting a silent second one.
        const jobsInserted = await client
          .from("marketing_publishing_jobs")
          .upsert(jobRows, { onConflict: "idempotency_key", ignoreDuplicates: true })
          .select("id,platform_variant_id");
        if (jobsInserted.error) {
          if (missingRelation(jobsInserted.error)) throw friendlyMissing();
          throw jobsInserted.error;
        }

        await client
          .from("marketing_platform_variants")
          .update({ status: "scheduled" })
          .eq("content_item_id", body.content_item_id)
          .eq("shop_id", shopId);
        const updatedItem = await client
          .from("marketing_content_items")
          .update({ status: "scheduled", updated_at: new Date().toISOString() })
          .eq("id", body.content_item_id)
          .eq("shop_id", shopId)
          .select("id,status")
          .single();
        if (updatedItem.error) throw updatedItem.error;

        await writeCommandAudit(client, user.id, "marketing_publish_enqueued", {
          shopId,
          targetType: "marketing_content_items",
          targetId: body.content_item_id,
          variantCount: variants.length
        });
        return json(200, { item: updatedItem.data, jobs_queued: jobsInserted.data?.length ?? 0 });
      }

      if (action === "run_publishing_queue" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const limit = Math.min(100, Math.max(1, Number(body.limit) || 25));

        // Launch-blocker fix (Blocker 3, real durable scheduler): this used
        // to SELECT due jobs and process them inline with no claim step —
        // safe only as long as nothing else could ever run the queue at
        // the same time, which stopped being true once a cron-triggered
        // scheduled function (marketing-scheduled-publisher.js) exists
        // alongside this admin-triggered action. runPublishingWorker()
        // atomically claims jobs (flips queued->running, re-checked so a
        // concurrent caller can't double-claim) before processing them —
        // the exact same engine the scheduled function uses, so both
        // paths share one set of guarantees instead of two copies that
        // could drift apart.
        const results = await runPublishingWorker(client, { shopId, limit });

        return json(200, {
          processed: results.length,
          results,
          note: "NOT LIVE — every attempt above fails honestly (social_provider_not_live) because no platform adapter is connected yet. This exercises the real queue/retry/dead-letter machinery, not a fake success path."
        });
      }

      if (action === "publishing_health") {
        const shopId = requireShopId(qs, body);
        const jobsResult = await client.from("marketing_publishing_jobs").select("status").eq("shop_id", shopId).limit(5000);
        if (jobsResult.error) {
          if (missingRelation(jobsResult.error)) throw friendlyMissing();
          throw jobsResult.error;
        }
        const jobStatusCounts = {};
        for (const row of jobsResult.data || []) jobStatusCounts[row.status] = (jobStatusCounts[row.status] || 0) + 1;

        return json(200, {
          job_status_counts: jobStatusCounts,
          platforms: SUPPORTED_PLATFORMS.map((platform) => ({
            platform,
            live: isPlatformLive(platform),
            configured: isPlatformConfigured(platform)
          })),
          note: "NOT LIVE — PROVIDER CONNECTION REQUIRED for every platform. 'configured' reflects whether OAuth env credentials are present; 'live' additionally requires a working, approved adapter, which none of the 7 platforms have yet."
        });
      }

      if (action === "connect_platform" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const platform = String(body.platform || "").trim();
        if (!SUPPORTED_PLATFORMS.includes(platform)) {
          return json(400, { error: `platform must be one of: ${SUPPORTED_PLATFORMS.join(", ")}.` });
        }
        const configured = isPlatformConfigured(platform);
        await client.from("marketing_social_connections").upsert(
          {
            shop_id: shopId,
            platform,
            status: configured ? "connecting" : "not_connected",
            last_checked_at: new Date().toISOString(),
            last_error: configured ? null : "OAuth credentials not configured for this platform yet."
          },
          { onConflict: "shop_id,platform" }
        );
        if (!configured) {
          return json(200, {
            configured: false,
            required_env: platformOAuthEnvVarNames(platform),
            message: `NOT LIVE — PROVIDER CONNECTION REQUIRED. Set ${platformOAuthEnvVarNames(platform).clientIdVar} and ${platformOAuthEnvVarNames(platform).clientSecretVar} to enable connecting ${platform}.`
          });
        }
        if (!isOAuthArchitected(platform)) {
          // Credentials exist, but this platform's real OAuth authorize/
          // callback exchange isn't built yet — guessing at its exact
          // authorize URL/scopes without consulting real, current provider
          // documentation risks claiming an integration works before it
          // does. facebook/instagram/tiktok have real, documentation-
          // verified OAuth architecture (see marketing-social-oauth.js);
          // linkedin/pinterest/google_business/youtube each need their own
          // documentation pass before this branch applies to them too.
          return json(200, {
            configured: true,
            message: `Credentials are present for ${platform}, but the OAuth connect flow itself is not built for this platform yet (only ${OAUTH_SUPPORTED_PLATFORMS.join(", ")} are so far) — this is the next real step, not a working connection.`
          });
        }
        // Real OAuth architecture exists and real credentials are
        // configured — build the actual authorize URL so the admin's
        // browser can be sent to the real provider. Still NOT LIVE for
        // publishing until the callback below is exercised end to end
        // with real, provider-approved credentials.
        const redirectUri = `${resolvePublicSiteUrl(process.env, event.headers?.origin)}/.netlify/functions/marketing-social-oauth-callback`;
        const authResult = buildAuthorizeUrl(platform, { shopId, userId: user.id, redirectUri, env: process.env });
        if (!authResult.ok) {
          return json(200, { configured: true, message: authResult.error });
        }
        return json(200, {
          configured: true,
          authorize_url: authResult.url,
          scopes: authResult.scopes,
          message: `Redirect the browser to authorize_url to complete connecting ${platform}. NOT LIVE until a real ${platform} app has cleared that provider's own review process.`
        });
      }

      if (action === "disconnect_platform" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const platform = String(body.platform || "").trim();
        if (!SUPPORTED_PLATFORMS.includes(platform)) {
          return json(400, { error: `platform must be one of: ${SUPPORTED_PLATFORMS.join(", ")}.` });
        }
        const updated = await client
          .from("marketing_social_connections")
          .update({ status: "disconnected", connected_at: null, expires_at: null, updated_at: new Date().toISOString() })
          .eq("shop_id", shopId)
          .eq("platform", platform)
          .select("id")
          .maybeSingle();
        if (updated.error) throw updated.error;
        if (updated.data?.id) {
          await client.from("marketing_social_connection_secrets").delete().eq("connection_id", updated.data.id);
        }
        await writeCommandAudit(client, user.id, "marketing_platform_disconnected", { shopId, targetType: "marketing_social_connections", targetId: platform });
        return json(200, { ok: true, platform });
      }

      // Priority 6 of the "as far as technically possible" pass: the real
      // ingestion job — walks published, externally-confirmed variants and
      // attempts to refresh their metrics via each platform's own
      // fetchAnalytics() (same provider interface Stage E's publishing
      // worker already uses). NOT LIVE today for the identical reason
      // publishing is not live (Priority 5's audit): every attempt fails
      // honestly with social_provider_not_live — nothing here can write a
      // fabricated metric row (marketing_performance_metrics.source is
      // DB-constrained to 'platform_api', and a failed provider call never
      // reaches the insert at all).
      if (action === "run_analytics_ingestion" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const limit = Math.min(200, Math.max(1, Number(body.limit) || 25));
        const results = await runAnalyticsIngestion(client, { shopId, limit });
        return json(200, {
          processed: results.length,
          results,
          note: "NOT LIVE — every attempt above fails honestly (social_provider_not_live) because no platform adapter is connected yet. This exercises the real ingestion/normalization/reconciliation machinery, not a fake metrics path."
        });
      }

      // Stage F — intelligence. Every number below is derived from
      // Florisyn's own real tables; engagement/insight/experiment data
      // stays honestly empty until Stage E actually publishes something
      // for real and marketing_performance_metrics gets real rows from a
      // platform's own API (source is DB-constrained to 'platform_api' —
      // see the Stage B migration — so there is no path for a fabricated
      // metric to reach this code at all).
      if (action === "analytics_summary") {
        const shopId = requireShopId(qs, body);
        const [contentItemsResult, jobsResult, usageResult, metricsResult] = await Promise.all([
          client.from("marketing_content_items").select("status").eq("shop_id", shopId),
          client.from("marketing_publishing_jobs").select("status").eq("shop_id", shopId),
          client.from("marketing_generation_usage").select("status,estimated_cost_cents,actual_cost_cents").eq("shop_id", shopId),
          client.from("marketing_performance_metrics").select("platform,metric_name,raw_value,source,platform_variant_id,fetched_at").eq("shop_id", shopId)
        ]);
        for (const r of [contentItemsResult, jobsResult, usageResult, metricsResult]) {
          if (r.error) {
            if (missingRelation(r.error)) throw friendlyMissing();
            throw r.error;
          }
        }
        return json(
          200,
          buildMarketingStudioAnalyticsSummary({
            contentItems: contentItemsResult.data || [],
            jobs: jobsResult.data || [],
            usageRows: usageResult.data || [],
            // Reconciled to the latest snapshot per (variant, metric) before
            // summarizing — see marketing-analytics-ingestion.js's doc: a
            // repeatedly-ingested post must never dilute engagement numbers
            // by how often ingestion happened to run.
            metricRows: reconcileLatestMetricSnapshots(metricsResult.data || [])
          })
        );
      }

      // Closed-loop learning (Section 27) — groups real fetched metrics by
      // platform and labels each group by real sample size alone
      // (observation/correlation/recommendation). Empty today; wired for
      // the moment real data exists.
      if (action === "list_insights") {
        const shopId = requireShopId(qs, body);
        const metricName = String(qs.metric || body.metric || "").trim();
        if (!metricName) return json(400, { error: "metric is required (e.g. 'likes', 'engagement_rate')." });
        const metricsResult = await client
          .from("marketing_performance_metrics")
          .select("platform,raw_value,source,platform_variant_id,metric_name,fetched_at")
          .eq("shop_id", shopId)
          .eq("metric_name", metricName)
          .eq("source", "platform_api");
        if (metricsResult.error) {
          if (missingRelation(metricsResult.error)) throw friendlyMissing();
          throw metricsResult.error;
        }
        // Reconciled to the latest snapshot per variant first — see
        // marketing-analytics-ingestion.js's doc.
        const rows = reconcileLatestMetricSnapshots(metricsResult.data || []).map((r) => ({ platform: r.platform, value: r.raw_value }));
        const groups = groupMetricsByDimension(rows, "platform");
        return json(200, { metric: metricName, groups });
      }

      if (action === "create_ab_experiment" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const validation = validateExperimentBody(body);
        if (!validation.valid) return json(400, { error: validation.error });
        const inserted = await client
          .from("marketing_ab_experiments")
          .insert({
            shop_id: shopId,
            campaign_id: body.campaign_id || null,
            hypothesis: validation.sanitized.hypothesis,
            variants: validation.sanitized.variants,
            metric: validation.sanitized.metric,
            duration_days: validation.sanitized.duration_days,
            status: "draft",
            created_by: user.id
          })
          .select("id,hypothesis,variants,metric,duration_days,status,created_at")
          .single();
        if (inserted.error) {
          if (missingRelation(inserted.error)) throw friendlyMissing();
          throw inserted.error;
        }
        await writeCommandAudit(client, user.id, "marketing_ab_experiment_created", { shopId, targetType: "marketing_ab_experiments", targetId: inserted.data.id });
        return json(201, { experiment: inserted.data });
      }

      if (action === "list_ab_experiments") {
        const shopId = requireShopId(qs, body);
        const { data, error } = await client
          .from("marketing_ab_experiments")
          .select("id,hypothesis,variants,metric,duration_days,status,outcome,started_at,ended_at,created_at")
          .eq("shop_id", shopId)
          .order("created_at", { ascending: false });
        if (error) {
          if (missingRelation(error)) throw friendlyMissing();
          throw error;
        }
        return json(200, { items: data || [] });
      }

      if (action === "evaluate_ab_experiment" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        if (!body.experiment_id) return json(400, { error: "experiment_id is required." });
        const experimentResult = await client
          .from("marketing_ab_experiments")
          .select("id,variants,metric,status,started_at")
          .eq("id", body.experiment_id)
          .eq("shop_id", shopId)
          .maybeSingle();
        if (experimentResult.error) {
          if (missingRelation(experimentResult.error)) throw friendlyMissing();
          throw experimentResult.error;
        }
        if (!experimentResult.data) return json(404, { error: "Experiment not found." });
        const experiment = experimentResult.data;
        if (!Array.isArray(experiment.variants) || experiment.variants.length < 2) {
          return json(400, { error: "This experiment has fewer than 2 variants recorded." });
        }

        // Launch-blocker fix (Blocker 2, tenant-isolation review): experiment
        // `variants` is a jsonb column populated from caller-supplied
        // content_item_id values at create_ab_experiment time (never
        // validated there to belong to this shop) — without a shop_id
        // filter here, a content_item_id pointing at ANOTHER shop's content
        // item would pull that shop's real platform-variant rows and
        // performance metrics into this shop's evaluation. The experiment
        // row itself is already shop-scoped (looked up above); every join
        // off it must stay scoped the same way.
        const contentItemIds = experiment.variants.map((v) => v.content_item_id).filter(Boolean);
        const variantsResult = contentItemIds.length
          ? await client.from("marketing_platform_variants").select("id,content_item_id").eq("shop_id", shopId).in("content_item_id", contentItemIds)
          : { data: [], error: null };
        if (variantsResult.error) throw variantsResult.error;
        const platformVariantIds = (variantsResult.data || []).map((v) => v.id);
        const variantIdToContentItem = new Map((variantsResult.data || []).map((v) => [v.id, v.content_item_id]));

        let metricRows = [];
        if (platformVariantIds.length) {
          const metricsResult = await client
            .from("marketing_performance_metrics")
            .select("platform_variant_id,raw_value,source,metric_name,fetched_at")
            .eq("shop_id", shopId)
            .in("platform_variant_id", platformVariantIds)
            .eq("metric_name", experiment.metric)
            .eq("source", "platform_api");
          if (metricsResult.error) throw metricsResult.error;
          // Reconciled to the latest snapshot per variant — an A/B winner
          // must be decided on each variant's current number, never an
          // average polluted by how many times ingestion happened to run
          // for one post vs. another.
          metricRows = reconcileLatestMetricSnapshots(metricsResult.data || []);
        }

        const contentItemToLabel = new Map(experiment.variants.map((v) => [v.content_item_id, v.label]));
        const rowsWithLabel = metricRows
          .map((row) => {
            const contentItemId = variantIdToContentItem.get(row.platform_variant_id);
            const label = contentItemToLabel.get(contentItemId);
            return label ? { label, value: row.raw_value } : null;
          })
          .filter(Boolean);
        const grouped = groupMetricsByDimension(rowsWithLabel, "label");
        // Every declared variant must appear, even with zero real data —
        // never silently drop a variant with no metrics yet from the
        // comparison.
        const results = experiment.variants.map((v) => {
          const found = grouped.find((g) => g.key === v.label);
          return found ? { label: v.label, sampleSize: found.sampleSize, average: found.average } : { label: v.label, sampleSize: 0, average: 0 };
        });

        const outcome = determineExperimentWinner(results);
        const updated = await client
          .from("marketing_ab_experiments")
          .update({
            outcome: { ...outcome, results },
            status: outcome.winner ? "completed" : "running",
            started_at: experiment.started_at || new Date().toISOString(),
            ended_at: outcome.winner ? new Date().toISOString() : null,
            updated_at: new Date().toISOString()
          })
          .eq("id", body.experiment_id)
          .eq("shop_id", shopId)
          .select("id,status,outcome")
          .single();
        if (updated.error) throw updated.error;
        await writeCommandAudit(client, user.id, "marketing_ab_experiment_evaluated", {
          shopId,
          targetType: "marketing_ab_experiments",
          targetId: body.experiment_id,
          outcome: outcome.reason
        });
        return json(200, { experiment: updated.data });
      }

      return methodNotAllowed();
    } catch (error) {
      return platformAdminErrorResponse(event, error);
    }
  };
}

export const handler = createMarketingStudioHandler();
