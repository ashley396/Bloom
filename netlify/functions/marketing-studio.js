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

import { json, methodNotAllowed } from "./_shared/http.js";
import { admin as createServiceRoleClient } from "./_shared/saas.js";
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
import { validateFlyerRenderDataUrl, flyerApprovalBlockReason } from "./_shared/flyer-render.js";
import { parseDataUrl } from "./_shared/upload-validation.js";
import { buildIdempotencyKey } from "./_shared/marketing-publishing-queue.js";
import { runPublishingWorker } from "./_shared/marketing-publishing-worker.js";
import { scheduleContentItemVariants } from "./_shared/marketing-schedule-content.js";
import { runCompoundRequest } from "./_shared/marketing-compound-orchestrator.js";
import { runAnalyticsIngestion, reconcileLatestMetricSnapshots } from "./_shared/marketing-analytics-ingestion.js";
import { checkMonthlyBudgetForRequest, getShopBudgetCapCents, monthlyCommittedSpendCents } from "./_shared/marketing-budget-guard.js";
import { COST_CONFIG_VERSION, DEFAULT_MONTHLY_ALLOWANCE, estimateCostCents } from "./_shared/marketing-cost-config.js";
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
import { generateSocialPost, generateVideoConcept, generateWebsiteSectionDraft, generateFlyerContent, persistGeneratedAsset } from "./_shared/ai-creative-engine.js";
import { generateImage, buildImagePrompt, buildFlyerBackgroundPrompt, generateFlyerBackgroundWithRetry } from "./_shared/ai-image-engine.js";
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
  detectWeakMarketingCopy,
  requestSignalsPlainOperationalNotice,
  buildDeterministicNoticeContent,
  extractShopNameFromRequestText,
  requestNeedsFlyerWording,
  instructionAffectsFlyerWording,
  instructionAffectsFlyerImage
} from "./_shared/marketing-content-revision.js";
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
        const { data, error } = await client
          .from("marketing_generation_usage")
          .select("provider,purpose,estimated_cost_cents,actual_cost_cents,status,created_at")
          .eq("shop_id", shopId)
          .order("created_at", { ascending: false })
          .limit(500);
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
        const reviewVariantAssets = await client
          .from("marketing_platform_variants")
          .select("asset_id")
          .eq("content_item_id", body.content_item_id)
          .eq("shop_id", shopId);
        const reviewAssetIds = [...new Set((reviewVariantAssets.data || []).map((v) => v.asset_id).filter(Boolean))];
        const reviewAssets = reviewAssetIds.length
          ? (await client.from("ai_generated_assets").select("id,asset_type,content").in("id", reviewAssetIds).eq("shop_id", shopId)).data || []
          : [];
        if (body.decision === "approved") {
          // flyerApprovalBlockReason checks more than "url is set": a real
          // render_status, a trusted https url, a real storage_path (proof
          // it actually went through finalize_flyer_render, not a
          // hand-crafted content blob with a forged url), a supported
          // mime, and that it isn't quarantined. Every reviewAssets row
          // reflects THIS item's current active asset (same fetch used
          // above), so there's no separate "superseded revision" case to
          // check here — a stale asset is never what gets read back.
          for (const a of reviewAssets) {
            const blockReason = flyerApprovalBlockReason(a);
            if (blockReason) return json(409, { error: blockReason });
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
              if (Array.isArray(a?.content?.brand_traits_used)) brandTraits.push(...a.content.brand_traits_used);
              if (Array.isArray(a?.content?.visual_traits_used)) visualTraits.push(...a.content.visual_traits_used);
            }
            if (brandTraits.length) {
              const { preferences: currentBrand } = await loadBrandBrain(client, shopId);
              const nextBrand = recordBrandSignal(currentBrand, { traits: brandTraits, signal: body.decision });
              await saveBrandBrain(client, shopId, nextBrand);
            }
            if (visualTraits.length) {
              const { preferences: currentVisual } = await loadStyleMemory(client, shopId);
              const nextVisual = recordVisualStyleApprovalSignal(currentVisual, {
                traits: visualTraits,
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

        const shopRow = await client.from("shops").select("name,phone,primary_color").eq("id", shopId).maybeSingle();
        const shopName = shopRow.data?.name || null;
        const appliedTraits = deriveRevisionTraits(instruction, ownDeltas);

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
          const priorVisualBrief = currentAsset.content?.visual_brief || currentItem.data.brief;
          const visualBrief = buildImageRevisionBrief({ instruction, priorVisualBrief });
          const prompt = buildImagePrompt({ occasion: currentItem.data.title, shopName, visualBrief });
          const imageGen = await generateImage(client, shopId, { prompt, filename: `marketing-revision-${body.content_item_id}-${Date.now()}.jpg` });
          if (!imageGen.ok) return json(400, { error: imageGen.error });
          const mediaRow = await client
            .from("website_media")
            .insert({ shop_id: shopId, storage_path: imageGen.path, filename: imageGen.path.split("/").pop(), source: "generated", mime: "image/jpeg" })
            .select()
            .single();
          // A visual-only revision never touches the caption/copy — only
          // an explicit wording instruction on a social_copy asset does.
          const persisted = await persistGeneratedAsset(client, {
            shopId,
            userId: user.id,
            persona: "Lily",
            assetType: "image",
            provider: imageGen.provider,
            model: imageGen.model,
            prompt: imageGen.prompt,
            content: {
              url: imageGen.url,
              caption: currentAsset.content?.caption || null,
              visual_brief: visualBrief,
              brand_traits_used: [],
              visual_traits_used: appliedTraits,
              revision_instruction: instruction,
              revision_traits: appliedTraits
            },
            mediaId: mediaRow.data?.id || null,
            parentAssetId: currentAsset.id,
            status: "completed"
          });
          if (!persisted.ok) throw new Error(persisted.error);
          await repointVariants(persisted.asset.id, {
            caption: currentAsset.content?.caption || null,
            aiContentType: "generative_image",
            generativeImageUsed: true
          });
          await writeCommandAudit(client, user.id, "marketing_content_revised", { shopId, targetType: "marketing_content_items", targetId: body.content_item_id, assetType: "image" });
          return json(200, {
            item: { id: currentItem.data.id, status: currentItem.data.status },
            asset: { id: persisted.asset.id, type: "image", url: imageGen.url, parent_asset_id: currentAsset.id, content: persisted.asset.content }
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
          }

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
            const groundedFlowerNames = Array.isArray(currentAsset.content?.grounded_in_inventory)
              ? currentAsset.content.grounded_in_inventory.map((i) => i.name).filter(Boolean)
              : [];
            const backgroundPrompt = buildFlyerBackgroundPrompt({
              occasion: currentItem.data.title,
              brandColor: shopRow.data?.primary_color || null,
              groundedFlowers: groundedFlowerNames,
              // "Regenerate image" must ask for a genuinely different
              // composition, not just resend the same instruction and hope
              // the model's own sampling varies it — Date.now() guarantees
              // a fresh, different composition instruction on every call.
              variationSeed: Date.now()
            });
            const backgroundGen = await generateImage(client, shopId, {
              prompt: backgroundPrompt,
              filename: `flyer-background-${body.content_item_id}-${Date.now()}.jpg`
            });
            if (backgroundGen.ok) {
              backgroundFields = { style_tier: "generated", background_url: backgroundGen.url };
              renderStale = true;
            }
          }

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
              ...(renderStale ? { url: null, storage_path: null, mime: null, width: null, height: null, render_status: null, rendered_at: null } : {})
            },
            parentAssetId: currentAsset.id,
            status: "completed"
          });
          if (!persisted.ok) throw new Error(persisted.error);
          await repointVariants(persisted.asset.id, { caption: gen.content.body, hashtags: gen.content.hashtags || [], aiContentType: "none" });
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
            const persisted = await persistGeneratedAsset(client, {
              shopId, userId: user.id, persona: "Lily", assetType: "video_concept", model: gen.model,
              content: { ...gen.content, revision_instruction: instruction, revision_traits: appliedTraits },
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
          const persisted = await persistGeneratedAsset(client, {
            shopId, userId: user.id, persona: "Lily", assetType: "social_copy", provider: "cloudflare", model: gen.model,
            content: {
              headline: gen.content.headline, body: gen.content.body, cta: gen.content.cta, hashtags: gen.content.hashtags,
              brand_traits_used: gen.content.brand_traits_used, visual_traits_used: gen.content.visual_traits_used,
              revision_instruction: instruction, revision_traits: appliedTraits
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
        const aiContentType = parentAsset.asset_type === "image" && parentAsset.content?.url ? "generative_image" : "none";

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

        const variantsResult = await client
          .from("marketing_platform_variants")
          .select("id,platform")
          .eq("content_item_id", body.content_item_id)
          .eq("shop_id", shopId);
        if (variantsResult.error) throw variantsResult.error;
        const variants = variantsResult.data || [];

        // Priority 8/2: a real pre-spend budget gate — estimate what THIS
        // generation would cost (copy always; +image for anything but a
        // video concept/text post — matches exactly what the branches
        // below actually bill via recordUsage) and refuse before any real
        // provider call if the effective cap would be exceeded. The
        // effective cap combines the shop's persisted default (once
        // 20260828000000_marketing_studio_budget_controls.sql is applied
        // — degrades to "none" until then) with an optional caller-
        // supplied budget_cap_cents override, which can be stricter but
        // can never be used to exceed a configured shop hard cap.
        {
          const estimatedAdditionalCents =
            (estimateCostCents({ purpose: "copy", unitType: "request", units: 1 }) || 0) +
            (VIDEO_CONTENT_TYPES.has(currentItem.data.content_type) || currentItem.data.content_type === "text_post"
              ? 0
              : estimateCostCents({ purpose: "image", unitType: "image", units: 1 }) || 0);
          const budgetCheck = await checkMonthlyBudgetForRequest(client, {
            shopId,
            additionalCostCents: estimatedAdditionalCents,
            requestedCapCents: body.budget_cap_cents != null ? Number(body.budget_cap_cents) : null
          });
          if (!budgetCheck.allowed) {
            if (budgetCheck.reason === "budget_check_failed" || budgetCheck.reason === "shop_budget_lookup_failed") throw new Error(budgetCheck.error);
            return json(400, {
              error: `Generating this would bring this month's committed spend to $${(budgetCheck.wouldBeCents / 100).toFixed(2)}, over the $${(budgetCheck.capCents / 100).toFixed(2)} budget cap (${budgetCheck.capSource === "shop_default" ? "this shop's configured default" : "the budget given for this request"}) — nothing was generated.`,
              current_spend_cents: budgetCheck.currentSpendCents,
              would_be_cents: budgetCheck.wouldBeCents,
              cap_cents: budgetCheck.capCents,
              cap_source: budgetCheck.capSource
            });
          }
        }

        // Lock the row before any real generation call so a concurrent
        // request can't double-generate (and double-bill) the same item.
        await client
          .from("marketing_content_items")
          .update({ status: "generating", updated_at: new Date().toISOString() })
          .eq("id", body.content_item_id)
          .eq("shop_id", shopId);

        async function revertToIdea() {
          await client
            .from("marketing_content_items")
            .update({ status: "idea", updated_at: new Date().toISOString() })
            .eq("id", body.content_item_id)
            .eq("shop_id", shopId);
        }

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
        const shopRow = await client.from("shops").select("name,phone,primary_color,accent_color").eq("id", shopId).maybeSingle();
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
        const { brandVoiceSummary, visualStyleSummary, inventorySummary, inventorySources, audienceSummary } = await loadGenerationGrounding(client, shopId, {
          needs: ["brand", "style", "inventory", "audience"]
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
            audienceSummary
          });
          if (!gen.ok) {
            await revertToIdea();
            return json(400, { error: gen.error });
          }
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
            content: { ...gen.content, grounded_in_inventory: inventorySources },
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
              visual_traits_used: []
            }
          };
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
            audienceSummary
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
          // One bounded retry, with the specific reasons handed back to the
          // model. Not a rejection: this is a quality failure, not a safety
          // one, and leaving the florist with an error and no post would be
          // the worse outcome. The second attempt is used either way, having
          // been told exactly what was wrong with the first.
          const copyQuality = (content) =>
            detectWeakMarketingCopy(
              currentItem.data.brief,
              `${content.headline} ${content.body}`,
              { shopPhone: shopRow.data?.phone, shopName }
            );
          const weakness = copyQuality(copyGen.content);
          if (weakness.length) {
            await recordUsage("copy", "request", 1);
            const retry = await generateSocialPost({
              ...socialPostArgs,
              requestText:
                `${currentItem.data.brief}\n\nA previous attempt was rejected for these reasons — do not repeat them:\n- ${weakness.join("\n- ")}`
            });
            // The retry is not automatically the better one. Handed its own
            // faults back, a model can fix the named phrase and introduce two
            // more, and the florist would have been shown the worse of the two
            // drafts with no way to know a better one existed. Keep whichever
            // attempt actually has fewer problems; a tie keeps the retry, since
            // it is the one that was told what was wrong.
            if (retry.ok && retry.content?.body && copyQuality(retry.content).length <= weakness.length) {
              copyGen = retry;
            }
          }
          // Reactive safety net for the rare case that reaches here at
          // all — requestSignalsPlainOperationalNotice already said this
          // ISN'T a plain notice (a sale/event framing, most often), so an
          // AI paraphrase is legitimately expected; this still catches an
          // outright invented/mismatched result and recovers with the
          // same deterministic content when the request's own facts allow
          // it — never reverting the florist to idea when a safe fallback
          // exists, only when genuinely nothing can be built from.
          if (
            detectPermanentClosureMismatch(currentItem.data.brief, `${copyGen.content.headline} ${copyGen.content.body}`) ||
            detectInventedOperationalContent(currentItem.data.brief, `${copyGen.content.headline} ${copyGen.content.body}`)
          ) {
            const rescueFallback = buildDeterministicNoticeContent({ requestText: currentItem.data.brief, shopName, shopPhone: shopRow.data?.phone });
            if (!rescueFallback) {
              await revertToIdea();
              return json(400, {
                error:
                  "That came back with wording that didn't match your request, and there wasn't enough in your message (a time, a phone number) for Lily to build a safe version automatically — nothing was saved. Add those details and try Generate again."
              });
            }
            noticeFallback = rescueFallback;
            copyGen.content.headline = rescueFallback.headline;
            copyGen.content.body = rescueFallback.caption;
            copyGen.content.cta = rescueFallback.cta;
            copyGen.content.hashtags = [];
            copyGen.content.brand_traits_used = [];
            copyGen.content.visual_traits_used = [];
          }
        }

        let assetId = null;
        let imageUrl = null;
        let generatedAssetType = null;
        if (currentItem.data.content_type !== "text_post") {
          // Live defect fix: a request whose important information NEEDS
          // to be visible and exact on the graphic (a closing time, a
          // phone number, a price, an announcement) must never be handed
          // to the AI image model as words to paint — a diffusion model
          // can't spell, and produces garbled nonsense instead of the real
          // business text. Route those requests to Florisyn's own
          // deterministic flyer renderer instead (generateFlyerContent +
          // public/flyer-renderer.js, already built and tested, previously
          // wired only into the older general-Lily-chat path — this wires
          // it into Marketing Studio's real generate_content for the first
          // time). An ordinary decorative/celebratory request with no such
          // signal keeps using a plain photo-only image, with no on-image
          // text ever asked of the model (see buildImagePrompt's own
          // unconditional no-text guarantee).
          if (requestNeedsFlyerWording(currentItem.data.brief)) {
            let flyerGen;
            if (noticeFallback) {
              // The caption already needed the safe deterministic fallback
              // — this request's topic is safety-sensitive, so the on-image
              // text uses the SAME safe wording rather than risking a
              // second, independent AI call that could invent something
              // different (or differently wrong). No API call, no usage
              // charged for one that didn't happen.
              flyerGen = { ok: true, model: "deterministic", content: { headline: noticeFallback.headline, body: noticeFallback.body, cta: noticeFallback.cta } };
            } else {
              await recordUsage("copy", "request", 1);
              flyerGen = await generateFlyerContent({
                persona: "Lily",
                message: currentItem.data.brief,
                occasion: currentItem.data.title,
                shop: { name: shopName }
              });
              // The flyer is where a wording failure does the most damage —
              // it is the picture that gets shared, long after the caption
              // scrolls away. Ashley was shown one reading "Funeral / SERVICES
              // AVAILABLE" above her shop name and phone number: "it reads
              // like I'm going to hold funeral services here at the flower
              // shop." One bounded retry with the reason handed back.
              if (flyerGen.ok && flyerGen.content) {
                const flyerQuality = (content) =>
                  detectWeakMarketingCopy(
                    currentItem.data.brief,
                    `${content.headline} ${content.body} ${content.cta}`,
                    // The headline is passed separately because it is judged
                    // separately: it is the largest thing on the flyer and the
                    // first thing read, and "Funeral Flowers Available" is a
                    // fault of the headline alone that no reading of the whole
                    // text can see.
                    { shopPhone: shopRow.data?.phone, shopName, headline: content.headline }
                  );
                const flyerWeakness = flyerQuality(flyerGen.content);
                if (flyerWeakness.length) {
                  await recordUsage("copy", "request", 1);
                  const flyerRetry = await generateFlyerContent({
                    persona: "Lily",
                    message: `${currentItem.data.brief}\n\nA previous attempt was rejected for these reasons — do not repeat them:\n- ${flyerWeakness.join("\n- ")}`,
                    occasion: currentItem.data.title,
                    shop: { name: shopName }
                  });
                  // Same reasoning as the caption retry above: this wording is
                  // printed on the graphic itself, where a florist cannot edit
                  // it before it goes out, so shipping the worse of two drafts
                  // matters more here, not less.
                  if (
                    flyerRetry.ok &&
                    flyerRetry.content?.headline &&
                    flyerQuality(flyerRetry.content).length <= flyerWeakness.length
                  ) {
                    flyerGen = flyerRetry;
                  }
                }
              }
              if (!flyerGen.ok) {
                await revertToIdea();
                return json(400, { error: flyerGen.error });
              }
              // Real, live-found failure: the flyer's own on-image wording
              // (what a florist actually sees printed on the graphic) is a
              // SEPARATE generation call from the Facebook caption above —
              // checked independently here for the exact same failure
              // modes, with the exact same safe-fallback recovery (never a
              // dead-end revert to idea) since a florist can just as easily
              // hit this on the flyer text alone.
              const flyerText = `${flyerGen.content.headline} ${flyerGen.content.body} ${flyerGen.content.cta}`;
              if (
                detectPermanentClosureMismatch(currentItem.data.brief, flyerText) ||
                detectInventedOperationalContent(currentItem.data.brief, flyerText)
              ) {
                const flyerFallback = buildDeterministicNoticeContent({ requestText: currentItem.data.brief, shopName, shopPhone: shopRow.data?.phone });
                if (!flyerFallback) {
                  await revertToIdea();
                  return json(400, {
                    error:
                      "The flyer text came back with wording that didn't match your request, and there wasn't enough in your message for Lily to build a safe version automatically — nothing was saved. Add a time/phone number and try Generate again."
                  });
                }
                flyerGen.content.headline = flyerFallback.headline;
                flyerGen.content.body = flyerFallback.body;
                flyerGen.content.cta = flyerFallback.cta;
              }
            }
            const template = pickFlyerTemplate({ occasion: currentItem.data.title });
            const aspectRatio = pickAspectRatio(primaryPlatform);
            // Tier A by default (a real, photographic floral background —
            // Ashley's explicit design direction: the default flyer must
            // never be a flat brand-color rectangle) — falls back to Tier B
            // (the template's own brand palette, drawn by
            // paintBrandBackground/paintFloralAccents in the renderer)
            // automatically and silently if the image call fails for any
            // reason (no credentials, provider error, budget cap). This is
            // never allowed to fail generate_content itself or touch a
            // single word of the deterministic text above — the exact
            // wording is Florisyn's own and never depends on this call
            // succeeding. Real shop inventory grounds the flowers shown
            // when it's actually available and relevant; otherwise the
            // prompt stays general-seasonal and never implies availability.
            const groundedFlowerNames = (inventorySources || []).map((i) => i.name).filter(Boolean);
            // One bounded retry (see generateFlyerBackgroundWithRetry): a
            // flyer with no photograph can never meet the bright/colourful
            // floral standard, so a single transient provider failure is
            // worth one more attempt — asking for a DIFFERENT composition
            // rather than resending the identical prompt. Still never
            // fails generate_content itself, and never touches a word of
            // the deterministic wording above.
            const backgroundGen = await generateFlyerBackgroundWithRetry(client, shopId, {
              promptFor: (attempt) =>
                buildFlyerBackgroundPrompt({
                  visualBrief: copyGen.content.visual_brief,
                  occasion: currentItem.data.title,
                  brandColor: shopRow.data?.primary_color || null,
                  groundedFlowers: groundedFlowerNames,
                  variationSeed: attempt
                }),
              filenameFor: (attempt) =>
                attempt === 0
                  ? `flyer-background-${body.content_item_id}.jpg`
                  : `flyer-background-${body.content_item_id}-retry${attempt}.jpg`
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
                // "image" asset type already uses (content.caption vs. the
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
                brand: { shopName, phone: shopRow.data?.phone || null, primaryColor: shopRow.data?.primary_color || null, accentColor: shopRow.data?.accent_color || null },
                brand_traits_used: copyGen.content.brand_traits_used,
                visual_traits_used: copyGen.content.visual_traits_used,
                grounded_in_inventory: inventorySources
              },
              status: "completed"
            });
            if (!persisted.ok) {
              await revertToIdea();
              throw new Error(persisted.error);
            }
            assetId = persisted.asset.id;
            generatedAssetType = "flyer";
          } else {
            await recordUsage("image", "image", 1);
            // No separate inventory wiring needed here: this call always
            // supplies visualBrief (from copyGen, itself already grounded in
            // real inventory above), so buildImagePrompt's own products
            // fallback path never runs — the grounding already reached the
            // image through the copy's visual_brief.
            const prompt = buildImagePrompt({ occasion: currentItem.data.title, shopName, visualBrief: copyGen.content.visual_brief || currentItem.data.brief });
            const imageGen = await generateImage(client, shopId, { prompt, filename: `marketing-${body.content_item_id}.jpg` });
            if (!imageGen.ok) {
              await revertToIdea();
              return json(400, { error: imageGen.error });
            }
            const mediaRow = await client
              .from("website_media")
              .insert({ shop_id: shopId, storage_path: imageGen.path, filename: imageGen.path.split("/").pop(), source: "generated", mime: "image/jpeg" })
              .select()
              .single();
            const persisted = await persistGeneratedAsset(client, {
              shopId,
              userId: user.id,
              persona: "Lily",
              assetType: "image",
              provider: imageGen.provider,
              model: imageGen.model,
              prompt: imageGen.prompt,
              // brand_traits_used/visual_traits_used ride along on this same
              // asset row — approve_content reads them back from here (via
              // the variant's asset_id) to reinforce/weaken Brand Brain and
              // My Style the moment a real Approve/Reject happens. Never
              // recorded here at generation time — recordBrandSignal/
              // recordApprovalSignal only ever fire from a real approval
              // decision, never a bare generation.
              content: { url: imageGen.url, caption: copyGen.content.body, brand_traits_used: copyGen.content.brand_traits_used, visual_traits_used: copyGen.content.visual_traits_used, grounded_in_inventory: inventorySources },
              mediaId: mediaRow.data?.id || null,
              status: "completed"
            });
            if (!persisted.ok) {
              await revertToIdea();
              throw new Error(persisted.error);
            }
            assetId = persisted.asset.id;
            imageUrl = imageGen.url;
            generatedAssetType = "image";
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
              grounded_in_inventory: inventorySources
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
          // a real rendered image — a flyer's Tier-B template background is
          // NOT a generative image (it's Florisyn's own deterministic
          // render), so it correctly reads "none" here exactly like a
          // text_post's asset does, per generatedAssetType rather than the
          // old imageUrl-only check.
          for (const v of variants) {
            await client
              .from("marketing_platform_variants")
              .update({
                asset_id: assetId,
                caption: copyGen.content.body,
                hashtags: copyGen.content.hashtags || [],
                ...computeDisclosureFields({
                  platform: v.platform,
                  generativeImageUsed: Boolean(imageUrl),
                  aiContentType: imageUrl ? "generative_image" : "none"
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
        return json(200, { item: updated.data, asset: assetId ? { id: assetId, type: generatedAssetType, url: imageUrl } : null, copy: copyGen.content });
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
