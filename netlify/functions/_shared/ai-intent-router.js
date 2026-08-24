/**
 * Florisyn AI Core — intent understanding (Phase 2 of the AI-OS rebuild).
 *
 * The old `detectIntent()` in lily-ai-engine.js decided "marketing" purely
 * by whether the literal phrase "facebook post" appeared, and fell through
 * to `website.update` (a bare navigate, no content) the instant the word
 * "website" showed up anywhere in the sentence — regardless of what the
 * rest of the sentence asked for. That's the confirmed root cause of both
 * documented failures ("create a Facebook post" → paraphrase, "make a
 * campaign for Facebook and my website" → the word "website" hijacking the
 * whole request into a bare navigate).
 *
 * This module replaces that specific gap with real understanding: a small
 * set of still-regex fast paths for genuinely unambiguous single-purpose
 * commands (kept exactly as-is — they're correct and don't need an LLM),
 * and an LLM classification call for everything else, so the model reads
 * the whole sentence instead of a fragment of it.
 *
 * Visual Creation Studio extension: two things were added, deliberately
 * kept as TWO separate calls rather than one bigger one — every
 * runCloudflareGenerate "task" string is hard-truncated at 1200 chars
 * (ai-assistant.js's safeText), and the full visual-brief instructions
 * (blending the current message with the shop's learned style, per
 * priority rule) don't fit alongside general routing in that budget:
 *
 *   classifyRequest()   — general routing, now also detects a lightweight
 *                          visual_op/aesthetic-signal/aspect-ratio hint and
 *                          whether the message is a standing style
 *                          preference statement. Runs on every message.
 *
 *   buildVisualBrief()  — the actual backdrop description, blending this
 *                          message with the shop's learned style
 *                          (_shared/ai-style-memory.js's buildStyleSummary()
 *                          output). Only called when a step is actually
 *                          about to generate an image, so the extra call
 *                          is never spent on a message that doesn't need
 *                          one (a plain "crop this" or a Tier-B flyer).
 */

import { runCloudflareGenerate } from "../ai-assistant.js";

export const ACTION_TYPES = Object.freeze([
  "question", // asking for information Florisyn already knows/can look up
  "create", // make one finished piece of content (a post, an image, a description)
  "campaign", // a multi-channel or multi-asset marketing effort
  "video", // a Reel/short-form video request
  "edit", // change an existing photo/page/item
  "diagnosis", // something is broken or wrong
  "navigation", // just wants to open/see a screen, nothing else
  "scheduling", // set a date/time for something that already exists
  "publishing", // make an existing draft live
  "data_retrieval", // look up real business data
  "general" // small talk / anything else
]);

export const VISUAL_OPS = Object.freeze(["background_change", "style", "crop", "flyer", "none"]);

const CLASSIFY_TASK = `Classify what a florist wants Florisyn's AI to do. Read the whole sentence — never classify from a single keyword. "website" is not automatically navigation; "Facebook" is not automatically a single post if the sentence asks for more.

Return JSON:
- action_type: question|create|campaign|video|edit|diagnosis|navigation|scheduling|publishing|data_retrieval|general (campaign=multi-channel).
- domain: marketing|website|photo|personal_brand|inventory|orders|customers|events|wholesale|reports|employees|support|general (photo=image/background/flyer). personal_brand=specifically about how the FLORIST THEMSELVES should be shown/presented in their own marketing — a founder portrait, "put me behind the counter", "make me holding one of my arrangements", "make this more like me", a standing statement about how they like to be dressed/lit/framed/posed, or a request to use their Digital Twin/avatar or cloned voice. This is NOT the shop's general brand voice, and NOT a generic product/flyer photo with no florist in it — when a photo request has no clear intent to depict the founder specifically, keep it domain=photo instead.
- channels: facebook,instagram,google_business,email,sms,website,blog or []. occasion/audience: string|null. summary: one sentence.
- domain=photo only — visual_op: background_change|style|crop|flyer|none. visual_style_signal: true only if it has real aesthetic language. target_aspect_ratio_hint: string|null.
- preference_statement: true only for a standing statement ("I like X"/"use this from now on"), never one-off. preference_updates: [{category,text,polarity}] if true else []. category: background_style,materials,lighting,colors,mood,typography,flyer_style,product_photo_style,social_post_style,floral_decoration_level,realism_level,general_avoid.`;

// Exported under a test-only name (never imported by production code)
// specifically so a regression test can assert the prompt text itself
// keeps teaching a real, structured personal_brand signal rather than
// degrading into a keyword list — see
// tests/lily-personal-brand-routing.test.js.
export const CLASSIFY_TASK_FOR_TEST = CLASSIFY_TASK;

const CLASSIFY_SCHEMA = {
  action_type: "string",
  domain: "string",
  channels: ["string"],
  occasion: "string|null",
  audience: "string|null",
  summary: "string",
  visual_op: "string",
  visual_style_signal: "boolean",
  target_aspect_ratio_hint: "string|null",
  preference_statement: "boolean",
  preference_updates: [{ category: "string", text: "string", polarity: "string" }]
};

function normalizeClassification(raw, message) {
  const actionType = ACTION_TYPES.includes(raw?.action_type) ? raw.action_type : "general";
  const domain = String(raw?.domain || "general").toLowerCase();
  const channels = Array.isArray(raw?.channels)
    ? [...new Set(raw.channels.map((c) => String(c || "").toLowerCase().trim()).filter(Boolean))]
    : [];
  const visualOp = VISUAL_OPS.includes(raw?.visual_op) ? raw.visual_op : "none";
  return {
    action_type: actionType,
    domain,
    channels,
    occasion: raw?.occasion ? String(raw.occasion).trim() : null,
    audience: raw?.audience ? String(raw.audience).trim() : null,
    summary: raw?.summary ? String(raw.summary).trim() : message,
    visual_op: visualOp,
    visual_brief: null, // filled in at execution time by buildVisualBrief(), only when actually generating an image
    visual_style_signal: Boolean(raw?.visual_style_signal),
    target_aspect_ratio_hint: raw?.target_aspect_ratio_hint ? String(raw.target_aspect_ratio_hint).trim().slice(0, 80) : null,
    traits_used: [], // filled in at execution time alongside visual_brief
    preference_statement: Boolean(raw?.preference_statement),
    preference_updates: Boolean(raw?.preference_statement) && Array.isArray(raw?.preference_updates)
      ? raw.preference_updates
          .filter((u) => u?.category && u?.text)
          .slice(0, 10)
          .map((u) => ({ category: String(u.category), text: String(u.text).slice(0, 120), polarity: u.polarity === "negative" ? "negative" : "positive" }))
      : [],
    source: "llm"
  };
}

/**
 * LLM classification for anything the fast paths don't cover. Returns null
 * (never throws) on any provider failure so the caller can fall back to
 * plain chat rather than surface an error for a conversational turn.
 */
export async function classifyRequest(message, { hasImage = false } = {}) {
  const text = String(message || "").trim();
  if (!text) return null;
  try {
    const result = await runCloudflareGenerate({
      mode: "generate",
      persona: "Lily",
      task: CLASSIFY_TASK,
      // image_attached isn't counted against CLASSIFY_TASK's 1200-char
      // budget (that limit is on `task`, not `input`) — CLASSIFY_TASK
      // already tells the model "edit=change to something existing (incl.
      // attached photo)", so this one field is what lets a weak-signal
      // message like "make this nicer" with a photo attached actually
      // resolve to domain=photo instead of being read as plain chat.
      input: hasImage ? { message: text, image_attached: true } : { message: text },
      schema: CLASSIFY_SCHEMA,
      max_tokens: 450
    });
    if (!result?.result) return null;
    return normalizeClassification(result.result, text);
  } catch {
    return null;
  }
}

function visualBriefTask({ styleSummary } = {}) {
  return `Write a concrete, photographic backdrop description for an image-generation model — never vague ("a nice background" is unacceptable). This is for compositing: a real photo cutout of the florist's actual arrangement gets placed on top, so describe ONLY the empty background/surface/mood — never flowers, a bouquet, or any product.

Blend what THIS message asks for with the shop's usual style below — the current message always wins for anything it states; only use the shop's style to fill in what it left unsaid. If the message contradicts the shop's usual style ("dark and dramatic this time"), honor the message — that's a one-time choice, not a change to their standing style.

${styleSummary ? `This shop's usual style: ${styleSummary}` : "No learned style yet — use only the message, plus good taste."}

Return JSON:
- visual_brief: the finished backdrop description.
- traits_used: [{category,text}] — only shop-style traits from above that you actually wove in, [] if none.`;
}

const VISUAL_BRIEF_SCHEMA = {
  visual_brief: "string",
  traits_used: [{ category: "string", text: "string" }]
};

/**
 * The style-blending call — see this module's docstring for why it's
 * split from classifyRequest(). `occasion` (if any) is folded into the
 * message so the model has the full picture without a third field.
 * Returns a safe, non-null fallback (never throws) so a provider hiccup
 * degrades to "use the message as-is" rather than blocking generation.
 */
export async function buildVisualBrief(message, { styleSummary, occasion } = {}) {
  const text = String(message || "").trim();
  const withOccasion = occasion ? `${text} (occasion: ${occasion})` : text;
  try {
    const result = await runCloudflareGenerate({
      mode: "generate",
      persona: "Lily",
      task: visualBriefTask({ styleSummary }),
      input: { message: withOccasion },
      schema: VISUAL_BRIEF_SCHEMA,
      max_tokens: 350
    });
    const brief = result?.result?.visual_brief ? String(result.result.visual_brief).trim().slice(0, 1200) : null;
    const traitsUsed = Array.isArray(result?.result?.traits_used)
      ? result.result.traits_used
          .filter((t) => t?.category && t?.text)
          .slice(0, 20)
          .map((t) => ({ category: String(t.category), text: String(t.text).slice(0, 120) }))
      : [];
    return { visual_brief: brief || text, traits_used: traitsUsed };
  } catch {
    return { visual_brief: text, traits_used: [] };
  }
}
