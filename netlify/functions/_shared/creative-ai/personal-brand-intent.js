/**
 * Personal Brand Studio — Lily command understanding (Section 8 of the
 * directive).
 *
 * Same architecture as ai-intent-router.js's classifyRequest(): a real LLM
 * classification call reading the whole sentence, never a regex-only
 * keyword match — the directive is explicit ("Do not fall back to a
 * regex-only intent architecture"). Returns null (never throws) on any
 * provider failure so a caller can fall back to plain chat, matching every
 * other classifier in this codebase.
 *
 * This module only classifies — it does not decide whether an action is
 * *authorized* (consent/authorization live in personal-brand-consent.js)
 * or perform any generation itself (that's personal-brand-concept.js).
 */

import { runCloudflareGenerate } from "../../ai-assistant.js";
import { PERSONAL_BRAND_MODE_KEYS } from "./personal-brand-modes.js";
import { SUPPORTED_PLATFORMS } from "../marketing-social-providers.js";

export const MEMORY_ACTIONS = Object.freeze(["remember_like", "remember_avoid", "forget", "none"]);
export const CONTENT_FORMATS = Object.freeze(["post", "carousel", "reel", "pin", "short", "story", null]);

const CLASSIFY_TASK = `Classify what a florist wants Lily (Florisyn's AI) to do with THEIR OWN personal/founder brand — how they show up in their own marketing, not their shop's general brand voice. Read the whole sentence — never classify from one keyword.

Return JSON:
- mode: one of ${PERSONAL_BRAND_MODE_KEYS.join("|")} — the closest personal-brand creation mode, or null if this isn't a creation request at all.
- memory_action: remember_like|remember_avoid|forget|none. remember_like/remember_avoid ONLY for a real standing statement ("I love this background, remember this style" / "I don't dress like that, remember it" / "don't use this hairstyle again") — never a one-off. forget ONLY for an explicit "forget"/"stop remembering" request.
- memory_category: string|null — a short category name for the remembered trait (e.g. "clothing_style", "environment_shop", "lighting"), only when memory_action is not none.
- memory_text: string|null — the specific trait text, only when memory_action is not none.
- use_digital_twin: true only if the message explicitly asks to use the AI avatar/Digital Twin ("use my Digital Twin", "make this a video of me").
- use_voice: true only if the message explicitly asks to use the cloned voice.
- suppress_voice: true only if the message explicitly says NOT to use the voice ("don't use my voice").
- target_platform: one of ${SUPPORTED_PLATFORMS.join("|")} or null.
- content_format_hint: post|carousel|reel|pin|short|story|null — e.g. "turn this into a Reel" -> reel, "make this a Pinterest Pin" -> pin, "turn this into a YouTube Short" -> short.
- tone_hint: professional|casual|humorous|null.
- summary: one sentence.`;

const CLASSIFY_SCHEMA = {
  mode: "string|null",
  memory_action: "string",
  memory_category: "string|null",
  memory_text: "string|null",
  use_digital_twin: "boolean",
  use_voice: "boolean",
  suppress_voice: "boolean",
  target_platform: "string|null",
  content_format_hint: "string|null",
  tone_hint: "string|null",
  summary: "string"
};

function normalize(raw, message) {
  const mode = PERSONAL_BRAND_MODE_KEYS.includes(raw?.mode) ? raw.mode : null;
  const memoryAction = MEMORY_ACTIONS.includes(raw?.memory_action) ? raw.memory_action : "none";
  const targetPlatform = SUPPORTED_PLATFORMS.includes(raw?.target_platform) ? raw.target_platform : null;
  const contentFormat = ["post", "carousel", "reel", "pin", "short", "story"].includes(raw?.content_format_hint) ? raw.content_format_hint : null;
  const toneHint = ["professional", "casual", "humorous"].includes(raw?.tone_hint) ? raw.tone_hint : null;
  return {
    mode,
    memory_action: memoryAction,
    memory_category: memoryAction !== "none" && raw?.memory_category ? String(raw.memory_category).trim().slice(0, 60) : null,
    memory_text: memoryAction !== "none" && raw?.memory_text ? String(raw.memory_text).trim().slice(0, 160) : null,
    use_digital_twin: Boolean(raw?.use_digital_twin),
    use_voice: Boolean(raw?.use_voice),
    suppress_voice: Boolean(raw?.suppress_voice),
    target_platform: targetPlatform,
    content_format_hint: contentFormat,
    tone_hint: toneHint,
    summary: raw?.summary ? String(raw.summary).trim() : message,
    source: "llm"
  };
}

/**
 * Classifies one Personal Brand Studio command. Returns null (never
 * throws) on any provider failure — same defensive contract as
 * ai-intent-router.js's classifyRequest().
 */
export async function classifyPersonalBrandCommand(message) {
  const text = String(message || "").trim();
  if (!text) return null;
  try {
    const result = await runCloudflareGenerate({
      mode: "generate",
      persona: "Lily",
      task: CLASSIFY_TASK,
      input: { message: text },
      schema: CLASSIFY_SCHEMA,
      max_tokens: 350
    });
    if (!result?.result) return null;
    return normalize(result.result, text);
  } catch {
    return null;
  }
}
