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

const CLASSIFY_TASK = `Classify what a florist wants Florisyn's AI to do. Read the ENTIRE sentence before deciding — never classify from a single keyword. A sentence that mentions "website" is not automatically navigation; a sentence that mentions "Facebook" is not automatically a single post if it also asks for a campaign or more than one channel.

Return JSON with:
- action_type: one of question, create, campaign, video, edit, diagnosis, navigation, scheduling, publishing, data_retrieval, general. Use "campaign" whenever the request spans more than one channel or more than one deliverable (e.g. a post AND a website section). Use "create" for one finished piece of content on one channel. Use "video" for any Reel/video/short-form-video request, even inside a larger campaign — video always gets this label so Florisyn can note it separately.
- domain: which part of Florisyn this concerns — marketing, website, photo, inventory, orders, customers, events, wholesale, reports, employees, support, or general.
- channels: array from facebook, instagram, google_business, email, sms, website, blog — every channel mentioned or clearly implied. Empty array if none.
- occasion: the event/holiday/theme this is about (e.g. "Homecoming"), or null.
- audience: who this should reach, in the user's own words, or null.
- summary: one sentence restating exactly what Florisyn should produce or do — written as an instruction to actually do it, not a description of the request.`;

const CLASSIFY_SCHEMA = {
  action_type: "string",
  domain: "string",
  channels: ["string"],
  occasion: "string|null",
  audience: "string|null",
  summary: "string"
};

function normalizeClassification(raw, message) {
  const actionType = ACTION_TYPES.includes(raw?.action_type) ? raw.action_type : "general";
  const domain = String(raw?.domain || "general").toLowerCase();
  const channels = Array.isArray(raw?.channels)
    ? [...new Set(raw.channels.map((c) => String(c || "").toLowerCase().trim()).filter(Boolean))]
    : [];
  return {
    action_type: actionType,
    domain,
    channels,
    occasion: raw?.occasion ? String(raw.occasion).trim() : null,
    audience: raw?.audience ? String(raw.audience).trim() : null,
    summary: raw?.summary ? String(raw.summary).trim() : message,
    source: "llm"
  };
}

/**
 * LLM classification for anything the fast paths don't cover. Returns null
 * (never throws) on any provider failure so the caller can fall back to
 * plain chat rather than surface an error for a conversational turn.
 */
export async function classifyRequest(message) {
  const text = String(message || "").trim();
  if (!text) return null;
  try {
    const result = await runCloudflareGenerate({
      mode: "generate",
      persona: "Lily",
      task: CLASSIFY_TASK,
      input: { message: text },
      schema: CLASSIFY_SCHEMA,
      max_tokens: 400
    });
    if (!result?.result) return null;
    return normalizeClassification(result.result, text);
  } catch {
    return null;
  }
}
