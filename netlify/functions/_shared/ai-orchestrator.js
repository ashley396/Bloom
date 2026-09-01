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
  generateFlyerContent,
  persistGeneratedAsset
} from "./ai-creative-engine.js";
import { buildImagePrompt, buildBackgroundPrompt } from "./ai-image-engine.js";
import { runMarketingImageQuality } from "./marketing-image-quality.js";
import { applyGeneratedWebsiteSection, buildWebsiteSectionPayload } from "./website-campaign-section.js";
import { pickFlyerTemplate, pickAspectRatio, ASPECT_RATIOS } from "./flyer-templates.js";
import { applyRevisionDeltas, defaultVisualStyle } from "./ai-visual-revisions.js";
import { buildVisualBrief } from "./ai-intent-router.js";
import { loadGenerationGrounding } from "./marketing-generation-grounding.js";
import { evaluateMarketingOutput } from "./marketing-content-revision.js";

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
    // Image before website_section (when both are planned) so the section
    // step can carry the finished image URL into the hero it applies —
    // order here is deliberate, not incidental.
    if (wantsWebsite) {
      steps.push({ id: "image", tool: "creative.generateImage", label: "Generate the campaign image", optional: true });
      steps.push({ id: "website_section", tool: "marketing.createWebsiteSectionDraft", label: "Draft and apply the website campaign section", optional: false });
    } else {
      steps.push({ id: "image", tool: "creative.generateImage", label: "Generate the campaign image", optional: true });
    }
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

  // Visual Creation Studio. A deterministic follow-up ("make the phone
  // number bigger", "less pink") never reaches classifyRequest at all —
  // lily-ai.js catches it first and calls runJob with this synthetic
  // visual_op directly, so this branch only has to plan the one step.
  if (routed.domain === "photo") {
    if (routed.visual_op === "revise") {
      return [{ id: "revise", tool: "creative.reviseVisual", label: "Update the visual", optional: false }];
    }
    if (routed.action_type === "edit" && (routed.visual_op === "background_change" || routed.visual_op === "style")) {
      return [{ id: "background", tool: "creative.generateBackground", label: "Generate the new background", optional: false }];
    }
    if (routed.visual_op === "flyer") {
      const flyerSteps = [{ id: "flyer_content", tool: "creative.renderFlyerContent", label: "Write the flyer content", optional: false }];
      // Only spend an image-generation call when the message itself carried
      // real aesthetic direction — a plain operational notice (closing
      // time, phone number) gets the reliable template background instead,
      // per flyer-templates.js's Tier-B fallback design.
      if (routed.visual_style_signal) {
        flyerSteps.push({ id: "flyer_background", tool: "creative.generateBackground", label: "Generate the flyer's visual background", optional: true });
      }
      return flyerSteps;
    }
    // "crop" is a pure client-side resize (no new pixels, no AI call) and
    // "none"/unrecognized photo requests need no server step at all.
    return [];
  }

  // Anything else that reaches the orchestrator (shouldn't normally happen —
  // callers should only invoke this for create/campaign/video) gets a
  // single best-effort content step rather than silently doing nothing.
  steps.push({ id: "post_facebook", tool: "marketing.createSocialPost", channel: "facebook", label: "Write the post", optional: false });
  return steps;
}

async function runStep(client, step, ctx) {
  const { shopId, userId, persona, routed, requestText, shop, jobId, campaignId, styleSummary, brandVoiceSummary, inventorySummary, audienceSummary } = ctx;

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
      requestText,
      brandVoiceSummary,
      visualStyleSummary: styleSummary,
      inventorySummary,
      audienceSummary
    });
    if (!gen.ok) {
      await persistGeneratedAsset(client, {
        shopId, userId, persona, jobId, campaignId,
        assetType: "social_post", model: "unknown", status: "failed", error: gen.error
      });
      return { ok: false, error: gen.error };
    }
    // Batch 1 rebuild: this general Lily job-runner path previously ran NO
    // output-safety check at all before persisting — an ordinary post
    // generated here could carry the exact same invented-shipment/
    // sympathy-mismatch/visual-fiction shape generate_content's own
    // detectors exist to catch, with nothing here to catch it. The shared
    // evaluateMarketingOutput() evaluator's deterministic repair always
    // applies (a fabricated number, an unverified inventory claim, a
    // leaked visual-fiction detail is never persisted); a problem it
    // can't deterministically fix is logged for observability rather than
    // silently persisted as clean — this file has no retry/rescue
    // infrastructure of its own yet (unlike generate_content's bounded
    // retry + deterministic-notice fallback), so a genuinely unsafe
    // result is still persisted with its safety verdict attached rather
    // than blocking the whole job; closing that gap fully is tracked as a
    // follow-up, not silently assumed done here.
    const socialPostEval = evaluateMarketingOutput({
      route: "ai_orchestrator.marketing.createSocialPost",
      request: requestText,
      shopEvidence: { name: shop?.name, phone: shop?.phone },
      inventoryEvidence: ctx.inventory || [],
      candidate: gen.content,
      component: "caption",
      isRetryAttempt: true
    });
    if (socialPostEval.safeCandidate) {
      gen.content.headline = socialPostEval.safeCandidate.headline;
      gen.content.body = socialPostEval.safeCandidate.body;
      gen.content.cta = socialPostEval.safeCandidate.cta;
    }
    const persisted = await persistGeneratedAsset(client, {
      shopId, userId, persona, jobId, campaignId,
      assetType: "social_post", model: gen.model,
      content: { ...gen.content, safety_check: { decision: socialPostEval.reasons.length ? "reject" : socialPostEval.repaired ? "repair" : "pass", reasonCount: socialPostEval.reasons.length } },
      status: "completed"
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

    // AI-OS Wave 3: apply the content to the real Website Builder X draft
    // (a real hero section on the shop's home page, undoable via the same
    // version-snapshot every manual edit gets) instead of only generating
    // it. Never publishes — bloom_website_pages is the draft layer; the
    // florist still takes their own separate publish action.
    const sectionPayload = buildWebsiteSectionPayload(gen.content, { imageUrl: ctx.imageUrl });
    const applied = await applyGeneratedWebsiteSection(client, { shopId, userId, section: sectionPayload });
    const content = { ...gen.content, appliedToLivePage: false, appliedToDraft: Boolean(applied.ok && applied.applied) };

    const persisted = await persistGeneratedAsset(client, {
      shopId, userId, persona, jobId, campaignId,
      assetType: "website_section", model: gen.model, content, status: "completed"
    });
    if (!persisted.ok) return { ok: false, error: persisted.error };
    if (!applied.ok) {
      // The generated content is still real and persisted above — a
      // failure to apply it to the live draft doesn't erase the copy,
      // it just means the florist adds it by hand this time.
      return { ok: true, result: { asset_id: persisted.asset.id, content, applied: false, applyError: applied.error } };
    }
    return { ok: true, result: { asset_id: persisted.asset.id, content, applied: applied.applied, applyReason: applied.reason || null } };
  }

  if (step.tool === "marketing.createVideoConcept") {
    const gen = await generateVideoConcept({ persona, channel: routed.channels?.[0], occasion: routed.occasion, audience: routed.audience, shop, requestText, brandVoiceSummary, visualStyleSummary: styleSummary, inventorySummary, audienceSummary });
    if (!gen.ok) {
      await persistGeneratedAsset(client, {
        shopId, userId, persona, jobId, campaignId,
        assetType: "video_concept", model: "unknown", status: "failed", error: gen.error
      });
      return { ok: false, error: gen.error };
    }
    // Batch 1 rebuild: video concepts had NO safety check at all before
    // this — not even the caption's own factsPreserved-style guard —
    // and buildVideoConceptTask itself has no sympathy handling and no
    // unconditional anti-fabrication rule (unlike the caption/flyer
    // prompts). Detection-only (a video plan's script/scenes/captions
    // have no headline/body/cta shape to repair field-by-field);
    // recorded on the persisted asset for observability rather than
    // silently treated as clean.
    const videoConceptEval = evaluateMarketingOutput({
      route: "ai_orchestrator.marketing.createVideoConcept",
      request: requestText,
      shopEvidence: { name: shop?.name, phone: shop?.phone },
      inventoryEvidence: ctx.inventory || [],
      candidate: [gen.content.concept, gen.content.script, ...(gen.content.scenes || []), ...(gen.content.captions || [])].filter(Boolean).join(" "),
      component: "video_concept",
      isRetryAttempt: true
    });
    const persisted = await persistGeneratedAsset(client, {
      shopId, userId, persona, jobId, campaignId,
      assetType: "video_concept", model: gen.model,
      content: { ...gen.content, safety_check: { decision: videoConceptEval.reasons.length ? "reject" : "pass", reasonCount: videoConceptEval.reasons.length } },
      status: "completed"
    });
    if (!persisted.ok) return { ok: false, error: persisted.error };
    return { ok: true, result: { asset_id: persisted.asset.id, content: gen.content } };
  }

  if (step.tool === "creative.generateImage") {
    const products = (ctx.inventory || []).slice(0, 4).map((i) => i.name).filter(Boolean);
    // Batch 1 rebuild: the visual-fiction/flower-grounding boundary
    // applies here exactly as it does in Marketing Studio's own
    // generate_content — a visualBrief naming an ungrounded flower
    // species is sanitized before it ever reaches the image prompt.
    let sceneVisualBrief = ctx.visualBrief;
    if (sceneVisualBrief) {
      const sceneEval = evaluateMarketingOutput({
        route: "ai_orchestrator.creative.generateImage",
        request: requestText,
        inventoryEvidence: ctx.inventory || [],
        candidate: sceneVisualBrief,
        component: "creative_scene"
      });
      if (sceneEval.decision === "repair") sceneVisualBrief = sceneEval.safeCandidate;
    }
    const prompt = buildImagePrompt({ occasion: routed.occasion, products, shopName: shop?.name, visualBrief: sceneVisualBrief });
    const quality = await runMarketingImageQuality({
      client,
      shopId,
      promptFor: () => prompt,
      filenameFor: (attempt) => (attempt === 0 ? `${routed.domain || "marketing"}-${Date.now()}.jpg` : `${routed.domain || "marketing"}-${Date.now()}-retry${attempt}.jpg`),
      visualBrief: sceneVisualBrief,
      occasion: routed.occasion,
      usage: { jobId }
      // No buildFallback: this orchestrator tool has no deterministic
      // template equivalent to fall back to — a rejected/failed photo here
      // must be reported honestly as a failed step, exactly as an outright
      // provider failure already was before this quality gate existed.
    });
    if (quality.state !== "PASS") {
      const error = quality.error || "The generated photo didn't pass Lily's quality check.";
      await persistGeneratedAsset(client, {
        shopId, userId, persona, jobId, campaignId,
        assetType: "image", model: "unknown", prompt, status: "failed", error
      });
      return { ok: false, error };
    }
    const gen = quality.gen;
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
      content: { url: gen.url, quality_check: quality.check || null }, mediaId: mediaRow?.id || null, status: "completed"
    });
    if (!persisted.ok) return { ok: false, error: persisted.error };
    return { ok: true, result: { asset_id: persisted.asset.id, url: gen.url } };
  }

  if (step.tool === "creative.generateBackground") {
    // The actual style-blended backdrop description is built here, not in
    // classifyRequest() — see ai-intent-router.js's module docstring for
    // why that call is deliberately deferred to the one step that's
    // actually about to spend an image generation (a plain "crop this" or
    // a Tier-B flyer never reaches this line, so it never pays for it).
    const brief = await buildVisualBrief(requestText, { styleSummary, occasion: routed.occasion });
    // Batch 1 rebuild: the same visual-fiction/flower-grounding boundary
    // as creative.generateImage above.
    let backgroundVisualBrief = brief.visual_brief;
    if (backgroundVisualBrief) {
      const sceneEval = evaluateMarketingOutput({
        route: "ai_orchestrator.creative.generateBackground",
        request: requestText,
        inventoryEvidence: ctx.inventory || [],
        candidate: backgroundVisualBrief,
        component: "creative_scene"
      });
      if (sceneEval.decision === "repair") backgroundVisualBrief = sceneEval.safeCandidate;
    }
    // Backdrop-only, deliberately — the client already has a real,
    // segmented cutout of the florist's actual arrangement (or no photo at
    // all, for a flyer's visual background) and composites it on top of
    // whatever this returns; see buildBackgroundPrompt()'s own docstring
    // for why a second subject here would double up in the final image.
    const prompt = buildBackgroundPrompt({ visualBrief: backgroundVisualBrief, brandColor: shop?.primary_color });
    const quality = await runMarketingImageQuality({
      client,
      shopId,
      promptFor: () => prompt,
      filenameFor: (attempt) => (attempt === 0 ? `background-${Date.now()}.jpg` : `background-${Date.now()}-retry${attempt}.jpg`),
      visualBrief: backgroundVisualBrief,
      occasion: routed.occasion,
      usage: { jobId }
    });
    if (quality.state !== "PASS") {
      const error = quality.error || "The generated background didn't pass Lily's quality check.";
      await persistGeneratedAsset(client, {
        shopId, userId, persona, jobId, campaignId,
        assetType: "background", model: "unknown", prompt, status: "failed", error, parentAssetId: ctx.parentAssetId || null
      });
      return { ok: false, error };
    }
    const gen = quality.gen;
    const { data: mediaRow } = await client
      .from("website_media")
      .insert({ shop_id: shopId, storage_path: gen.path, filename: gen.path.split("/").pop(), source: "generated", mime: "image/jpeg" })
      .select()
      .single();
    const content = { url: gen.url, visual_brief: brief.visual_brief, traits_used: brief.traits_used, quality_check: quality.check || null };
    const persisted = await persistGeneratedAsset(client, {
      shopId, userId, persona, jobId, campaignId,
      assetType: "background", provider: gen.provider, model: gen.model, prompt: gen.prompt,
      content, mediaId: mediaRow?.id || null, parentAssetId: ctx.parentAssetId || null, status: "completed"
    });
    if (!persisted.ok) return { ok: false, error: persisted.error };
    return { ok: true, result: { asset_id: persisted.asset.id, url: gen.url, content } };
  }

  if (step.tool === "creative.renderFlyerContent") {
    const gen = await generateFlyerContent({
      persona, message: requestText, occasion: routed.occasion, visualStyleSignal: routed.visual_style_signal, shop
    });
    if (!gen.ok) {
      await persistGeneratedAsset(client, {
        shopId, userId, persona, jobId, campaignId,
        assetType: "flyer", model: "unknown", status: "failed", error: gen.error, parentAssetId: ctx.parentAssetId || null
      });
      return { ok: false, error: gen.error };
    }
    // Batch 1 rebuild: this flyer-wording path (Lily's own tool-routed
    // job runner, separate from Marketing Studio's generate_content) had
    // no output-safety check at all. Same deterministic-repair-always,
    // log-what-isn't-fixable pattern as marketing.createSocialPost above
    // — no concept-threading exists between this and any sibling caption
    // step here, so coherence/CTA checks don't apply (canonicalConcept
    // omitted), same as before this fix.
    const flyerContentEval = evaluateMarketingOutput({
      route: "ai_orchestrator.creative.renderFlyerContent",
      request: requestText,
      shopEvidence: { name: shop?.name, phone: shop?.phone },
      inventoryEvidence: ctx.inventory || [],
      candidate: gen.content,
      component: "flyer_text",
      isRetryAttempt: true
    });
    if (flyerContentEval.safeCandidate) {
      gen.content.headline = flyerContentEval.safeCandidate.headline;
      gen.content.body = flyerContentEval.safeCandidate.body;
      gen.content.cta = flyerContentEval.safeCandidate.cta;
    }
    const template = pickFlyerTemplate({ occasion: routed.occasion });
    const aspectRatio = pickAspectRatio(routed.target_aspect_ratio_hint);
    const content = {
      ...gen.content,
      safety_check: { decision: flyerContentEval.reasons.length ? "reject" : flyerContentEval.repaired ? "repair" : "pass", reasonCount: flyerContentEval.reasons.length },
      template_id: template.id,
      aspect_ratio: aspectRatio,
      // Tier A (a real generated visual) when the message itself carried
      // aesthetic direction; Tier B (the template's own brand-color
      // background) when it didn't — flyer-templates.js's fallback design.
      style_tier: routed.visual_style_signal ? "generated" : "template",
      background_url: null,
      // Populated after the fact from the flyer_background step's own
      // buildVisualBrief() result, once/if that optional step runs — see
      // the post-loop patch in runJob().
      traits_used: [],
      style: defaultVisualStyle(),
      // The client-side renderer (public/flyer-renderer.js) draws the
      // actual flyer canvas — it needs the full layout, not just an id, so
      // the server stays the single source of truth for region placement
      // rather than a second, drift-prone copy of flyer-templates.js
      // living in the browser bundle.
      regions: template.regions,
      palette: template.palette,
      canvas: ASPECT_RATIOS[aspectRatio]
    };
    const persisted = await persistGeneratedAsset(client, {
      shopId, userId, persona, jobId, campaignId,
      assetType: "flyer", model: gen.model, content, parentAssetId: ctx.parentAssetId || null, status: "completed"
    });
    if (!persisted.ok) return { ok: false, error: persisted.error };
    return { ok: true, result: { asset_id: persisted.asset.id, content } };
  }

  if (step.tool === "creative.reviseVisual") {
    const parentId = ctx.parentAssetId;
    if (!parentId) return { ok: false, error: "There's nothing to revise yet — describe what you'd like Lily to create first." };
    const { data: parentAsset, error: loadError } = await client
      .from("ai_generated_assets")
      .select("*")
      .eq("id", parentId)
      .eq("shop_id", shopId)
      .maybeSingle();
    if (loadError || !parentAsset) return { ok: false, error: "Couldn't find the previous version to revise." };
    const deltas = ctx.revisionDeltas || {};

    if (parentAsset.asset_type === "flyer") {
      const nextStyle = applyRevisionDeltas(parentAsset.content?.style || defaultVisualStyle(), deltas);
      const content = { ...parentAsset.content, style: nextStyle };
      const persisted = await persistGeneratedAsset(client, {
        shopId, userId, persona, jobId, campaignId,
        assetType: "flyer", model: parentAsset.model, content, parentAssetId: parentId, status: "completed"
      });
      if (!persisted.ok) return { ok: false, error: persisted.error };
      return { ok: true, result: { asset_id: persisted.asset.id, content, revised: true } };
    }

    if (parentAsset.asset_type === "background") {
      if (!deltas.backgroundHint) {
        return { ok: false, error: "Tell me specifically what to change about the background (a color, a material, a mood) and I'll update it." };
      }
      const backgroundVisualBrief = `${deltas.backgroundHint} background, matching the same overall composition`;
      const prompt = buildBackgroundPrompt({ visualBrief: backgroundVisualBrief, brandColor: shop?.primary_color });
      const quality = await runMarketingImageQuality({
        client,
        shopId,
        promptFor: () => prompt,
        filenameFor: (attempt) => (attempt === 0 ? `background-${Date.now()}.jpg` : `background-${Date.now()}-retry${attempt}.jpg`),
        visualBrief: backgroundVisualBrief,
        usage: { jobId }
      });
      if (quality.state !== "PASS") {
        const error = quality.error || "The regenerated background didn't pass Lily's quality check.";
        await persistGeneratedAsset(client, {
          shopId, userId, persona, jobId, campaignId,
          assetType: "background", model: "unknown", prompt, status: "failed", error, parentAssetId: parentId
        });
        return { ok: false, error };
      }
      const gen = quality.gen;
      const { data: mediaRow } = await client
        .from("website_media")
        .insert({ shop_id: shopId, storage_path: gen.path, filename: gen.path.split("/").pop(), source: "generated", mime: "image/jpeg" })
        .select()
        .single();
      const content = { url: gen.url, visual_brief: prompt, traits_used: [], quality_check: quality.check || null };
      const persisted = await persistGeneratedAsset(client, {
        shopId, userId, persona, jobId, campaignId,
        assetType: "background", provider: gen.provider, model: gen.model, prompt: gen.prompt,
        content, mediaId: mediaRow?.id || null, parentAssetId: parentId, status: "completed"
      });
      if (!persisted.ok) return { ok: false, error: persisted.error };
      return { ok: true, result: { asset_id: persisted.asset.id, url: gen.url, content } };
    }

    return { ok: false, error: `Revising a "${parentAsset.asset_type}" asset isn't supported yet.` };
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
 * still shows accurate per-step status rather than silently vanishing.
 *
 * `conversationId` links the job to its Lily chat conversation (so a later
 * follow-up in the same conversation can find "the last visual" without
 * guessing from message text). `parentAssetId`/`revisionDeltas` carry a
 * revision's link back to what it's revising — both null for a fresh
 * request. `context` persists the visual-relevant slice of `routed` onto
 * the job row itself, so a later retry or lookup has real data to work
 * from instead of re-deriving it from job_type alone. `styleSummary` (from
 * ai-style-memory.js's buildStyleSummary()) is passed through to any
 * creative.generateBackground step, which calls buildVisualBrief() itself —
 * see that function's own docstring for why the brief is built there and
 * not here. It's intentionally NOT persisted in `context`: a retry should
 * blend the shop's *current* style, not a frozen copy from job creation.
 *
 * Phase 4 wiring ("one authoritative shop context layer"): marketing.
 * createSocialPost/createVideoConcept used to call generateSocialPost/
 * generateVideoConcept with NONE of brandVoiceSummary/visualStyleSummary/
 * inventorySummary — the general Lily chat path (this file) produced
 * completely ungrounded marketing copy even though marketing-studio.js's
 * own generate_content and the compound-request orchestrator both already
 * grounded the same underlying calls. `styleSummary` (already loaded by
 * the caller, reused here rather than re-queried) plus a fresh Brand
 * Brain + real-inventory read via marketing-generation-grounding.js close
 * that gap — the same shared loader every marketing-content-generation
 * call site now uses. */
export async function runJob(client, { shopId, userId, persona, routed, requestText, shop, inventory, conversationId = null, parentAssetId = null, revisionDeltas = null, styleSummary = null }) {
  const plan = planJob(routed, { requestText }).map((s) => ({ ...s, status: "planned", result: null, error: null }));

  const context = {
    domain: routed.domain,
    visual_op: routed.visual_op,
    visual_style_signal: routed.visual_style_signal,
    target_aspect_ratio_hint: routed.target_aspect_ratio_hint,
    occasion: routed.occasion,
    parent_asset_id: parentAssetId
  };

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
      plan,
      conversation_id: conversationId,
      context
    })
    .select()
    .single();
  if (createError) return { ok: false, error: createError.message };

  // Only fetched when this job's own plan actually contains a step that
  // uses it — a flyer/website-section/diagnosis/navigation job never pays
  // for a Brand Brain + inventory read it has no use for.
  const needsCopyGrounding = plan.some((s) => s.tool === "marketing.createSocialPost" || s.tool === "marketing.createVideoConcept");
  // Phase 9 ("connect intelligence to marketing"): "audience" added to the
  // same needs list — real subscriber/segment counts now ground the same
  // copy-generation calls brand voice and inventory already do, so Lily
  // can cite a real audience number instead of a vague "your loyal
  // customers" when a request is actually about targeting/reach.
  const { brandVoiceSummary, inventorySummary, audienceSummary } = needsCopyGrounding
    ? await loadGenerationGrounding(client, shopId, { needs: ["brand", "inventory", "audience"] })
    : { brandVoiceSummary: "", inventorySummary: null, audienceSummary: null };

  let campaignId = null;
  let imageUrl = null;
  let flyerAssetId = null;
  let flyerBackgroundUrl = null;
  let flyerBackgroundTraits = [];
  const ctx = { shopId, userId, persona, routed, requestText, shop, inventory, jobId: job.id, parentAssetId, revisionDeltas, styleSummary, brandVoiceSummary, inventorySummary, audienceSummary };

  for (let i = 0; i < plan.length; i += 1) {
    plan[i].status = "running";
    // eslint-disable-next-line no-await-in-loop
    const outcome = await runStep(client, plan[i], { ...ctx, campaignId, imageUrl });
    if (outcome.ok) {
      plan[i].status = "completed";
      plan[i].result = outcome.result || null;
      if (outcome.result?.campaign_id) campaignId = outcome.result.campaign_id;
      if (plan[i].tool === "creative.generateImage" && outcome.result?.url) imageUrl = outcome.result.url;
      if (plan[i].tool === "creative.renderFlyerContent" && outcome.result?.asset_id) flyerAssetId = outcome.result.asset_id;
      if (plan[i].id === "flyer_background" && outcome.result?.url) {
        flyerBackgroundUrl = outcome.result.url;
        flyerBackgroundTraits = outcome.result?.content?.traits_used || [];
      }
    } else {
      plan[i].status = "failed";
      plan[i].error = outcome.error || "Unknown error";
    }
  }

  // The flyer's own generated background (and the shop-style traits woven
  // into it) isn't known until AFTER its content step already persisted the
  // flyer asset — attach both now with one follow-up update rather than
  // restructuring step order (image generation is intentionally
  // optional/best-effort here, so the flyer must exist and be usable even
  // when this step is skipped or fails).
  if (flyerAssetId && flyerBackgroundUrl) {
    const flyerStep = plan.find((s) => s.tool === "creative.renderFlyerContent");
    if (flyerStep?.result?.content) {
      const content = { ...flyerStep.result.content, background_url: flyerBackgroundUrl, traits_used: flyerBackgroundTraits };
      flyerStep.result = { ...flyerStep.result, content };
      await client.from("ai_generated_assets").update({ content }).eq("id", flyerAssetId).eq("shop_id", shopId);
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
export async function retryJobStep(client, { shopId, userId, persona, jobId, stepId, styleSummary = null }) {
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

  // Visual-relevant fields (visual_op, occasion, ...) are persisted on the
  // job row precisely so a retry has real context instead of re-guessing it
  // from job_type alone — see runJob()'s `context` write. visual_brief is
  // deliberately NOT among them: a retried background step calls
  // buildVisualBrief() itself (inside runStep), blending the request text
  // with the CURRENT styleSummary rather than replaying a frozen one.
  const savedContext = job.context && typeof job.context === "object" ? job.context : {};
  const routed = {
    action_type: job.job_type,
    domain: savedContext.domain || "marketing",
    occasion: savedContext.occasion || null,
    audience: null,
    channels: [],
    summary: job.title,
    visual_op: savedContext.visual_op || "none",
    visual_brief: null,
    visual_style_signal: Boolean(savedContext.visual_style_signal),
    target_aspect_ratio_hint: savedContext.target_aspect_ratio_hint || null,
    traits_used: []
  };
  // A retried website_section step still wants the image an earlier,
  // already-completed image step produced — read it back from the job's
  // own steps rather than leaving the retry image-less.
  const imageStep = plan.find((s) => s.tool === "creative.generateImage" && s.status === "completed");
  plan[idx] = { ...plan[idx], status: "running", error: null };
  // Same Phase 4 wiring as runJob() above — a retried copy step must be
  // grounded exactly like the original attempt, not silently downgraded to
  // an ungrounded generation just because it's a retry.
  const retryNeedsCopyGrounding = plan[idx].tool === "marketing.createSocialPost" || plan[idx].tool === "marketing.createVideoConcept";
  const { brandVoiceSummary: retryBrandVoiceSummary, inventorySummary: retryInventorySummary, audienceSummary: retryAudienceSummary } = retryNeedsCopyGrounding
    ? await loadGenerationGrounding(client, shopId, { needs: ["brand", "inventory", "audience"] })
    : { brandVoiceSummary: "", inventorySummary: null, audienceSummary: null };
  const outcome = await runStep(client, plan[idx], {
    shopId, userId, persona, routed, requestText: job.request_text, shop: {}, inventory: [], jobId: job.id,
    campaignId: job.campaign_id, imageUrl: imageStep?.result?.url || null,
    parentAssetId: savedContext.parent_asset_id || null, styleSummary,
    brandVoiceSummary: retryBrandVoiceSummary, inventorySummary: retryInventorySummary, audienceSummary: retryAudienceSummary
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
