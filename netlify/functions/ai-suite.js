/**
 * Florisyn AI Suite — unified gateway for marketing, photo, and POS micro-modules.
 * Architecture: one Netlify function, modular lib/ai-suite/* (microservice-style boundaries).
 */
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { withEnterpriseHandler } from "./_shared/enterprise-handler.js";
import { validateAiSuiteRequest } from "../../lib/ai-suite/schemas.js";
import { logAiSuiteEvent, logAiSuiteError } from "../../lib/ai-suite/logger.js";
import {
  segmentCustomers,
  buildMarketingStrategy,
  draftCampaignCopy
} from "../../lib/ai-suite/marketing-ai.js";
import {
  analyzePhotoMetadata,
  suggestPhotoCorrections,
  socialExportPlan,
  autoEnhanceBuffer
} from "../../lib/ai-suite/photo-ai.js";
import {
  computeRealtimeKpis,
  inventoryAlerts,
  salesInsights
} from "../../lib/ai-suite/pos-analytics.js";

async function handleAiSuite(event, ctx) {
  const body = bodyOf(event);
  const v = validateAiSuiteRequest(body);
  if (!v.valid) return json(400, { error: v.error, code: v.code });

  const { shopId } = ctx;
  const action = v.action;
  logAiSuiteEvent("info", action, { shopId });

  switch (action) {
    case "suite_status":
      return json(200, {
        ok: true,
        modules: ["marketing", "photo", "pos"],
        version: "1.0.0",
        stack: "netlify-functions+supabase",
        note: "AI Suite runs as serverless modules — POS works when cloud AI is offline."
      });

    case "marketing_segment": {
      const result = segmentCustomers(body.customers || [], body.orders || []);
      return json(200, { module: "marketing", ...result });
    }

    case "marketing_strategy": {
      const seg = body.segments || segmentCustomers(body.customers || [], body.orders || []).segments;
      const strategy = buildMarketingStrategy({ shop: body.shop || {}, segments: seg, season: body.season });
      return json(200, { module: "marketing", strategy });
    }

    case "marketing_campaign_draft": {
      const draft = draftCampaignCopy({
        channel: body.channel || "email",
        tactic: body.tactic || {},
        shop: body.shop || {}
      });
      return json(200, { module: "marketing", draft });
    }

    case "photo_analyze":
      return json(200, { module: "photo", analysis: analyzePhotoMetadata(body.meta || body) });

    case "photo_suggest_corrections":
      return json(200, {
        module: "photo",
        ...suggestPhotoCorrections(body.meta || {}, body.adjustments || {})
      });

    case "photo_social_presets":
      return json(200, {
        module: "photo",
        presets: socialExportPlan(Number(body.width), Number(body.height))
      });

    case "photo_auto_enhance": {
      if (!body.image_base64) return json(400, { error: "image_base64 required for auto enhance." });
      const raw = String(body.image_base64).replace(/^data:image\/\w+;base64,/, "");
      const buf = Buffer.from(raw, "base64");
      if (buf.length > 8 * 1024 * 1024) return json(413, { error: "Image too large (max 8MB)." });
      const enhanced = await autoEnhanceBuffer(buf);
      if (!enhanced.ok) return json(503, { error: enhanced.error });
      return json(200, {
        module: "photo",
        mime: enhanced.mime,
        operations: enhanced.operations,
        image_base64: `data:${enhanced.mime};base64,${enhanced.buffer.toString("base64")}`
      });
    }

    case "pos_realtime_kpis":
      return json(200, {
        module: "pos",
        kpis: computeRealtimeKpis({
          orders: body.orders || [],
          products: body.products || [],
          windowHours: body.window_hours ?? 24
        })
      });

    case "pos_inventory_alerts":
      return json(200, {
        module: "pos",
        ...inventoryAlerts(body.products || [], body.thresholds)
      });

    case "pos_sales_insights":
      return json(200, {
        module: "pos",
        insights: salesInsights({ orders: body.orders || [], days: body.days ?? 30 })
      });

    default:
      return json(400, { error: "Unsupported action." });
  }
}

export const handler = withEnterpriseHandler(async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed();

  try {
    const ctx = await currentUser(event);
    return await handleAiSuite(event, ctx);
  } catch (error) {
    logAiSuiteError("ai_suite_failed", error, { path: event.path });
    return fail(error);
  }
});
