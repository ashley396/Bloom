/**
 * Florisyn AI Core — planner + execution engine (Phase 3/4 of the AI-OS
 * rebuild). Turns a classified request into an ordered plan, runs it
 * step by step against real Florisyn tools, and tracks real execution
 * state so a job where some steps succeed and one fails is never reported
 * as either fully done or fully lost.
 *
 * This is deliberately one shared engine, not per-persona logic — Lily,
 * Bud, Rose, and Daisy all run jobs through the same planJob/runJob pair
 * (see florist-ai-personas.js for what differs: voice, temperature, lane).
 */

import { validateMarketingCampaignBody, CAMPAIGN_CHANNELS } from "./marketing-campaigns.js";
import {
  generateSocialPost,
  generateVideoConcept,
  generateWebsiteSectionDraft,
  persistGeneratedAsset
} from "./ai-creative-engine.js";
import { generateImage, buildImagePrompt } from "./ai-image-engine.js";

const POSTABLE_CHANNELS = ["facebook", "instagram", "google_business", "email", "sms", "blog"];
const CHANNEL_TO_CAMPAIGN_CHANNEL = {
  facebook: "social",
  instagram: "social",
  google_business: "social",
  email: "email",
  sms: "text",
  blog: "website",
  website: "website"
};

function mapToCampaignChannels(channels = []) {
  const mapped = new Set();
  for (const c of channels) {
    const m = CHANNEL_TO_CAMPAIGN_CHANNEL[c];
    if (m && CAMPAIGN_CHANNELS.includes(m)) mapped.add(m);
  }
  return [...mapped];
}

/** Builds the ordered step list for a classified request. Never executes
 * anything — planning and running are separate so a UI could show the
 * plan before committing to it, and so retry can re-run one step in
 * isolation using the exact same step definitions. */
export function planJob(routed, { requestText } = {}) {
  const channels = routed.channels?.length ? routed.channels : routed.domain === "marketing" ? ["facebook"] : [];
  const steps = [];

  if (routed.action_type === "campaign") {
    steps.push({ id: "campaign", tool: "marketing.createCampaign", label: "Create the campaign", optional: false });
    const postChannels = channels.filter((c) => POSTABLE_CHANNELS.includes(c));
    const wantsWebsite = channels.includes("website");
    for (const channel of postChannels.length ? postChannels : ["facebook"]) {
      steps.push({ id: `post_${channel}`, tool: "marketing.createSocialPost", channel, label: `Write the ${channel} post`, optional: false });
    }
    if (wantsWebsite) {
      steps.push({ id: "website_section", tool: "marketing.createWebsiteSectionDraft", label: "Draft the website campaign section", optional: false });
    }
    steps.push({ id: "image", tool: "creative.generateImage", label: "Generate the campaign image", optional: true });
    return steps;
  }

  if (routed.action_type === "create" && routed.domain === "marketing") {
    const channel = channels[0] || "facebook";
    steps.push({ id: `post_${channel}`, tool: "marketing.createSocialPost", channel, label: `Write the ${channel} post`, optional: false });
    steps.push({ id: "image", tool: "creative.generateImage", label: "Generate the matching image", optional: true });
    return steps;
  }

  if (routed.action_type === "video") {
    steps.push({ id: "video_concept", tool: "marketing.createVideoConcept", label: "Write the video concept, script & storyboard", optional: false });
    steps.push({ id: "image", tool: "creative.generateImage", label: "Generate a thumbnail/cover image", optional: true });
    return steps;
  }

  // Anything else that reaches the orchestrator (shouldn't normally happen —
  // callers should only invoke this for create/campaign/video) gets a
  // single best-effort content step rather than silently doing nothing.
  steps.push({ id: "post_facebook", tool: "marketing.createSocialPost", channel: "facebook", label: "Write the post", optional: false });
  return steps;
}

async function runStep(client, step, ctx) {
  const { shopId, userId, persona, routed, requestText, shop, jobId, campaignId } = ctx;

  if (step.tool === "marketing.createCampaign") {
    const name = routed.occasion ? `${routed.occasion} campaign` : (requestText || "New campaign").slice(0, 80);
    const v = validateMarketingCampaignBody({
      name,
      goal: routed.summary || null,
      audience_note: routed.audience || null,
      channels: mapToCampaignChannels(routed.channels)
    });
    if (!v.valid) return { ok: false, error: v.error };
    const payload = { ...v.sanitized, shop_id: shopId, created_by: userId, updated_at: new Date().toISOString() };
    const { data, error } = await client.from("marketing_campaigns").insert(payload).select().single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, result: { campaign_id: data.id, campaign: data } };
  }

  if (step.tool === "marketing.createSocialPost") {
    const gen = await generateSocialPost({
      persona,
      channel: step.channel,
      occasion: routed.occasion,
      audience: routed.audience,
      shop,
      requestText
    });
    if (!gen.ok) {
      await persistGeneratedAsset(client, {
        shopId, userId, persona, jobId, campaignId,
        assetType: "social_post", model: "unknown", status: "failed", error: gen.error
      });
      return { ok: false, error: gen.error };
    }
    const persisted = await persistGeneratedAsset(client, {
      shopId, userId, persona, jobId, campaignId,
      assetType: "social_post", model: gen.model, content: gen.content, status: "completed"
    });
    if (!persisted.ok) return { ok: false, error: persisted.error };
    return { ok: true, result: { asset_id: persisted.asset.id, content: gen.content } };
  }

  if (step.tool === "marketing.createWebsiteSectionDraft") {
    const gen = await generateWebsiteSectionDraft({ persona, occasion: routed.occasion, audience: routed.audience, shop, requestText });
    if (!gen.ok) {
      await persistGeneratedAsset(client, {
        shopId, userId, persona, jobId, campaignId,
        assetType: "website_section", model: "unknown", status: "failed", error: gen.error
      });
      return { ok: false, error: gen.error };
    }
    const persisted = await persistGeneratedAsset(client, {
      shopId, userId, persona, jobId, campaignId,
      assetType: "website_section", model: gen.model, content: gen.content, status: "completed"
    });
    if (!persisted.ok) return { ok: false, error: persisted.error };
    return { ok: true, result: { asset_id: persisted.asset.id, content: gen.content } };
  }

  if (step.tool === "marketing.createVideoConcept") {
    const gen = await generateVideoConcept({ persona, channel: routed.channels?.[0], occasion: routed.occasion, audience: routed.audience, shop, requestText });
    if (!gen.ok) {
      await persistGeneratedAsset(client, {
        shopId, userId, persona, jobId, campaignId,
        assetType: "video_concept", model: "unknown", status: "failed", error: gen.error
      });
      return { ok: false, error: gen.error };
    }
    const persisted = await persistGeneratedAsset(client, {
      shopId, userId, persona, jobId, campaignId,
      assetType: "video_concept", model: gen.model, content: gen.content, status: "completed"
    });
    if (!persisted.ok) return { ok: false, error: persisted.error };
    return { ok: true, result: { asset_id: persisted.asset.id, content: gen.content } };
  }

  if (step.tool === "creative.generateImage") {
    const products = (ctx.inventory || []).slice(0, 4).map((i) => i.name).filter(Boolean);
    const prompt = buildImagePrompt({ occasion: routed.occasion, products, shopName: shop?.name, visualBrief: ctx.visualBrief });
    const gen = await generateImage(client, shopId, { prompt, filename: `${routed.domain || "marketing"}-${Date.now()}.jpg` });
    if (!gen.ok) {
      await persistGeneratedAsset(client, {
        shopId, userId, persona, jobId, campaignId,
        assetType: "image", model: "unknown", prompt, status: "failed", error: gen.error
      });
      return { ok: false, error: gen.error };
    }
    // The image row itself lives in website_media (uploadWebsiteMedia already
    // inserted nothing there yet — it only uploads bytes; add the metadata
    // row here so it shows up in the Website Studio media library too).
    const { data: mediaRow } = await client
      .from("website_media")
      .insert({ shop_id: shopId, storage_path: gen.path, filename: gen.path.split("/").pop(), source: "generated", mime: "image/jpeg" })
      .select()
      .single();
    const persisted = await persistGeneratedAsset(client, {
      shopId, userId, persona, jobId, campaignId,
      assetType: "image", provider: gen.provider, model: gen.model, prompt: gen.prompt,
      content: { url: gen.url }, mediaId: mediaRow?.id || null, status: "completed"
    });
    if (!persisted.ok) return { ok: false, error: persisted.error };
    return { ok: true, result: { asset_id: persisted.asset.id, url: gen.url } };
  }

  return { ok: false, error: `Unknown tool: ${step.tool}` };
}

function summarizeStatus(plan) {
  const required = plan.filter((s) => !s.optional);
  const requiredDone = required.filter((s) => s.status === "completed");
  const requiredFailed = required.filter((s) => s.status === "failed");
  if (requiredFailed.length === required.length && required.length > 0) return "failed";
  if (requiredDone.length === required.length) return "completed";
  if (requiredDone.length > 0) return "partially_completed";
  return "failed";
}

/** Runs every step of a plan in order, persisting job state as it goes so
 * a job that dies partway through (function timeout, provider outage)
 * still shows accurate per-step status rather than silently vanishing. */
export async function runJob(client, { shopId, userId, persona, routed, requestText, shop, inventory }) {
  const plan = planJob(routed, { requestText }).map((s) => ({ ...s, status: "planned", result: null, error: null }));

  const { data: job, error: createError } = await client
    .from("ai_execution_jobs")
    .insert({
      shop_id: shopId,
      created_by: userId,
      persona,
      job_type: routed.action_type,
      title: routed.summary || requestText.slice(0, 120),
      status: "running",
      request_text: requestText,
      plan
    })
    .select()
    .single();
  if (createError) return { ok: false, error: createError.message };

  let campaignId = null;
  const ctx = { shopId, userId, persona, routed, requestText, shop, inventory, jobId: job.id, get campaignId() { return campaignId; } };

  for (let i = 0; i < plan.length; i += 1) {
    plan[i].status = "running";
    // eslint-disable-next-line no-await-in-loop
    const outcome = await runStep(client, plan[i], { ...ctx, campaignId });
    if (outcome.ok) {
      plan[i].status = "completed";
      plan[i].result = outcome.result || null;
      if (outcome.result?.campaign_id) campaignId = outcome.result.campaign_id;
    } else {
      plan[i].status = "failed";
      plan[i].error = outcome.error || "Unknown error";
    }
  }

  const status = summarizeStatus(plan);
  const result = {
    campaign_id: campaignId,
    steps: plan.map((s) => ({ id: s.id, tool: s.tool, label: s.label, status: s.status, result: s.result, error: s.error }))
  };
  const topError = status === "failed" ? plan.find((s) => s.status === "failed")?.error || "Job failed." : null;

  const { data: updated, error: updateError } = await client
    .from("ai_execution_jobs")
    .update({ status, plan, result, error: topError, campaign_id: campaignId })
    .eq("id", job.id)
    .select()
    .single();
  if (updateError) return { ok: false, error: updateError.message };

  return { ok: true, job: updated };
}

/** Re-runs exactly one failed step of an existing job, preserving every
 * other step's already-completed result. This is the "allow retry of the
 * failed step" requirement — a partial failure never forces redoing work
 * that already succeeded. */
export async function retryJobStep(client, { shopId, userId, persona, jobId, stepId }) {
  const { data: job, error: loadError } = await client
    .from("ai_execution_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("shop_id", shopId)
    .single();
  if (loadError || !job) return { ok: false, error: "Job not found." };

  const plan = Array.isArray(job.plan) ? [...job.plan] : [];
  const idx = plan.findIndex((s) => s.id === stepId);
  if (idx === -1) return { ok: false, error: "Step not found on this job." };

  const routed = { action_type: job.job_type, domain: "marketing", occasion: null, audience: null, channels: [], summary: job.title };
  plan[idx] = { ...plan[idx], status: "running", error: null };
  const outcome = await runStep(client, plan[idx], {
    shopId, userId, persona, routed, requestText: job.request_text, shop: {}, inventory: [], jobId: job.id, campaignId: job.campaign_id
  });
  plan[idx].status = outcome.ok ? "completed" : "failed";
  plan[idx].result = outcome.ok ? outcome.result || null : null;
  plan[idx].error = outcome.ok ? null : outcome.error;

  const status = summarizeStatus(plan);
  const result = { ...(job.result || {}), steps: plan.map((s) => ({ id: s.id, tool: s.tool, label: s.label, status: s.status, result: s.result, error: s.error })) };

  const { data: updated, error: updateError } = await client
    .from("ai_execution_jobs")
    .update({ status, plan, result })
    .eq("id", jobId)
    .select()
    .single();
  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true, job: updated };
}
