/**
 * Premium AI Creative — the real Netlify Background Function (Hybrid
 * Marketing Studio Batch 4, Part D).
 *
 * REAL PROVEN FAILURE THIS EXISTS TO FIX: a real staging Premium Creative
 * request 504'd because Netlify's synchronous Function execution limit
 * (60s, non-configurable) is shorter than GPT-Image-2's real generation
 * latency stacked behind generate_content's own grounding/copy/routing
 * work. marketing-studio.js's own generate_content handler no longer
 * calls provider.generate() for Premium Creative at all — it reserves
 * usage, creates a durable ai_execution_jobs row, and hands off to THIS
 * file, which is suffixed `-background` so Netlify runs it as a real
 * Background Function (responds fast, executes up to 15 minutes) instead
 * of a synchronous one.
 *
 * File-name suffix is the ENTIRE mechanism Netlify uses to route a
 * function to the Background Function runtime — no netlify.toml entry is
 * needed (unlike the Scheduled Function precedent in
 * marketing-scheduled-publisher.js, which needs an explicit `schedule`
 * key). A Background Function is invoked over plain HTTP exactly like any
 * other Netlify Function; Netlify's own platform is what returns a fast
 * 202 to the caller and keeps executing after that response is sent.
 *
 * Authorization: unlike the Scheduled Function (which Netlify's platform
 * itself refuses to let an outside caller reach directly), a Background
 * Function IS reachable at its normal public URL — Netlify does not gate
 * that path the way it gates a scheduled invocation. This file therefore
 * enforces its own shared-secret header (X-Premium-Job-Secret, checked
 * against MARKETING_PREMIUM_JOB_SECRET) and fails closed (refuses the
 * request) whenever that secret is missing or doesn't match — an external
 * caller can never trigger a real OpenAI spend by guessing a job id.
 *
 * Never a second OpenAI implementation: this loads all state fresh from
 * Supabase (a Background Function shares no memory with the request that
 * created the job), then calls the SAME executeReservedPremiumCreative
 * Generation() the synchronous path always used, which calls the SAME
 * OpenAI provider adapter — nothing here talks to OpenAI directly.
 */

import { admin as createServiceRoleClient } from "./_shared/supabase.js";
import { executeReservedPremiumCreativeGeneration } from "./_shared/marketing-premium-creative-orchestrator.js";
import {
  PREMIUM_JOB_TYPE,
  claimPremiumJobForExecution,
  markPremiumAttemptProviderStarting,
  markPremiumAttemptProviderFinished,
  settlePremiumJobCompleted,
  settlePremiumJobFailed
} from "./_shared/marketing-premium-creative-job.js";
import { persistGeneratedAsset } from "./_shared/ai-creative-engine.js";
import { pickFlyerTemplate, pickAspectRatio, ASPECT_RATIOS } from "./_shared/flyer-templates.js";
import { defaultVisualStyle } from "./_shared/ai-visual-revisions.js";
import { computeDisclosureFields } from "./_shared/creative-ai/disclosure-policy.js";
import { writeCommandAudit } from "./_shared/platform-admin.js";
import { structuredLog } from "./_shared/production.js";

function log(message, extra = {}) {
  console.warn(JSON.stringify({ level: "warn", fn: "marketing-premium-creative-background", message, ...extra }));
}

/** Test seam — production uses bound real dependencies via exported `handler`. */
export function createMarketingPremiumCreativeBackgroundHandler(deps = {}) {
  const getClient = deps.getClient || createServiceRoleClient;
  const execute = deps.executeReservedPremiumCreativeGeneration || executeReservedPremiumCreativeGeneration;
  const persistAsset = deps.persistGeneratedAsset || persistGeneratedAsset;

  return async function handler(event) {
    if (event?.httpMethod && event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    // Fail closed: no secret configured means this Background Function is
    // not safely deployable yet — never fall open to "no auth required."
    const configuredSecret = String(process.env.MARKETING_PREMIUM_JOB_SECRET || "").trim();
    const providedSecret = String(event?.headers?.["x-premium-job-secret"] || event?.headers?.["X-Premium-Job-Secret"] || "").trim();
    if (!configuredSecret || !providedSecret || providedSecret !== configuredSecret) {
      log("unauthorized_invocation");
      return { statusCode: 401, body: JSON.stringify({ error: "unauthorized" }) };
    }

    let payload;
    try {
      payload = event.body ? JSON.parse(event.body) : {};
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "invalid JSON body" }) };
    }
    const jobId = payload.jobId || payload.job_id;
    if (!jobId) return { statusCode: 400, body: JSON.stringify({ error: "jobId is required" }) };

    const client = getClient();

    // Part D idempotency: refuse duplicate execution outright. Whichever
    // invocation's atomic UPDATE actually wins ('planned' -> 'running') is
    // the only one that ever proceeds — a retried/duplicate Background
    // Function invocation for the SAME job simply finds `claimed:false`
    // and exits quietly, never calling the provider a second time.
    const claim = await claimPremiumJobForExecution(client, jobId);
    if (!claim.ok) {
      log("claim_query_failed", { jobId, error: claim.error });
      return { statusCode: 500, body: JSON.stringify({ error: "claim query failed" }) };
    }
    if (!claim.claimed) {
      log("claim_not_won", { jobId });
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true, reason: "already_claimed_or_terminal" }) };
    }
    const job = claim.job;

    if (job.job_type !== PREMIUM_JOB_TYPE) {
      log("wrong_job_type", { jobId, jobType: job.job_type });
      await settlePremiumJobFailed(client, jobId, { reason: "wrong_job_type" });
      return { statusCode: 400, body: JSON.stringify({ error: "not a premium creative job" }) };
    }

    const ctx = job.result || {};
    const contentItemId = ctx.content_item_id;
    const shopId = job.shop_id;
    const traceId = ctx.trace_id || null;
    const flyerCtx = ctx.flyer_asset_context || {};

    try {
      // Part D: confirm the job actually belongs to the shop it claims —
      // a defensive re-check, not the primary tenant boundary (that's the
      // shop_id column itself plus this service-role client's own scoped
      // queries below, every one of which filters on shop_id explicitly).
      if (!shopId || !contentItemId) {
        await settlePremiumJobFailed(client, jobId, { reason: "job_missing_context" });
        log("job_missing_context", { jobId, shopId, contentItemId });
        return { statusCode: 200, body: JSON.stringify({ ok: false, error: "job missing shop/content context" }) };
      }

      const generation = await execute({
        client,
        shopId,
        contentItemId,
        canonicalConcept: ctx.canonical_concept,
        creativeDirection: ctx.creative_direction,
        factSafeCopyPlan: ctx.fact_safe_copy_plan || {},
        verifiedShopBrandData: ctx.verified_shop_brand_data || {},
        aspectRatio: ctx.aspect_ratio || "1:1",
        qualityTier: ctx.quality_tier || "medium",
        traceId,
        filename: ctx.filename || null,
        reservationId: job.plan?.[job.plan.length - 1]?.usage_id,
        initialDiagnostic: null,
        env: process.env,
        providerFactory: deps.providerFactory || null,
        // Part E: durable pre/post markers on the job's own attempt —
        // committed to Supabase BEFORE the outbound fetch (onBeforeProviderCall)
        // and again once it returns (onAfterProviderCall), so a hard
        // process death is distinguishable at exactly the granularity Part
        // F requires (RESERVED_NOT_STARTED vs PROVIDER_STARTED_UNKNOWN_RESULT
        // vs a known PROVIDER_FAILED/PROVIDER_SUCCEEDED).
        onBeforeProviderCall: async (diag) => {
          await markPremiumAttemptProviderStarting(client, jobId, {
            job_id: jobId,
            trace_id: traceId,
            reservation_id: job.plan?.[job.plan.length - 1]?.usage_id || null,
            provider: diag.provider?.name || null,
            model: diag.provider?.model || null,
            attempt_index: job.plan?.[job.plan.length - 1]?.attempt_index ?? 0
          });
        },
        onAfterProviderCall: async (diag) => {
          await markPremiumAttemptProviderFinished(client, jobId, {
            provider_http_status: diag.execution?.provider_http_status ?? null,
            provider_result_ok: diag.execution?.provider_result_ok ?? null
          });
        }
      });

      structuredLog("info", "marketing_premium_creative_background_execute", {
        traceId,
        jobId,
        ok: generation.ok,
        state: generation.state
      });

      if (!generation.ok) {
        await settlePremiumJobFailed(client, jobId, { reason: generation.reason || generation.state || "provider_call_failed" });
        await client
          .from("marketing_content_items")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", contentItemId)
          .eq("shop_id", shopId)
          .eq("status", "generating");
        return { statusCode: 200, body: JSON.stringify({ ok: false, jobId, state: generation.state }) };
      }

      // Success — persist the real final asset. This mirrors, field for
      // field, the flyer-persistence block generate_content's own
      // synchronous path always used for a successful Premium Creative
      // generation (see marketing-studio.js's own history) — never a
      // second, independently-drifting persistence shape.
      const currentItem = await client.from("marketing_content_items").select("id,title").eq("id", contentItemId).eq("shop_id", shopId).maybeSingle();
      if (currentItem.error) throw currentItem.error;
      const occasionTitle = flyerCtx.occasion_title || currentItem.data?.title || "";
      const shopRow = await client.from("shops").select("name,phone,primary_color,accent_color,city,state,logo_url").eq("id", shopId).maybeSingle();
      if (shopRow.error) throw shopRow.error;

      const primaryPlatform = flyerCtx.primary_platform || "facebook";
      const template = pickFlyerTemplate({ occasion: occasionTitle });
      const aspectRatioKey = pickAspectRatio(primaryPlatform);

      const persisted = await persistAsset(client, {
        shopId,
        userId: job.created_by || null,
        persona: "Lily",
        jobId,
        assetType: "flyer",
        provider: generation.result.provider,
        model: generation.result.model,
        content: {
          headline: flyerCtx.on_image_headline || null,
          body: flyerCtx.on_image_body || null,
          cta: flyerCtx.on_image_cta || null,
          template_id: template.id,
          aspect_ratio: aspectRatioKey,
          style_tier: "generated",
          background_url: generation.result.backgroundImageUrl,
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
          canvas: ASPECT_RATIOS[aspectRatioKey],
          caption: flyerCtx.caption || null,
          brand: {
            shopName: shopRow.data?.name || null,
            phone: shopRow.data?.phone || null,
            primaryColor: shopRow.data?.primary_color || null,
            accentColor: shopRow.data?.accent_color || null,
            city: shopRow.data?.city || null,
            state: shopRow.data?.state || null
          },
          brand_traits_used: flyerCtx.brand_traits_used || [],
          visual_traits_used: flyerCtx.visual_traits_used || [],
          grounded_in_inventory: flyerCtx.grounded_in_inventory || [],
          visual_brief: flyerCtx.visual_brief || null,
          creative_brief: flyerCtx.creative_brief || null,
          objective: flyerCtx.objective || null,
          quality_check: null,
          photo_strategy: "subject_forward",
          user_uploaded_photo: false,
          reused_from_asset_id: null,
          canonical_concept: ctx.canonical_concept || null,
          creative_direction: generation.result.creativeDirection,
          creative_engine: "premium_ai_creative",
          premium_creative_overlays: generation.result.overlays,
          premium_creative_diagnostic: {
            version: 1,
            trace_id: traceId,
            router: { engine: "premium_ai_creative", reason: null },
            eligibility: { feature_flag_enabled: true },
            environment: generation.diagnostic?.environment || null,
            provider: generation.diagnostic?.provider || null,
            usage: generation.diagnostic?.usage || null,
            execution: generation.diagnostic?.execution || null,
            orchestrator: generation.diagnostic?.orchestrator || null,
            fallback: { occurred: false, final_engine: "premium_ai_creative", reason: null }
          }
        },
        mediaId: null,
        status: "completed"
      });
      if (!persisted.ok) {
        await settlePremiumJobFailed(client, jobId, { reason: "asset_persist_failed" });
        await client
          .from("marketing_content_items")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", contentItemId)
          .eq("shop_id", shopId)
          .eq("status", "generating");
        log("asset_persist_failed", { jobId, error: persisted.error });
        return { statusCode: 200, body: JSON.stringify({ ok: false, error: persisted.error }) };
      }

      const assetId = persisted.asset.id;
      const variantsResult = await client.from("marketing_platform_variants").select("id,platform").eq("content_item_id", contentItemId).eq("shop_id", shopId);
      const variants = variantsResult.data || [];
      // A real generated background photo — never a real upload/reuse —
      // so this is unconditionally true for a successful Premium Creative
      // asset (see marketing-studio.js's own equivalent computation).
      const generativeImageUsed = true;
      for (const v of variants) {
        await client
          .from("marketing_platform_variants")
          .update({
            asset_id: assetId,
            caption: flyerCtx.caption || null,
            hashtags: flyerCtx.hashtags || [],
            ...computeDisclosureFields({ platform: v.platform, generativeImageUsed, aiContentType: "generative_image" })
          })
          .eq("id", v.id)
          .eq("shop_id", shopId);
      }

      const updatedItem = await client
        .from("marketing_content_items")
        .update({ status: "draft", updated_at: new Date().toISOString() })
        .eq("id", contentItemId)
        .eq("shop_id", shopId)
        .eq("status", "generating")
        .select("id,status");
      if (updatedItem.error) throw updatedItem.error;

      await settlePremiumJobCompleted(client, jobId, { assetId, backgroundImageUrl: generation.result.backgroundImageUrl });

      if (job.created_by) {
        await writeCommandAudit(client, job.created_by, "marketing_content_generated", {
          shopId,
          targetType: "marketing_content_items",
          targetId: contentItemId,
          assetType: "flyer"
        });
      }
      structuredLog("info", "marketing_premium_creative_background_complete", { traceId, jobId, assetId });
      return { statusCode: 200, body: JSON.stringify({ ok: true, jobId, assetId }) };
    } catch (error) {
      log("unhandled_error", { jobId, error: String(error?.message || error) });
      try {
        await settlePremiumJobFailed(client, jobId, { reason: "unhandled_error" });
        if (contentItemId && shopId) {
          await client
            .from("marketing_content_items")
            .update({ status: "failed", updated_at: new Date().toISOString() })
            .eq("id", contentItemId)
            .eq("shop_id", shopId)
            .eq("status", "generating");
        }
      } catch (settleError) {
        log("settle_after_error_failed", { jobId, error: String(settleError?.message || settleError) });
      }
      return { statusCode: 500, body: JSON.stringify({ error: "internal error" }) };
    }
  };
}

export const handler = createMarketingPremiumCreativeBackgroundHandler();
