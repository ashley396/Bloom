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

// "use this from now on" / "always use this" / "always do this" / "keep it
// this way going forward" / "save this as my style" / "remember this
// (style)" / "that's my style now" / a leading "from now on, ... like
// this" — a real standing-preference signal, distinct from a one-time
// revision. Kept deliberately narrow: an ambiguous "I like this" ALONE (no
// "from now on"/"always"/"keep it"/"save"/"remember") never matches, per
// the "never infer a permanent preference from ambiguous feedback" rule —
// and an ordinary revision that merely happens to mention "today"/"early"/
// timing ("make it clear we are only closing early today") never matches
// any of these branches either.
const PERSIST_INTENT_RE =
  /\b(use (this|it)( style)? from now on|always (use this|do this)|keep (it|this)( style)?( going forward| from now on)?|save (this|it) as my style|remember (this|it)( style)?\b|that'?s my style now|from now on,? (make|do|use) .{0,40}\blike this\b)/i;

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

// A real, live-found failure mode (not hypothetical): "closing at 2:30
// today, call XXX-XXX-XXXX to order" got written back as a farewell/
// going-out-of-business announcement ("it's with a mix of sadness and
// gratitude that we announce we will be closing..."). The model's own
// prompt instruction (buildSocialPostTask) is the first line of defense,
// but a prompt instruction is a request, not a guarantee — this is the
// deterministic backstop: a request that only ever signals a TEMPORARY,
// scheduled change (closing early/today/for the holiday/temporarily) and
// never signals permanence must never come back reading as a permanent
// closure. Generic on purpose — no shop name, no specific business is
// hardcoded; every florist's "closing early today" post is protected the
// same way.
const TEMPORARY_CLOSURE_SIGNAL_RE =
  /\b(clos(?:ing|ed))\b[^.!?\n]{0,30}\b(early|today|tonight|this afternoon|for the (?:day|holiday|afternoon)|temporarily|briefly|for a few hours)\b|\btemporarily closed\b|\bclosing at\b[^.!?\n]{0,20}\b(today|tonight|this afternoon)\b/i;

// If ANY of these appear in the same request, the florist has genuinely
// said this is permanent — the guard must never override an explicit,
// real instruction.
const PERMANENT_CLOSURE_INTENT_RE =
  /\bclos(?:ing|ed)\b[^.!?\n]{0,20}\b(permanently|for good)\b|\bgoing out of business\b|\bour last day\b|\bshutting down\b|\bclosing (?:our )?(?:doors|shop|store) for good\b|\bafter \d+\s*(?:years?|yrs?)[^.!?\n]{0,40}\bclosing\b/i;

/** True only when the florist's own request signals a TEMPORARY change and
 * never signals a permanent one — the one case where generated output must
 * be held to the temporary-language guard below. */
export function requestSignalsTemporaryClosure(requestText) {
  const text = String(requestText || "");
  return TEMPORARY_CLOSURE_SIGNAL_RE.test(text) && !PERMANENT_CLOSURE_INTENT_RE.test(text);
}

/** True when the florist's own request explicitly says the closure IS
 * permanent — the guard must always defer to this. */
export function requestSignalsPermanentClosure(requestText) {
  return PERMANENT_CLOSURE_INTENT_RE.test(String(requestText || ""));
}

// The actual farewell/shutting-down phrasing a model can drift into —
// sadness-and-gratitude framing, "our last day," "shutting down," "this
// chapter," "we will no longer be" — never a single word like "closing"
// alone (which is completely normal in a temporary-hours post too).
const PERMANENT_CLOSURE_LANGUAGE_RE =
  /\bwith (?:a mix of )?sadness and gratitude\b|\bit is with (?:a )?heavy heart\b|\bour last day\b|\bclosing (?:our )?(?:doors|shop|store)(?: for good)?\b|\bgoing out of business\b|\bshutting down\b|\bthis chapter (?:comes to a close|closes)\b|\bwe will no longer be (?:open|serving|operating)\b|\bfarewell\b|\bafter \d+\s*(?:wonderful\s+)?(?:years?|yrs?)[^.!?\n]{0,40}\bclosing\b/i;

/** Does this generated text read as a PERMANENT closure? Used only after
 * requestSignalsTemporaryClosure() already confirmed the request itself
 * never asked for that. */
export function textReadsAsPermanentClosure(text) {
  return PERMANENT_CLOSURE_LANGUAGE_RE.test(String(text || ""));
}

/** The one function callers actually need: true iff a temporary-closure
 * request came back reading like a permanent one — the exact live defect.
 * A genuinely permanent request (requestSignalsPermanentClosure) never
 * trips this, by construction. */
export function detectPermanentClosureMismatch(requestText, generatedText) {
  return requestSignalsTemporaryClosure(requestText) && textReadsAsPermanentClosure(generatedText);
}

// A real, live-found failure mode (not hypothetical): "closing at 2:30
// today, call 606-506-4039" got handed to the AI IMAGE model as a visual
// concept — a diffusion model asked to paint legible words produces
// garbled nonsense ("Reserve you with whote striding," "6.13:19:30"), not
// the real business text. The fix isn't a better prompt: any request
// whose important information IS the message (a closing time, a phone
// number, a price, a sale, an event date, an address, an order deadline,
// an announcement) must route to the deterministic flyer path
// (generateFlyerContent + public/flyer-renderer.js) instead — real text,
// drawn by Florisyn's own renderer, never asked of an image model. A
// request with no such signal (a plain "post about our roses today")
// keeps using a photo-only image, no on-image text asked for at all. Reuses
// the same PHONE_RE/PRICE_RE/DATE_RE/TIME_RE fact-token detection above —
// any of those already means "this request carries information that must
// be exact and readable," the same bar a flyer exists to guarantee.
const FLYER_WORDING_KEYWORDS_RE =
  /\b(clos(?:ing|ed)|open(?:ing)?|hours?|business hours)\b|\b(sale|%\s?off|percent off|discount|promo(?:tion)?|special offer)\b|\bevent\b|\brsvp\b|\b(deadline|order by|cutoff|last day to order)\b|\bannounc(?:e|ing|ement)\b|\b(address|located at|find us at)\b/i;

/** True when a request's important information needs to be VISIBLE and
 * EXACT on the graphic itself — the deterministic flyer signal. Any real
 * fact token (phone/price/date/time) is enough on its own; so is one of
 * the plain operational/promotional keywords above. Never fires on an
 * ordinary decorative/celebratory request with no such signal — that stays
 * a plain photo-only image, per requirement 10. */
export function requestNeedsFlyerWording(text) {
  const s = String(text || "");
  if (extractFactTokens(s).length) return true;
  return FLYER_WORDING_KEYWORDS_RE.test(s);
}

// A revision instruction can ask to change the FACTS on an existing flyer
// ("actually we're closing at 3, not 2:30") or explicitly reference the
// graphic's own wording ("make the headline shorter", "fix the text on the
// flyer") without necessarily repeating a fact token — both must trigger a
// real re-render of the deterministic text layer, not just a caption edit.
const FLYER_TEXT_REFERENCE_RE = /\b(flyer|the graphic|the sign|headline|the wording|on the image|the banner)\b/i;

/** True when a revision to a flyer-type asset needs the deterministic text
 * layer (headline/body/cta) regenerated, not just the Facebook caption.
 * An ordinary caption-only revision ("make it more cheerful", "shorter and
 * warmer") never matches this — only a change that actually affects what's
 * printed on the graphic does. */
export function instructionAffectsFlyerWording(instruction) {
  const s = String(instruction || "");
  return requestNeedsFlyerWording(s) || FLYER_TEXT_REFERENCE_RE.test(s);
}

// "change the image" / "regenerate the background" / "try a different
// photo" / "new picture" / "different flowers in the background" — a
// request to re-roll the AI-generated floral photo behind the text, never
// a request to change the wording. Deliberately separate from
// instructionAffectsFlyerWording above: a florist can ask for either, or
// both, in the same sentence ("change the image and make the headline
// shorter"), and each only touches the layer it actually names.
const FLYER_IMAGE_CHANGE_RE =
  /\b(change|regenerate|redo|try (a )?different|new|different|swap|another)\b.{0,25}\b(image|photo|picture|background|flowers? (shown|in the background|behind))\b/i;

/** True when a revision instruction asks to re-roll the flyer's AI-generated
 * photographic background — the "Regenerate image" action, whether typed
 * out or sent via the one-click button (which sends this same kind of
 * plain-language instruction, never a raw provider prompt). Never fires on
 * an ordinary wording/caption revision that doesn't mention the image at
 * all. */
export function instructionAffectsFlyerImage(instruction) {
  return FLYER_IMAGE_CHANGE_RE.test(String(instruction || ""));
}
