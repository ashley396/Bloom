/**
 * Personal Brand Studio — founder-concept generation.
 *
 * Reuses the same underlying LLM primitive (runCloudflareGenerate) every
 * other Creative AI generator in this codebase uses (ai-creative-engine.js's
 * generateSocialPost/generateVideoConcept/generateFlyerContent are the
 * direct precedent) — this is a new schema/task tailored to founder-
 * presence content, not a competing generation engine.
 *
 * Grounding is entirely per-florist: the mode's prompt guidance, THIS
 * shop's profile fields (display name/founder title/founder story) and
 * THIS shop's active learned personal-brand traits are the only source of
 * "what this florist looks/acts like" — nothing here is specific to any
 * one real person. See tests/personal-brand-acceptance.test.js for the
 * explicit multi-shop non-hardcoding check.
 */

import { runCloudflareGenerate } from "../../ai-assistant.js";
import { getPersonalBrandMode } from "./personal-brand-modes.js";

const TONE_GUIDANCE = Object.freeze({
  professional: "Keep the tone polished and business-appropriate.",
  casual: "Keep the tone relaxed and approachable.",
  humorous: "Lean genuinely funny — real personality-driven humor, not a generic joke."
});

const BALANCE_GUIDANCE = Object.freeze({
  professional: "professional and polished",
  balanced: "a natural balance of professional and personable",
  casual: "casual and relatable"
});

/**
 * Builds the generation task text. Pure and independently testable — the
 * thing tests/personal-brand-acceptance.test.js checks is that a real
 * florist's own profile/traits/founder story appear here, and that no
 * other florist's data leaks in.
 */
export function buildPersonalBrandConceptTask({ mode, profile, styleSummary, toneHint } = {}) {
  const modeInfo = getPersonalBrandMode(mode);
  const balance = BALANCE_GUIDANCE[profile?.professional_casual_balance] || BALANCE_GUIDANCE.balanced;
  const lines = [
    `You are writing the ACTUAL, FINISHED founder/personal-brand content for a specific florist — never a generic template, never a description of what the content could be. This is Personal Brand Studio: it's about how THIS florist personally shows up in their own marketing, not their shop's general brand voice.`,
    ``,
    `Mode: ${modeInfo.label} — ${modeInfo.promptGuidance}`,
    `Default tone for this florist: ${balance}.`,
    toneHint && TONE_GUIDANCE[toneHint] ? TONE_GUIDANCE[toneHint] : null,
    profile?.display_name ? `Founder's name: ${profile.display_name}.` : null,
    profile?.founder_title ? `Founder's title: ${profile.founder_title}.` : null,
    mode === "founder_story" && profile?.founder_story
      ? `This florist's own stated founder story (use this, never invent a different one): ${profile.founder_story}`
      : null,
    styleSummary ? `This florist's learned personal-presentation preferences: ${styleSummary}` : null,
    ``,
    `Rules:`,
    `- Never restate or describe the request itself — the output must be usable as-is.`,
    `- Ground everything in the specific founder details given above — never invent a backstory, product, price, or promise Florisyn can't confirm.`,
    `- founder_presence_brief must describe concretely what the founder should look like/be doing in-frame (drawing on their stated preferences above where given) — separate from the overall scene description.`
  ].filter(Boolean);
  return lines.join("\n");
}

const CONCEPT_SCHEMA = {
  headline: "string",
  body: "string — the complete finished post/caption text, ready to publish as-is",
  cta: "string",
  visual_brief: "string — the overall scene/shot concept",
  founder_presence_brief: "string — concretely what the founder should look like/be doing in-frame",
  hashtags: ["string"]
};

/**
 * Generates one finished Personal Brand founder concept. Never throws —
 * returns { ok:false, error } on any failure, matching every sibling
 * generator in ai-creative-engine.js.
 */
export async function generatePersonalBrandConcept({ mode, profile, styleSummary, toneHint, requestText } = {}) {
  try {
    const result = await runCloudflareGenerate({
      mode: "generate",
      persona: "Lily",
      task: buildPersonalBrandConceptTask({ mode, profile, styleSummary, toneHint }),
      input: { request: requestText || "" },
      schema: CONCEPT_SCHEMA,
      max_tokens: 700
    });
    const concept = result?.result;
    if (!concept || !concept.body) return { ok: false, error: "The AI didn't return usable founder-concept content. Try again." };
    return {
      ok: true,
      content: {
        mode,
        headline: String(concept.headline || "").slice(0, 200),
        body: String(concept.body || "").slice(0, 3000),
        cta: String(concept.cta || "").slice(0, 200),
        visual_brief: String(concept.visual_brief || "").slice(0, 600),
        founder_presence_brief: String(concept.founder_presence_brief || "").slice(0, 600),
        hashtags: Array.isArray(concept.hashtags) ? concept.hashtags.slice(0, 15).map(String) : []
      },
      model: result.model
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
}
