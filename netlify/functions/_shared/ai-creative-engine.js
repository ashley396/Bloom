/**
 * Florisyn AI Core — structured generation with real outcome contracts
 * (Phase 2/4 of the AI-OS rebuild — the direct fix for Failure 1).
 *
 * The old path handed the model `Task: Write facebook marketing copy` plus
 * the user's own literal words as `input.prompt`, with nothing telling it
 * to produce the finished asset rather than reflect the instruction back —
 * and the raw `{text}` result got JSON.stringify-dumped into the chat.
 * Every generation call here instead: (1) tells the model explicitly that
 * its job is to write the actual, publish-ready content, never describe or
 * restate the request; (2) requests a real structured shape per asset type
 * (platform/headline/body/cta/visual brief/hashtags — not just "text");
 * (3) persists the result to ai_generated_assets so it's reusable, not
 * chat-transcript-only; (4) is parsed/validated before it ever reaches a
 * client, so a malformed model response fails loudly instead of rendering
 * as broken JSON in the UI.
 */

import { runCloudflareGenerate } from "../ai-assistant.js";

function buildSocialPostTask({ channel, occasion, audience }) {
  return `You are writing the ACTUAL, FINISHED social media post Florisyn will show a florist to publish today. Do not describe the request. Do not summarize what was asked. Do not restate the user's instruction. Write real, publish-ready copy a customer would read right now.

Platform: ${channel || "facebook"}.
${occasion ? `Occasion/theme: ${occasion}.` : ""}
${audience ? `Audience: ${audience}.` : ""}

Rules:
- Never restate or describe the request itself — the output must be usable as-is, with no editing.
- Use the shop's real name/products from the input where given; never invent products, prices, or promises Florisyn can't confirm.
- Match the platform's real voice: warm and conversational for Facebook/Instagram, concise everywhere.
- visual_brief must describe a concrete photo concept (say what's actually in the shot — never a vague placeholder like "a beautiful arrangement").`;
}

const SOCIAL_POST_SCHEMA = {
  platform: "string",
  headline: "string — a short hook/opening line",
  body: "string — the complete finished post text, ready to publish as-is",
  cta: "string — the exact call-to-action line",
  visual_brief: "string — a concrete visual concept for a matching image",
  hashtags: ["string"],
  asset_requirements: ["string"]
};

/** Generates one finished, platform-formatted social post. Never throws —
 * returns { ok:false, error } on any failure so a caller can persist that
 * outcome and keep the rest of a multi-step job running. */
export async function generateSocialPost({ persona = "Lily", channel, occasion, audience, shop, requestText } = {}) {
  try {
    const result = await runCloudflareGenerate({
      mode: "generate",
      persona,
      task: buildSocialPostTask({ channel, occasion, audience }),
      input: { request: requestText, shop: shop || {} },
      schema: SOCIAL_POST_SCHEMA,
      max_tokens: 700
    });
    const post = result?.result;
    if (!post || !post.body) return { ok: false, error: "The AI didn't return usable post copy. Try again." };
    return {
      ok: true,
      content: {
        platform: String(post.platform || channel || "facebook"),
        headline: String(post.headline || "").slice(0, 200),
        body: String(post.body || "").slice(0, 3000),
        cta: String(post.cta || "").slice(0, 200),
        visual_brief: String(post.visual_brief || "").slice(0, 600),
        hashtags: Array.isArray(post.hashtags) ? post.hashtags.slice(0, 15).map(String) : [],
        asset_requirements: Array.isArray(post.asset_requirements) ? post.asset_requirements.slice(0, 10).map(String) : []
      },
      model: result.model
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
}

function buildVideoConceptTask({ occasion, audience, channel }) {
  return `Plan a short-form marketing video (Reel/TikTok-style) for a flower shop. You are NOT rendering video — final AI video rendering is not connected yet. You ARE producing the complete creative plan: script, shot-by-shot storyboard, on-screen captions. Write the actual finished plan, not a description of what a video could contain.

Channel: ${channel || "instagram/facebook reels"}.
${occasion ? `Occasion/theme: ${occasion}.` : ""}
${audience ? `Audience: ${audience}.` : ""}

Rules:
- scenes: each entry is one concrete shot as a single string formatted "0-3s: shot description — on-screen text: ...". Be specific about what's shown, never generic.
- captions: the literal on-screen caption lines, not a description of captions.
- Keep it realistic for one florist with a phone camera — no crew, no equipment they don't have.`;
}

const VIDEO_CONCEPT_SCHEMA = {
  concept: "string — one sentence pitch",
  script: "string — spoken/voiceover script, or empty string if silent/text-only",
  scenes: ["string"],
  captions: ["string"],
  hashtags: ["string"],
  suggested_length_seconds: "number"
};

/** Generates a full video concept/script/storyboard — never a finished
 * video. Result always carries renderingAvailable:false so nothing
 * downstream can mistake a concept for a rendered asset. */
export async function generateVideoConcept({ persona = "Lily", channel, occasion, audience, shop, requestText } = {}) {
  try {
    const result = await runCloudflareGenerate({
      mode: "generate",
      persona,
      task: buildVideoConceptTask({ occasion, audience, channel }),
      input: { request: requestText, shop: shop || {} },
      schema: VIDEO_CONCEPT_SCHEMA,
      max_tokens: 900
    });
    const plan = result?.result;
    if (!plan || !(Array.isArray(plan.scenes) && plan.scenes.length)) {
      return { ok: false, error: "The AI didn't return a usable video plan. Try again." };
    }
    return {
      ok: true,
      content: {
        concept: String(plan.concept || "").slice(0, 400),
        script: String(plan.script || "").slice(0, 3000),
        scenes: plan.scenes.slice(0, 20).map((s) => String(s).slice(0, 300)),
        captions: Array.isArray(plan.captions) ? plan.captions.slice(0, 20).map((c) => String(c).slice(0, 200)) : [],
        hashtags: Array.isArray(plan.hashtags) ? plan.hashtags.slice(0, 15).map(String) : [],
        suggested_length_seconds: Number(plan.suggested_length_seconds) || null,
        renderingAvailable: false,
        renderingNote: "Final AI video rendering is not connected yet — this is the finished script, storyboard, and captions, ready for a video provider once one is chosen."
      },
      model: result.model
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
}

/** Turns a website-promotional draft into a real content bundle a Website
 * Builder X section could be populated from — headline/subhead/CTA/image
 * brief, not a bare navigate. Wave 2 (Website Builder X integration) is
 * what actually writes this into a live page section; this produces the
 * ready-to-apply content today. */
export async function generateWebsiteSectionDraft({ persona = "Lily", occasion, audience, shop, requestText } = {}) {
  try {
    const result = await runCloudflareGenerate({
      mode: "generate",
      persona,
      task: `Write the actual, finished copy for a promotional website section (a homepage banner or campaign landing block) — not a description of the section, the real headline/subheadline/CTA text a visitor would read.
${occasion ? `Occasion/theme: ${occasion}.` : ""}
${audience ? `Audience: ${audience}.` : ""}
Never invent products, prices, or promises Florisyn can't confirm.`,
      input: { request: requestText, shop: shop || {} },
      schema: {
        headline: "string",
        subheadline: "string",
        body: "string",
        cta_label: "string",
        visual_brief: "string"
      },
      max_tokens: 500
    });
    const section = result?.result;
    if (!section || !section.headline) return { ok: false, error: "The AI didn't return usable website copy. Try again." };
    return {
      ok: true,
      content: {
        headline: String(section.headline || "").slice(0, 200),
        subheadline: String(section.subheadline || "").slice(0, 300),
        body: String(section.body || "").slice(0, 1200),
        cta_label: String(section.cta_label || "").slice(0, 100),
        visual_brief: String(section.visual_brief || "").slice(0, 600),
        appliedToLivePage: false
      },
      model: result.model
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
}

function buildFlyerContentTask({ occasion, visualStyleSignal }) {
  return `You are writing the ACTUAL, FINISHED text content for a flyer/graphic a florist will show customers today — not a description of the flyer. Write real, ready-to-display content.

${occasion ? `Occasion/theme: ${occasion}.` : ""}
${visualStyleSignal ? "This request carries real aesthetic direction — a mood/material/color/theme." : "This request is plain and operational (a notice, a closing time, a phone number) — keep the content minimal and direct, no invented flourish."}

Rules:
- ANY concrete fact the florist gave you verbatim — a time, a phone number, a price, a date, a percentage — must appear in your output EXACTLY as given. Never paraphrase, round, or reformat a number or time. This is the single most important rule here.
- headline: short, bold, the first thing read.
- body: the supporting line(s) — can be empty string if the headline says everything.
- cta: the one action line (a phone number to call, "Order online," "Stop by today," etc).
- Never invent a price, discount, date, or promise Florisyn can't confirm — if the florist didn't give you a fact, don't make one up.`;
}

const FLYER_CONTENT_SCHEMA = {
  headline: "string",
  body: "string",
  cta: "string"
};

/** Generates the finished text content for a flyer/graphic — never the
 * pixels. The client-side renderer (public/flyer-renderer.js) turns this,
 * plus the shop's brand and either a generated background or this
 * template's own palette, into the actual image. Keeping content and
 * rendering separate is what makes a revision like "make the phone number
 * bigger" free — it re-renders the same content, no new AI call. */
export async function generateFlyerContent({ persona = "Lily", message, occasion, visualStyleSignal, shop } = {}) {
  try {
    const result = await runCloudflareGenerate({
      mode: "generate",
      persona,
      task: buildFlyerContentTask({ occasion, visualStyleSignal }),
      input: { request: message, shop: shop || {} },
      schema: FLYER_CONTENT_SCHEMA,
      max_tokens: 400
    });
    const content = result?.result;
    if (!content || !content.headline) return { ok: false, error: "The AI didn't return usable flyer content. Try again." };
    return {
      ok: true,
      content: {
        headline: String(content.headline || "").slice(0, 140),
        body: String(content.body || "").slice(0, 400),
        cta: String(content.cta || "").slice(0, 140)
      },
      model: result.model
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
}

/** Persists one generated asset (success or failure) so results are
 * reusable across sessions and a failed step can be retried without
 * losing the successful ones around it. */
export async function persistGeneratedAsset(client, {
  shopId,
  userId,
  persona = "Lily",
  jobId = null,
  campaignId = null,
  assetType,
  provider = "cloudflare",
  model,
  prompt = null,
  content = null,
  mediaId = null,
  parentAssetId = null,
  // 'reframe'|'transcode'|'caption_burn'|'thumbnail'|'trim'|null — the
  // ai_generated_assets.transformation_type column added in the Aug-24
  // media migration. Only ever set alongside parentAssetId (the DB's own
  // ai_generated_assets_master_derived_consistency check enforces this);
  // media-transform-executor.js is the first real caller.
  transformationType = null,
  status = "completed",
  error = null
}) {
  const { data, error: dbError } = await client
    .from("ai_generated_assets")
    .insert({
      shop_id: shopId,
      created_by: userId,
      persona,
      job_id: jobId,
      campaign_id: campaignId,
      asset_type: assetType,
      provider,
      model: model || "unknown",
      prompt,
      content,
      media_id: mediaId,
      parent_asset_id: parentAssetId,
      transformation_type: transformationType,
      status,
      error
    })
    .select()
    .single();
  if (dbError) return { ok: false, error: dbError.message };
  return { ok: true, asset: data };
}
