/**
 * Florisyn Marketing Studio — Founding Beta (admin-only) API surface.
 *
 * Stage B+C+D: Brand Brain read/write, connection status (never tokens),
 * usage/cost ledger summary, an honest `status` action, Stage C's monthly
 * content planner/calendar/approval workflow (plan_month/content_calendar/
 * list_content/approve_content), and Stage D's real creative generation
 * (generate_content — real image+copy today, real script/storyboard for
 * video) plus AI Clone consent capture (request_clone_enrollment/
 * list_clone_consent/revoke_clone_consent). Actual video rendering,
 * avatar/voice training, and publishing land in Stage E — this file
 * intentionally does not fake any of that here.
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
import { SUPPORTED_PLATFORMS, isPlatformLive } from "./_shared/marketing-social-providers.js";
import { selectCloneProvider, notLiveCloneProvider } from "./_shared/marketing-clone-providers.js";
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
        return json(200, {
          marketing_studio_enabled: true,
          access: "admin_only_founding_beta",
          supported_platforms: SUPPORTED_PLATFORMS.map((platform) => ({
            platform,
            live: isPlatformLive(platform)
          })),
          cost_config_version: COST_CONFIG_VERSION,
          note: "NOT LIVE — PROVIDER CONNECTION REQUIRED. No social platform, AI Clone, or voice provider is connected yet (Stage B foundation only). See Stage E/D for provider onboarding."
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
      if (action === "request_clone_enrollment" && method === "POST") {
        requireSuperAdmin(admin);
        const shopId = requireShopId(qs, body);
        const validation = validateCloneConsentBody(body);
        if (!validation.valid) return json(400, { error: validation.error });

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

        const provider = selectCloneProvider({}, {});
        const enrollment = {};
        if (validation.sanitized.avatar_permission) {
          try {
            await provider.createAvatarProfile({ consentId: consent.data.id, personName: validation.sanitized.person_name });
            enrollment.avatar = { status: "ready" };
          } catch (error) {
            enrollment.avatar = { status: "not_live", error: error.message };
          }
        }
        if (validation.sanitized.voice_permission) {
          try {
            await provider.createVoiceProfile({ consentId: consent.data.id, personName: validation.sanitized.person_name });
            enrollment.voice = { status: "ready" };
          } catch (error) {
            enrollment.voice = { status: "not_live", error: error.message };
          }
        }

        await writeCommandAudit(client, user.id, "marketing_clone_consent_granted", {
          shopId,
          targetType: "marketing_clone_consent",
          targetId: consent.data.id
        });

        return json(201, {
          consent: consent.data,
          enrollment,
          note:
            provider === notLiveCloneProvider
              ? "NOT LIVE — PROVIDER CONNECTION REQUIRED. Consent is recorded and independently revocable, but no avatar/voice provider is connected yet — nothing was trained."
              : undefined
        });
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

      return methodNotAllowed();
    } catch (error) {
      return platformAdminErrorResponse(event, error);
    }
  };
}

export const handler = createMarketingStudioHandler();
