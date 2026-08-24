/**
 * Marketing Studio's conversational revision loop — "make the background
 * brighter," "less pink," "I like this better, use this style from now
 * on." A revision is just another real generation call (generateImage /
 * generateSocialPost / generateVideoConcept, all already used by
 * generate_content) with the florist's instruction folded in as an
 * override that wins over any learned default for that one call — it
 * always produces a NEW child asset (parent_asset_id set on the new row),
 * never an in-place edit of the one being revised. No second AI/memory
 * system: this module only does deterministic text parsing; the actual
 * generation and the actual learned-style storage (ai-style-memory.js /
 * marketing-brand-brain.js) are the same modules generate_content and
 * approve_content already use.
 *
 * Reuses ai-visual-revisions.js's deterministic delta parser as-is for
 * scale/color/background-hint signals (never a second copy of that
 * regex set) — this module only adds what that one doesn't cover:
 * detecting "use this from now on," a plain "make this X" mood capture,
 * and the exact-fact-preservation check a wording revision must pass.
 */

import { parseRevisionDeltas } from "./ai-visual-revisions.js";

export { parseRevisionDeltas };

// "use this from now on" / "always use this" / "keep it this way going
// forward" / "save this as my style" / "that's my style now" — a real
// standing-preference signal, distinct from a one-time revision. Kept
// deliberately narrow: an ambiguous "I like this" ALONE (no "from now
// on"/"always"/"keep it"/"save") never matches, per the "never infer a
// permanent preference from ambiguous feedback" rule.
const PERSIST_INTENT_RE =
  /\b(use (this|it)( style)? from now on|always use this|keep (it|this)( style)?( going forward| from now on)?|save (this|it) as my style|that'?s my style now)\b/i;

export function detectPersistIntent(instruction) {
  return PERSIST_INTENT_RE.test(String(instruction || ""));
}

// "make this more elegant" / "make it dark and dramatic" — captures the
// florist's own literal adjective phrase, never a guessed category. Only
// fires on this specific narrow phrasing, not on arbitrary text, so it
// never risks putting an unrelated sentence fragment into My Style.
const MOOD_RE = /\bmake (?:this|it)(?: one)?(?: look| feel)?\s+(?:more\s+)?([a-z][a-z\s-]{2,40})$/i;

export function extractMoodPhrase(instruction) {
  const m = String(instruction || "").trim().match(MOOD_RE);
  return m ? m[1].trim().replace(/[.!?]+$/, "") : null;
}

// Facts a revision must never silently drop or reword: phone numbers,
// dollar amounts, URLs, dates, times — anything the florist gave verbatim
// and didn't ask this revision to touch.
const PHONE_RE = /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
const PRICE_RE = /\$\d+(?:\.\d{2})?/g;
const URL_RE = /\bhttps?:\/\/\S+/gi;
const DATE_RE =
  /\b(?:\d{1,2}\/\d{1,2}\/\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{2,4})?)\b/gi;
// A bare clock time ("2:30", "2:30pm", "14:30") — a real pickup/delivery
// time is exactly as fact-sensitive as a date, and got its own regex only
// after a real gap was found: a time-only mention (no date attached) was
// previously not tracked as a fact at all.
const TIME_RE = /\b([01]?\d|2[0-3]):[0-5]\d\s*(?:am|pm|AM|PM)?\b/g;

export function extractFactTokens(text) {
  const source = String(text || "");
  const tokens = new Set();
  for (const re of [PHONE_RE, PRICE_RE, URL_RE, DATE_RE, TIME_RE]) {
    for (const m of source.matchAll(re)) tokens.add(m[0]);
  }
  return [...tokens];
}

/** True only if every fact token found in the ORIGINAL text still appears
 * verbatim in the revised text. A revision that would drop or reword a
 * real phone number/date/time/price/URL fails this — the caller must refuse
 * the revision rather than silently lose (or paraphrase) a business fact
 * the florist never asked to change. */
export function factsPreserved(originalText, revisedText) {
  const tokens = extractFactTokens(originalText);
  if (!tokens.length) return true;
  const revised = String(revisedText || "");
  return tokens.every((t) => revised.includes(t));
}

/** Derives the best-effort, never-fabricated trait(s) a revision actually
 * applied — used both to remember on the new asset (so a later bare "use
 * this from now on" has something concrete to point back to) and, when
 * persist-intent fires in the SAME message, to write straight into My
 * Style. Every entry traces directly back to the florist's own literal
 * words in `instruction` — nothing here is inferred or guessed. */
export function deriveRevisionTraits(instruction, deltas) {
  const traits = [];
  if (deltas?.backgroundHint) traits.push({ category: "background_style", text: deltas.backgroundHint, polarity: "positive" });
  for (const color of deltas?.colorsAdd || []) traits.push({ category: "colors", text: color, polarity: "positive" });
  for (const color of deltas?.colorsRemove || []) traits.push({ category: "colors", text: color, polarity: "negative" });
  const mood = extractMoodPhrase(instruction);
  if (mood) traits.push({ category: "mood", text: mood, polarity: "positive" });
  return traits;
}

/** The real image-revision prompt text — folds the instruction in as an
 * override, with an explicit subject-preservation clause so a
 * background/style-only request doesn't also regenerate the product.
 * This is a prompt-level instruction to the model, not pixel-level
 * compositing — same honesty level as ai-orchestrator.js's own
 * creative.reviseVisual background step ("matching the same overall
 * composition"), not a guarantee the product pixels are identical. */
export function buildImageRevisionBrief({ instruction, priorVisualBrief }) {
  const base = priorVisualBrief ? `Previous version's visual concept, for reference only: ${priorVisualBrief}` : "";
  return [
    `Revise the visual as requested: ${instruction}`,
    "Keep the same flowers/arrangement/product exactly as shown before — do not change, remove, or redesign the product itself unless the instruction explicitly asks for that.",
    "Only change what the instruction actually asks for; leave everything else about the composition the same.",
    base
  ]
    .filter(Boolean)
    .join(" ");
}

/** The real wording-revision request text for generateSocialPost /
 * generateVideoConcept — folds the instruction in as the CURRENT request
 * (which those prompts already treat as overriding any learned-style
 * default), referencing the prior text so the model edits rather than
 * starts over. */
export function buildWordingRevisionRequestText({ instruction, brief, priorText }) {
  return [
    brief || "",
    `Revision instruction — apply this now, overriding your own judgment and any learned style default for this one edit only: ${instruction}`,
    priorText ? `Previous version, for reference — keep everything the same except what the instruction above asks to change (never drop or reword an exact phone number, date, price, or link that isn't the target of this instruction): ${priorText}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}
