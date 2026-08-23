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
import { isFeatureEnabled } from "./_shared/feature-flags.js";
import {
  platformAdmin,
  requireSuperAdmin,
  platformAdminErrorResponse,
  platformAdminError,
  parsePlatformAdminJsonBody,
  writeCommandAudit
} from "./_shared/platform-admin.js";
import {
  loadBrandBrain,
  saveBrandBrain,
  applyExplicitBrandUpdates,
  forgetBrandTrait,
  resetPreferences,
  buildBrandSummary
} from "./_shared/marketing-brand-brain.js";
import {
  SUPPORTED_PLATFORMS,
  isPlatformLive,
  isPlatformConfigured,
  platformOAuthEnvVarNames,
  notLiveSocialProvider
} from "./_shared/marketing-social-providers.js";
import { selectCloneProvider, notLiveCloneProvider, buildConfiguredCloneProviderRegistry } from "./_shared/marketing-clone-providers.js";
import { uploadClonedVoiceAudio, uploadWebsiteMedia, publicWebsiteMediaUrl } from "./_shared/website-media.js";
import { parseDataUrl } from "./_shared/upload-validation.js";
import {
  classifyPublishFailure,
  nextJobStateAfterFailure,
  isJobDue,
  buildIdempotencyKey
} from "./_shared/marketing-publishing-queue.js";
import { COST_CONFIG_VERSION, DEFAULT_MONTHLY_ALLOWANCE, estimateCostCents } from "./_shared/marketing-cost-config.js";
import {
  buildMonthlyContentPlan,
  CONTENT_ITEM_APPROVABLE_STATUSES,
  resolveApprovalDecision
} from "./_shared/marketing-content-planner.js";
import { validateCloneConsentBody, isConsentActive } from "./_shared/marketing-clone-consent.js";
import { buildContentCalendarEvents, groupCalendarEventsByMonth } from "../../lib/marketing/calendar-events.js";
import { generateSocialPost, generateVideoConcept, persistGeneratedAsset } from "./_shared/ai-creative-engine.js";
import { generateImage, buildImagePrompt } from "./_shared/ai-image-engine.js";
import { buildMarketingStudioAnalyticsSummary } from "./_shared/marketing-analytics.js";
import { groupMetricsByDimension } from "./_shared/marketing-insights.js";
import { validateExperimentBody, determineExperimentWinner } from "./_shared/marketing-ab-testing.js";

const VIDEO_CONTENT_TYPES = new Set(["reel", "short_video", "long_video"]);

function featureGate() {
  if (!isFeatureEnabled("MARKETING_STUDIO")) {
    throw platformAdminError("forbidden");
  }
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

function friendlyMissing() {
  const err = new Error(
    "Marketing Studio tables are not set up yet. Apply the marketing studio foundation migration, then try again."
  );
  err.statusCode = 503;
  err.florisynCode = "unexpected";
  return err;
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

/** Test seam — production uses bound real dependencies via exported `handler`. */
export function createMarketingStudioHandler(deps = {}) {
  return async function handler(event) {
    try {
      featureGate();
      const { client, user, admin } = await platformAdmin(event, ["super_admin"], deps);
      const method = event.httpMethod;
      const qs = event.queryStringParameters || {};
      const body = parsePlatformAdminJsonBody(event);
      const action = String(body.action || qs.action || "status").toLowerCase();

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
        return json(200, {
          items: rows,
          estimated_total_cents: estimatedTotalCents,
          actual_total_cents: actualTotalCents,
          cost_config_version: COST_CONFIG_VERSION
        });
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
          const variantsResult = await client
            .from("marketing_platform_variants")
            .select("id,content_item_id,platform,status,scheduled_at,published_at,external_permalink")
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
        return json(200, { items: (data || []).map((item) => ({ ...item, variants: byItem.get(item.id) || [] })) });
      }

      if (action === "approve_content" && method === "POST") {
        requireSuperAdmin(admin);
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
        const updated = await client
          .from("marketing_content_items")
          .update({ status: nextStatus, updated_at: new Date().toISOString() })
          .eq("id", body.content_item_id)
          .eq("shop_id", shopId)
          .select("id,status")
          .single();
        if (updated.error) throw updated.error;
        await writeCommandAudit(client, user.id, "marketing_content_review", {
          shopId,
          targetType: "marketing_content_items",
          targetId: body.content_item_id,
          decision: body.decision,
          nextStatus
        });
        return json(200, { item: updated.data });
      }

      // Stage D — real creative generation for one planned content item.
      // image_post/story/carousel: a real image (Cloudflare) + real copy.
      // reel/short_video/long_video: a real script/storyboard/captions —
      // never a rendered video (no video/AI Clone provider is connected;
      // see marketing-video renderingAvailable:false on the returned
      // asset). Only runs from status 'idea' — refuses to silently
      // re-generate (and re-bill) an item that already has creative.
      if (action === "generate_content" && method === "POST") {
        requireSuperAdmin(admin);
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

        const shopRow = await client.from("shops").select("name").eq("id", shopId).maybeSingle();
        const shopName = shopRow.data?.name || null;
        const primaryPlatform = variants[0]?.platform || "facebook";

        if (VIDEO_CONTENT_TYPES.has(currentItem.data.content_type)) {
          await recordUsage("copy", "request", 1);
          const gen = await generateVideoConcept({
            persona: "Lily",
            channel: primaryPlatform,
            occasion: currentItem.data.title,
            shop: { name: shopName },
            requestText: currentItem.data.brief
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
            content: gen.content,
            status: "completed"
          });
          if (!persisted.ok) {
            await revertToIdea();
            throw new Error(persisted.error);
          }
          if (variants.length) {
            await client
              .from("marketing_platform_variants")
              .update({ asset_id: persisted.asset.id, caption: gen.content.script || gen.content.concept || null, hashtags: gen.content.hashtags || [] })
              .eq("content_item_id", body.content_item_id)
              .eq("shop_id", shopId);
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

        await recordUsage("copy", "request", 1);
        const copyGen = await generateSocialPost({
          persona: "Lily",
          channel: primaryPlatform,
          occasion: currentItem.data.title,
          shop: { name: shopName },
          requestText: currentItem.data.brief
        });
        if (!copyGen.ok) {
          await revertToIdea();
          return json(400, { error: copyGen.error });
        }

        let assetId = null;
        let imageUrl = null;
        if (currentItem.data.content_type !== "text_post") {
          await recordUsage("image", "image", 1);
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
            content: { url: imageGen.url, caption: copyGen.content.body },
            mediaId: mediaRow.data?.id || null,
            status: "completed"
          });
          if (!persisted.ok) {
            await revertToIdea();
            throw new Error(persisted.error);
          }
          assetId = persisted.asset.id;
          imageUrl = imageGen.url;
        }

        if (variants.length) {
          await client
            .from("marketing_platform_variants")
            .update({ asset_id: assetId, caption: copyGen.content.body, hashtags: copyGen.content.hashtags || [] })
            .eq("content_item_id", body.content_item_id)
            .eq("shop_id", shopId);
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
          assetType: "image"
        });
        return json(200, { item: updated.data, asset: assetId ? { id: assetId, type: "image", url: imageUrl } : null, copy: copyGen.content });
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
          return json(200, { kind: "video", jobId: result.jobId, status: result.status });
        } catch (error) {
          return json(502, { error: error.message });
        }
      }

      // Polls a HeyGen video-render job started by generateVideo/preview's
      // video path. Voice-only previews never produce a jobId (synthesis is
      // synchronous), so this only ever matters for the avatar-video path.
      if (action === "clone_job_status") {
        const shopId = requireShopId(qs, body);
        if (!qs.job_id && !body.job_id) return json(400, { error: "job_id is required." });
        const cloneRegistry = buildConfiguredCloneProviderRegistry({
          env: process.env,
          uploadAudio: (buffer, filename) => uploadClonedVoiceAudio(client, shopId, buffer, filename)
        });
        const provider = selectCloneProvider({}, cloneRegistry);
        if (provider === notLiveCloneProvider) {
          return json(200, { note: "NOT LIVE — PROVIDER CONNECTION REQUIRED. No avatar/voice provider is connected yet." });
        }
        try {
          const result = await provider.getJobStatus(qs.job_id || body.job_id);
          return json(200, result);
        } catch (error) {
          return json(502, { error: error.message });
        }
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
        await writeCommandAudit(client, user.id, "marketing_clone_consent_revoked", {
          shopId,
          targetType: "marketing_clone_consent",
          targetId: body.consent_id
        });
        return json(200, { ok: true, consent_id: body.consent_id });
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

        const now = new Date();
        const dueResult = await client
          .from("marketing_publishing_jobs")
          .select("id,platform_variant_id,status,attempts,max_attempts,next_attempt_at")
          .eq("shop_id", shopId)
          .eq("status", "queued")
          .lte("next_attempt_at", now.toISOString())
          .order("next_attempt_at", { ascending: true })
          .limit(limit);
        if (dueResult.error) {
          if (missingRelation(dueResult.error)) throw friendlyMissing();
          throw dueResult.error;
        }
        const dueJobs = (dueResult.data || []).filter((j) => isJobDue(j, now));

        const results = [];
        for (const job of dueJobs) {
          const variantResult = await client
            .from("marketing_platform_variants")
            .select("id,platform,caption,scheduled_at")
            .eq("id", job.platform_variant_id)
            .maybeSingle();
          const variant = variantResult.data;
          const platform = variant?.platform;
          const provider = notLiveSocialProvider(platform);

          let outcome;
          try {
            await provider.publish(variant || {});
            // Unreachable today (every provider is not-live), kept so a
            // real adapter's success path is already wired correctly.
            await client.from("marketing_publishing_jobs").update({ status: "succeeded", attempts: job.attempts + 1, updated_at: new Date().toISOString() }).eq("id", job.id);
            await client.from("marketing_platform_variants").update({ status: "published", published_at: new Date().toISOString() }).eq("id", job.platform_variant_id);
            outcome = "succeeded";
          } catch (error) {
            const kind = classifyPublishFailure(error);
            const next = nextJobStateAfterFailure({ attempts: job.attempts, maxAttempts: job.max_attempts, kind });
            const nextAttemptAt = next.delaySeconds != null ? new Date(now.getTime() + next.delaySeconds * 1000).toISOString() : job.next_attempt_at;
            await client
              .from("marketing_publishing_jobs")
              .update({
                status: next.status,
                attempts: next.attempts,
                next_attempt_at: nextAttemptAt,
                last_error: String(error?.message || error).slice(0, 500),
                last_error_code: kind,
                updated_at: new Date().toISOString()
              })
              .eq("id", job.id);
            if (next.status === "failed" || next.status === "dead_letter") {
              await client
                .from("marketing_platform_variants")
                .update({ status: "failed", last_error: String(error?.message || error).slice(0, 500) })
                .eq("id", job.platform_variant_id);
            }
            outcome = next.status;
          }
          results.push({ job_id: job.id, platform_variant_id: job.platform_variant_id, platform: platform || null, outcome });
        }

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
        // Credentials exist, but the real OAuth authorize/callback exchange
        // for this platform isn't implemented — guessing at each
        // platform's exact authorize URL/scopes without a real registered,
        // approved app to test against risks claiming an integration works
        // before it does (Section 40). Building this out is the next real
        // step once real credentials are actually configured.
        return json(200, {
          configured: true,
          message: `Credentials are present for ${platform}, but the OAuth connect flow itself is not implemented yet — this is the next real step, not a working connection.`
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
          client.from("marketing_performance_metrics").select("platform,metric_name,raw_value,source").eq("shop_id", shopId)
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
            metricRows: metricsResult.data || []
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
          .select("platform,raw_value,source")
          .eq("shop_id", shopId)
          .eq("metric_name", metricName)
          .eq("source", "platform_api");
        if (metricsResult.error) {
          if (missingRelation(metricsResult.error)) throw friendlyMissing();
          throw metricsResult.error;
        }
        const rows = (metricsResult.data || []).map((r) => ({ platform: r.platform, value: r.raw_value }));
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

        const contentItemIds = experiment.variants.map((v) => v.content_item_id).filter(Boolean);
        const variantsResult = contentItemIds.length
          ? await client.from("marketing_platform_variants").select("id,content_item_id").in("content_item_id", contentItemIds)
          : { data: [], error: null };
        if (variantsResult.error) throw variantsResult.error;
        const platformVariantIds = (variantsResult.data || []).map((v) => v.id);
        const variantIdToContentItem = new Map((variantsResult.data || []).map((v) => [v.id, v.content_item_id]));

        let metricRows = [];
        if (platformVariantIds.length) {
          const metricsResult = await client
            .from("marketing_performance_metrics")
            .select("platform_variant_id,raw_value,source")
            .in("platform_variant_id", platformVariantIds)
            .eq("metric_name", experiment.metric)
            .eq("source", "platform_api");
          if (metricsResult.error) throw metricsResult.error;
          metricRows = metricsResult.data || [];
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
