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
import { requestIsJustShopName, significantWords } from "./ai-creative-engine.js";

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
    // Trimmed for the same reason firstMatch() trims: TIME_RE's trailing
    // `\s*(?:am|pm)?` swallows a trailing space when no am/pm follows
    // ("2:30 tomorrow" → "2:30 "). An untrimmed token is not the fact —
    // it's the fact plus whitespace — and it made both consumers wrong:
    // factsPreserved() demanded a trailing space that correct wording
    // needn't have, and buildDeterministicNoticeContent's missing-fact
    // safety net re-appended a time the body ALREADY contained (a real
    // observed defect: "…Time: 2:30. 2:30").
    for (const m of source.matchAll(re)) {
      const token = m[0].trim();
      if (token) tokens.add(token);
    }
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
// A real, live-found failure: this function's own OUTPUT used to become the
// NEXT revision's priorVisualBrief, nesting the ENTIRE prior brief inside a
// fresh "Previous version's visual concept, for reference only: ..."
// wrapper every revision — unbounded growth that could exceed
// buildImagePrompt's length budget after just a couple of revisions.
// marketing-studio.js's revise_content now instead carries forward a
// STABLE base_visual_brief (the real original description, never this
// function's own compounded output) as priorVisualBrief on every call, so
// priorVisualBrief here is normally short and never grows on its own. This
// cap is defense in depth for any caller that doesn't follow that pattern
// (proven by this file's own "chaining its own output back in" test) —
// bounding it can never hurt, and it protects against a real, if unlikely,
// original description sitting near generateSocialPost's own 600-char cap.
const MAX_PRIOR_VISUAL_BRIEF_CHARS = 600;

/** The real image-revision prompt text — folds the instruction in as an
 * override, with an explicit subject-preservation clause so a
 * background/style-only request doesn't also regenerate the product.
 * This is a prompt-level instruction to the model, not pixel-level
 * compositing — same honesty level as ai-orchestrator.js's own
 * creative.reviseVisual background step ("matching the same overall
 * composition"), not a guarantee the product pixels are identical.
 *
 * ORDER MATTERS: buildImagePrompt (ai-image-engine.js) fits an over-length
 * visual_brief to budget by truncating from the END (word-boundary-safe),
 * never by dropping the whole clause — so whatever sits at the FRONT of
 * this function's own output is what survives when something has to give.
 * The actual subject (priorVisualBrief — the one thing that names what the
 * photo must show) is put first for exactly that reason; the instruction
 * comes next; the generic "keep everything else the same" boilerplate,
 * which carries no image-specific information and is identical on every
 * call, goes last — it is the safest thing here to lose to truncation. */
export function buildImageRevisionBrief({ instruction, priorVisualBrief }) {
  const trimmedPrior = priorVisualBrief ? String(priorVisualBrief).slice(0, MAX_PRIOR_VISUAL_BRIEF_CHARS) : "";
  const base = trimmedPrior ? `The photo must still show: ${trimmedPrior}.` : "";
  return [
    base,
    `Now revise as requested: ${instruction}`,
    "Keep the same flowers/arrangement/product exactly as shown before — do not change, remove, or redesign the product itself unless the instruction explicitly asks for that.",
    "Only change what the instruction actually asks for; leave everything else about the composition the same."
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
// "tomorrow" and bare weekdays were missing here too, so "closing at 2:30
// tomorrow" never registered as a temporary closure at all and fell
// through to the generic Store Notice bucket, losing the closing meaning.
// Adding them is safe in both directions: PERMANENT_CLOSURE_INTENT_RE
// still overrides (requestSignalsTemporaryClosure requires it NOT match),
// and a scheduled day is by definition a temporary, scheduled change.
const TEMPORARY_CLOSURE_SIGNAL_RE =
  /\b(clos(?:ing|ed))\b[^.!?\n]{0,30}\b(early|today|tonight|tomorrow|this afternoon|this (?:mon|tues|wednes|thurs|fri|satur|sun)day|on (?:mon|tues|wednes|thurs|fri|satur|sun)day|for the (?:day|holiday|afternoon)|temporarily|briefly|for a few hours)\b|\btemporarily closed\b|\bclosing at\b[^.!?\n]{0,20}\b(today|tonight|tomorrow|this afternoon|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i;

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

// The florist naming the thing they want made. "A flyer", "a poster", "a
// graphic", "an ad" is a request for a designed piece, and it is not a
// judgement call — it is what they asked for. Astonishingly, "make me a
// flyer to get more funeral business" did not previously produce a flyer.
const DESIGNED_ARTEFACT_RE = /\b(flyer|flier|poster|graphic|banner|signage|advert(?:isement)?|\bads?\b)\b/i;

// A post whose JOB is to win work. "Generate more funeral work", "get more
// wedding business", "bring in more orders", "advertise our sympathy
// arrangements" — these are advertisements, and an advertisement with no
// shop name, no message and no phone number on it is just a stock photo.
// This is the case Ashley hit: a request to generate more funeral work came
// back as a bare AI photograph with no design on it whatsoever.
const PROMOTIONAL_INTENT_RE =
  /\b(?:get|generate|bring in|drive|attract|win|boost|increase|grow|more)\b[^.!?]{0,40}\b(business|work|orders?|customers?|clients?|bookings?|enquir(?:y|ies)|inquir(?:y|ies)|sales|traffic)\b/i;
const PROMOTE_VERB_RE = /\b(advertise|advertising|promote|promoting|promotion|market(?:ing)? (?:post|piece)|let (?:people|customers|everyone) know)\b/i;

/** True when a request's important information needs to be VISIBLE and
 * EXACT on the graphic itself — the deterministic flyer signal. Any real
 * fact token (phone/price/date/time) is enough on its own; so is one of
 * the plain operational/promotional keywords above; so is the florist
 * naming a designed artefact, or asking for a post whose purpose is to win
 * business. Never fires on an ordinary decorative or celebratory request
 * with no such signal — "make me an image of a jaguar holding roses" is a
 * picture, and stays a picture, per requirement 10. */
export function requestNeedsFlyerWording(text) {
  const s = String(text || "");
  if (extractFactTokens(s).length) return true;
  if (FLYER_WORDING_KEYWORDS_RE.test(s)) return true;
  if (DESIGNED_ARTEFACT_RE.test(s)) return true;
  return PROMOTIONAL_INTENT_RE.test(s) || PROMOTE_VERB_RE.test(s);
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

// A real, live-found failure mode (not hypothetical): "closing at 2:30
// today, call 606-506-4039 to order" — a plain operational notice with no
// sale/celebration/event signal of its own — came back with invented
// wording never asked for: "Place your final orders now," "Prepare for a
// special event," "We look forward to serving you again soon." None of
// that is a permanent-closure claim (textReadsAsPermanentClosure wouldn't
// catch it), so it needed its own guard. Deliberately narrow to requests
// that carry NO sale/promotional signal of their own — a real sale/event
// post is allowed festive, urgency, or "see you there" language because
// the florist's own request already invited it; only a plain notice must
// stay exactly as plain as what was actually said.
const PLAIN_NOTICE_SIGNAL_RE =
  /\b(clos(?:ing|ed))\b|\b(open(?:ing)?|hours?|business hours)\b|\b(deadline|order by|cutoff|last day to order)\b|\bannounc(?:e|ing|ement)\b/i;
const PROMOTIONAL_SIGNAL_RE = /\b(sale|%\s?off|percent off|discount|promo(?:tion)?|special offer|event|rsvp|class|workshop)\b/i;

/** True only when the request is a plain operational/informational notice
 * — a schedule change, a closing time, a deadline, an announcement — with
 * no sale/event/celebration signal of its own that would legitimately
 * invite festive or urgent language. */
export function requestSignalsPlainOperationalNotice(requestText) {
  const text = String(requestText || "");
  return PLAIN_NOTICE_SIGNAL_RE.test(text) && !PROMOTIONAL_SIGNAL_RE.test(text);
}

// A narrower slice of PROMOTIONAL_SIGNAL_RE — specifically a real
// sale/discount/offer, not merely "an event" (a wedding show, a class),
// which legitimately belongs to a different objective (seasonal_occasion/
// awareness) and isn't itself evidence the shop is running a promotion.
const REAL_PROMOTION_SIGNAL_RE = /\b(sale|%\s?off|percent off|discount|promo(?:tion)?|special offer|coupon|deal|bogo|buy one get one)\b/i;

/** Phase 3 live-test fix (objective must become functional, requirement
 * 9-I): a real promotion is a claim about the business, exactly like a
 * shipment or a phone number — it must be supported by what the florist
 * actually said, never invented just because "promotion" sounds like a
 * more exciting objective for the model to pick. Used to downgrade/reject
 * a self-reported "promotion" objective that has no real promotional
 * signal in the request. */
export function requestSignalsRealPromotion(requestText) {
  return REAL_PROMOTION_SIGNAL_RE.test(String(requestText || ""));
}

// The actual invented phrasing a model can drift into on a plain notice —
// manufactured urgency ("final orders," "last chance," "act now"), a
// manufactured future plan/event ("prepare for," "get ready for," "special
// event," "coming soon"), or an unrequested farewell/gratitude flourish
// ("we appreciate your understanding," "we look forward to serving you
// again," "see you again soon"). None of these are permanent-closure
// language on their own — this is a distinct failure mode from
// textReadsAsPermanentClosure above.
const INVENTED_NOTICE_EMBELLISHMENT_RE =
  /\bplace your (?:final|last) orders?\b|\bfinal orders?\b|\blast chance\b|\bdon'?t miss out\b|\bact now\b|\bbefore it'?s too late\b|\bhurry\b|\bprepare for\b|\bget ready for\b|\bstay tuned\b|\bcoming soon\b|\bspecial event\b|\bwe look forward to (?:serving|seeing) you\b|\bsee you (?:again )?soon\b|\bwe appreciate your (?:understanding|patience)\b|\bthank you for your (?:understanding|patience)\b/i;

/** Does this generated text add invented urgency, a fabricated future plan/
 * event, or an unrequested farewell flourish to a plain operational
 * notice? Used only after requestSignalsPlainOperationalNotice() already
 * confirmed the request itself never invited that kind of language. */
export function textAddsInventedEmbellishment(text) {
  return INVENTED_NOTICE_EMBELLISHMENT_RE.test(String(text || ""));
}

/** The one function callers actually need: true iff a plain operational
 * request came back with invented urgency/future-plans/farewell language
 * it never asked for — the exact live defect (distinct from, and checked
 * alongside, detectPermanentClosureMismatch above). */
export function detectInventedOperationalContent(requestText, generatedText) {
  return requestSignalsPlainOperationalNotice(requestText) && textAddsInventedEmbellishment(generatedText);
}

// Real, live-found failure (Ashley's own real branch-deploy test): once
// the guard above correctly rejects a model's response, simply reverting
// the content item to "idea" and making the florist click "Ask Lily to
// create it" again is not acceptable — the florist already gave every
// fact Lily needs in one message. buildDeterministicNoticeContent is the
// safe path forward: it rebuilds plain, honest wording directly from the
// request's own verified fact tokens (a time, a phone number, a date —
// extractFactTokens, the same extraction the facts-preservation guard
// already trusts) and the shop's own real phone when the request didn't
// repeat one — NO AI call, so by construction it can never itself invent
// a reason, urgency, or future plan. Never hardcodes a shop name, time,
// or phone number — every value here is either lifted verbatim from the
// request or passed in from real shop data. Returns null only when the
// request carries no recognizable operational category AND no phone/time
// fact at all — in practice this guard only ever runs after
// requestSignalsPlainOperationalNotice() already confirmed the request
// DOES carry an operational signal, so null is a rare last-resort case,
// not the common path.
// Real, live-found defect (pre-live-test verification): this list carried
// no "tomorrow" and no weekday, and every closing/opening branch below
// defaulted its qualifier to the literal string "today" when nothing
// matched. So "Bud is opening late tomorrow at 10:30" rendered as
// "Opening Late Today" / "…is opening at 10:30 today." — the flyer told
// this shop's customers the WRONG DAY. That is worse than dropping a
// fact: it fabricates one, and it is exactly what the no-invented-content
// rule exists to prevent.
//
// Generic by construction — no shop, date, or time is hardcoded; any
// florist's "tomorrow"/"on Friday" post is preserved verbatim the same way.
const WEEKDAY_SOURCE = "(?:mon|tues|wednes|thurs|fri|satur|sun)day";
// WHICH DAY, matched on its own — deliberately separate from the
// "early/temporarily" modifier below. A single combined alternation looks
// like it would work but doesn't: JS alternation is leftmost-FIRST, not
// longest-first, so in "closing early on Friday at 2:30" the engine
// reaches "early" first and stops, and the named day is silently dropped
// from the headline, the body AND the caption. A weekday is not a DATE_RE
// token either, so the missing-fact safety net could not recover it.
const DAY_QUALIFIER_RE = new RegExp(
  "\\b(today|tonight|tomorrow|this morning|this afternoon|this evening|" +
    `this ${WEEKDAY_SOURCE}|on ${WEEKDAY_SOURCE}|${WEEKDAY_SOURCE})\\b`,
  "i"
);

/** The day a qualifier actually names, for the headline — or null when the
 * request never named one. Returning null is the whole point: a headline
 * must not assert "Today" (or any other day) that the florist didn't say.
 * Pure. */
function headlineDayWord(qualifier) {
  if (!qualifier) return null;
  if (/\btomorrow\b/i.test(qualifier)) return "Tomorrow";
  if (/\b(today|tonight|this morning|this afternoon|this evening)\b/i.test(qualifier)) return "Today";
  const dow = qualifier.match(new RegExp(`\\b${WEEKDAY_SOURCE}\\b`, "i"));
  if (dow) return dow[0].charAt(0).toUpperCase() + dow[0].slice(1).toLowerCase();
  return null;
}

/** The qualifier as it should read inside the body sentence. A bare
 * "early" is dropped here because the headline already says "Closing
 * Early" — "…is closing at 2:30 early." reads like a mistake. Every other
 * qualifier is preserved exactly as the florist wrote it. Pure. */
function bodyQualifier(qualifier) {
  if (!qualifier) return null;
  // Lowercased because it sits mid-sentence ("…closing at 2:30 today."),
  // except a weekday, which is a proper noun and must stay capitalized
  // whatever case the florist happened to type ("on Monday", not "on
  // monday").
  return qualifier
    .toLowerCase()
    .replace(new RegExp(WEEKDAY_SOURCE, "gi"), (d) => d.charAt(0).toUpperCase() + d.slice(1));
}

/** A full-day closure ("we are closed Monday") must never be announced as
 * an EARLY closing — that misstates the shop's hours to its customers.
 * Treated as an early closing only when the request actually says so: the
 * word "early", or a specific closing time. Pure. */
function signalsEarlyClosing(text, time) {
  return /\bearly\b/i.test(text) || Boolean(time);
}

/** "Closing Early" / "Closing Early Today" / "Closing Early Tomorrow" —
 * the day is appended only when the request genuinely named one. Pure. */
function noticeHeadline(base, qualifier) {
  const day = headlineDayWord(qualifier);
  return day ? `${base} ${day}` : base;
}
// Real, live-found failure (Ashley's second real branch-deploy test): the
// original narrow HOURS_CHANGE_SIGNAL_RE ("new hours"/"hours are
// changing") never matched plain phrasings like "changed business hours"
// or "holiday hours" — those fell through to the generic bucket, which
// didn't surface the time at all. Broadened to any mention of the bare
// word "hours" once closing/opening/deadline have already been ruled out
// above it — safe because PLAIN_NOTICE_SIGNAL_RE only routes a request
// here at all when it already carries a real operational-notice word.
const HOURS_CHANGE_SIGNAL_RE = /\bhours?\b/i;
const DEADLINE_SIGNAL_RE = /\b(deadline|order by|cutoff|last day to order)\b/i;
// "Opening late" / "delayed opening" — the mirror case of a temporary
// closing, previously unhandled entirely (fell into the generic bucket
// and lost the time).
const LATE_OPENING_RE = /\bopen(?:ing)?\b[^.!?\n]{0,30}\b(late|later|delayed)\b|\bdelayed opening\b/i;

function firstMatch(re, text) {
  const m = String(text || "").match(re);
  // TIME_RE's trailing `\s*(?:am|pm|AM|PM)?` can swallow a trailing space
  // even when no am/pm follows ("2:30 today" → "2:30 ") — trimmed here so
  // every extracted fact token is used cleanly, with no double-space
  // artifact when it's dropped into a template sentence.
  return m ? m[0].trim() : null;
}

// Security correction (Ashley, before the live visual test): an earlier
// version of this fix let buildDeterministicNoticeContent recover a
// missing shop name from the REQUEST TEXT when the shopName param came
// back empty. That was wrong — the request text is untrusted input. A
// florist's message could name another business (a competitor, an event
// venue, anyone) and that text must never become the flyer's branding
// authority, even as a "last resort." extractShopNameFromRequestText is
// kept ONLY for comparison/audit — marketing-studio.js logs a warning
// when the request mentions a different business than the authenticated
// shop, purely for visibility, and NEVER uses the result to set or
// override the shop's name. The actual fix for a missing shopName is
// upstream: marketing-studio.js now fails the request closed (a
// recoverable error, no content generated) if the trusted shops-table
// lookup itself can't be verified, rather than falling back to anything
// — see the shopRow check in generate_content.
const GENERIC_SENTENCE_SUBJECTS_RE = /^(we|i|you|they|customers|our shop|our store)$/i;
// A real shop name is routinely multi-word with lowercase connectors in
// the middle ("Lilies in Bloom", "Rose & Thorn Florals", "The Petal
// Bar") — each subsequent word may be Capitalized OR one of a small,
// closed set of connectors, never an arbitrary lowercase word (which
// would risk swallowing real sentence content into the "name").
const SHOP_NAME_SUBJECT_RE =
  /(?:^|[.!?]\s+)([A-Z][A-Za-z0-9&'.,-]*(?:\s+(?:[A-Z][A-Za-z0-9&'.,-]*|&|in|of|the|and|at|for)){0,6})\s+(?:is|are|will be|will|has|have)\s+(?:closing|closed|opening|open|updated|updating|announcing)\b/;

export function extractShopNameFromRequestText(text) {
  const m = String(text || "").match(SHOP_NAME_SUBJECT_RE);
  if (!m) return null;
  const candidate = m[1].trim();
  if (!candidate || GENERIC_SENTENCE_SUBJECTS_RE.test(candidate)) return null;
  return candidate;
}

/**
 * Real, live-found failure (Ashley's second real branch-deploy test): a
 * "safe" (non-invented, non-permanent-misread) AI paraphrase still
 * silently dropped the actual closing time from the flyer — "Don't
 * forget, Lilies in Bloom will be closing at 2:30 today..." became "Early
 * Closing Notice" with no 2:30 anywhere. Neither the invented-embellishment
 * guard nor the permanent-closure guard was ever built to catch a
 * material fact going missing — a paraphrase that drops a fact isn't
 * "invented," it's just incomplete. This is the real, general fix: this
 * single authoritative object (per Ashley's architecture requirement) is
 * the ONE thing both the caption and the on-image flyer text consume for
 * every plain operational notice with extractable facts — never an
 * independent AI paraphrase of either. Category branches below produce a
 * good, natural sentence for the common cases; the verification pass at
 * the end is what makes the "every material fact survives" guarantee
 * general rather than dependent on each branch being hand-tuned
 * perfectly — it re-checks the built body+cta against every real fact
 * token extractFactTokens() finds in the ORIGINAL request (the same
 * extraction factsPreserved() already trusts elsewhere in this module)
 * and appends anything a category branch didn't happen to include.
 */
/**
 * A stored phone number as a customer should read it.
 *
 * A real shop's saved phone was the bare digit string "16063319374", and
 * it went straight into the CTA — "CALL 16063319374 TO PLACE AN ORDER" —
 * as the largest contact text on a customer-facing flyer. A number the
 * florist typed for THIS request is never touched (it is preserved
 * byte-for-byte, per the facts rule); this only ever formats the shop
 * profile's own stored fallback.
 *
 * Deliberately conservative and generic: a number the florist already
 * punctuated is their formatting and is returned untouched, an
 * international "+" number is untouched, and anything that isn't a
 * recognizable 10- or 11-digit North American shape is returned unchanged
 * rather than mangled into a wrong format. Never shop-specific.
 *
 * public/flyer-renderer.js carries a deliberate mirror of this function
 * for the footer contact line — it is a browser IIFE and cannot import
 * this module. Keep the two in step.
 */
export function formatStoredPhoneForDisplay(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (/[()\-.\s]/.test(s)) return s;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1")) {
    return `1-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return s;
}

export function buildDeterministicNoticeContent({ requestText, shopName, shopPhone } = {}) {
  const text = String(requestText || "");
  // shopName is the ONLY trusted source of the shop's own name — never
  // the request text (see extractShopNameFromRequestText's docstring
  // above). The caller (marketing-studio.js) is responsible for failing
  // the request closed before this ever runs if the trusted shopName
  // couldn't be verified; this function never substitutes untrusted text
  // for it.
  const name = String(shopName || "").trim();
  // A number the florist typed for THIS request wins and is preserved
  // exactly as written; only the shop profile's stored fallback is
  // formatted for display (a bare digit string is unreadable on a flyer).
  const phone = firstMatch(PHONE_RE, text) || (shopPhone ? formatStoredPhoneForDisplay(shopPhone) : null) || null;
  const time = firstMatch(TIME_RE, text);
  const date = firstMatch(DATE_RE, text);
  const who = name || "We";
  const verb = name ? "is" : "are";

  let headline, body;
  if (requestSignalsTemporaryClosure(text)) {
    const dayMatch = text.match(DAY_QUALIFIER_RE);
    const day = dayMatch ? dayMatch[1] : null;
    const said = bodyQualifier(day);
    if (signalsEarlyClosing(text, time)) {
      headline = noticeHeadline("Closing Early", day);
      body = time
        ? `${who} ${verb} closing at ${time}${said ? ` ${said}` : ""}.`
        : `${who} ${verb} closing early${said ? ` ${said}` : ""}.`;
    } else {
      // Closed for the whole day, not closing early — say that instead.
      headline = noticeHeadline("Closed", day);
      body = `${who} ${verb} closed${said ? ` ${said}` : ""}.`;
    }
  } else if (LATE_OPENING_RE.test(text)) {
    const dayMatch = text.match(DAY_QUALIFIER_RE);
    const day = dayMatch ? dayMatch[1] : null;
    const said = bodyQualifier(day);
    headline = noticeHeadline("Opening Late", day);
    body = time
      ? `${who} ${verb} opening at ${time}${said ? ` ${said}` : ""}.`
      : `${who} ${verb} opening late${said ? ` ${said}` : ""}.`;
  } else if (DEADLINE_SIGNAL_RE.test(text)) {
    headline = "Order Deadline";
    body = date
      ? `Please place your order by ${date} to make sure it's ready in time.`
      : time
        ? `Please place your order by ${time} to make sure it's ready in time.`
        : "Please place your order soon to make sure it's ready in time.";
  } else if (HOURS_CHANGE_SIGNAL_RE.test(text)) {
    headline = "New Store Hours";
    body = time
      ? `${who} ${verb} updating our hours — starting at ${time}.`
      : name
        ? `${name} has updated store hours.`
        : "We have updated store hours.";
  } else if (/\bannounc(?:e|ing|ement)\b/i.test(text) || phone || time || date) {
    headline = "Store Notice";
    const parts = [name ? `${name} has an update for you.` : "We have an update for you."];
    if (time) parts.push(`Time: ${time}.`);
    else if (date) parts.push(`Date: ${date}.`);
    body = parts.join(" ");
  } else {
    return null;
  }

  const cta = phone ? `Call ${phone} to place an order.` : "Contact us for details.";

  // The general safety net described above: never let a category
  // branch's own phrasing silently lose a real fact the florist actually
  // gave. Checked against body+cta together since a fact (the phone
  // number, most often) is frequently only in the CTA, never the body.
  const missingFacts = extractFactTokens(text).filter((token) => !`${body} ${cta}`.includes(token));
  if (missingFacts.length) {
    body = `${body} ${missingFacts.join(" ")}`.trim();
  }

  const caption = phone ? `${body} Customers can call ${phone} to place an order.` : body;

  return { headline, body, cta, caption };
}

/**
 * Regression repair, live-found failure: "Create today's Facebook post for
 * Lilies in Bloom" — an ordinary creative request, nothing operational
 * about it — had its AI-generated wording rejected by fact-safety checks,
 * and the ONLY rescue that existed was buildDeterministicNoticeContent,
 * whose catch-all branch fires whenever a shop phone number exists (true
 * for nearly every real shop) — so the florist got "Store Notice / has an
 * update for you," reading like a store-hours announcement, for a request
 * that was never about a notice.
 *
 * This is that missing second rescue: a safety fallback for a
 * NON-operational creative request whose AI attempt(s) failed, kept
 * deliberately minimal and deliberately dumb — this is NOT Ashley's final
 * flyer-quality/creative-direction answer (that is separate, planned
 * follow-up work); it exists only so a rejected creative draft never reads
 * like an operational notice. It invents nothing beyond generic floral
 * language: no flower species, no inventory/availability/open-closed
 * claim, no promotion, no occasion, no event, no shop scenery, no
 * bereavement language — ever, regardless of what the request was about.
 * A genuinely sympathy-shaped request that somehow reaches this rescue
 * still gets this same generic, respectful-by-omission wording rather
 * than an invented bereavement framing — real sympathy language belongs
 * to the primary AI/evaluation path (which already exists and is
 * unaffected by this function), never to a keyword-triggered template.
 *
 * Safety correction: the no-safe-CTA branch used to say "Stop by
 * anytime." — a physical-availability/open-state claim ("the shop is
 * open now, walk in whenever") this function has no evidence for at all
 * (no hours, no hand-off of any current open/closed state). Never
 * invents ANY visit/open-state implication — "visit today," "come see
 * us," "available today," "walk-ins welcome," or any equivalent. When
 * there is no verified phone (or ctaIntent doesn't call for a phone
 * CTA), the CTA is simply omitted rather than replaced with a different
 * invented phrase — an empty CTA is honest; a location/open-state claim
 * with nothing behind it is not.
 */
export function buildDeterministicCreativeRescueContent({ shopName, shopPhone, ctaIntent = null } = {}) {
  const name = String(shopName || "").trim();
  const phone = shopPhone ? formatStoredPhoneForDisplay(shopPhone) : null;

  const headline = "Beautiful Blooms, Thoughtfully Arranged";
  const body = name
    ? `${name} designs flowers for the moments that matter — a little something to brighten someone's day.`
    : "Flowers designed for the moments that matter — a little something to brighten someone's day.";

  // A call CTA is only offered when the concept itself asked for one
  // (ctaIntent === "call_shop") or when no concept was supplied at all
  // (the caption-rescue call site today has no concept in scope) — never
  // invented just because a phone number happens to exist. With no safe
  // verified CTA available, the CTA is omitted — never replaced with an
  // invented visit/open-state phrase.
  const allowCallCta = Boolean(phone) && (ctaIntent === null || ctaIntent === "call_shop");
  const cta = allowCallCta ? `Call ${phone} to place an order.` : "";
  const caption = allowCallCta ? `${body} Call ${phone} to place an order.` : body;

  return { headline, body, cta, caption, kind: "creative_rescue" };
}

// ---------------------------------------------------------------------------
// Copy that is wrong in TONE rather than wrong in fact.
//
// Ashley asked for a post to bring in funeral work and got: "At Lilies in
// Bloom, we understand the importance of celebrating life's milestones,
// including funerals and memorial services. Our experienced florists create
// beautiful, meaningful arrangements... From classic bouquets to custom
// designs, we're here to support you during this difficult time. Contact us
// today to discuss your needs and let us help you create a lasting tribute."
//
// Nothing in it is factually invented, so every existing guard passed it. It
// is still unpublishable: it frames a funeral as a milestone to celebrate,
// and the rest is filler that would suit any business on earth. A florist's
// sympathy work is the most delicate writing they ever put out.
// ---------------------------------------------------------------------------

// Real, live-found gap: every noun here required a hard \b right after its
// singular form, so a plural — "condolences," the exact word in a real
// generated caption — never matched at all ("condolence" has no word
// boundary before the "s"). Each noun that's genuinely used in the plural
// now allows an optional "s".
//
// A second, live-reviewed gap (found by an independent review of the
// invented-bereavement-framing guard below, not yet caught live): a real
// florist request describing a death rarely uses any of the textbook words
// above — "flowers for the Wilson family, they just lost their dad" has
// none of them — so that guard could wrongly read the copy's own,
// perfectly appropriate condolence wording as INVENTED. The two family-word
// patterns below catch the common informal way people actually phrase this
// without opening up unrelated meanings ("lost my keys" needs no family
// word; a bare "passed" alone stays excluded — that word covers everything
// from exams to time to delivery vans driving past the shop).
const FAMILY_WORD_RE_SRC = "(?:mom|mother|dad|father|husband|wife|son|daughter|brother|sister|grandma|grandpa|grandmother|grandfather|parent|parents|loved one)";
// Exported (Phase 3 live-test fix) as the one authoritative "is this
// request/text actually about a death or a loss" check for TEXT
// generation — buildSocialPostTask/buildFlyerContentTask gate their own
// sympathy-writing instructions behind it, rather than each carrying an
// unconditional copy of sympathy example language regardless of whether
// the real request ever asked for that. Deliberately broader than
// ai-image-engine.js's own SYMPATHY_OCCASION_RE (which is tuned for a
// short occasion/visual-brief string, not full request text) — it also
// catches the informal way a florist actually describes a real loss
// ("they just lost their dad"), so gating text generation on the
// NARROWER image regex would have silently stopped recognizing those
// real requests as sympathy work. Kept as the one shared source of truth
// for TEXT rather than inventing a third variant.
export const BEREAVEMENT_CONTEXT_RE = new RegExp(
  `\\b(funerals?|sympathy|memorials?|bereave(?:d|ment)|condolences?|caskets?|gravesides?|wakes?|passed away|loss of|in memory|tributes?|remembrances?` +
    `|lost (?:my|his|her|their|our) ${FAMILY_WORD_RE_SRC}` +
    `|${FAMILY_WORD_RE_SRC} (?:just )?passed)\\b`,
  "i"
);

// "Celebration of life" is a real and correct term for a memorial service, so
// it is deliberately excluded — the failure is celebratory framing OF the
// death itself, not the phrase.
const CELEBRATORY_RE =
  /\bcelebrat(?:e|es|ed|ing|ion)\b(?!\s+of\s+life)|\bmilestones?\b|\bexcit(?:ed|ing)\b|\bthrilled\b|\bdelighted\b|\bcan'?t wait\b|\bjoyful\b|\bfun\b|\bamazing\b|\bspecial occasion\b/i;

// Sentences that could belong to any business in any industry. Each of these
// appeared in the post above, and together they were most of it.
const FILLER_PHRASES = [
  /\bwe understand the importance of\b/i,
  /\bwhether you(?:'re| are) looking for\b/i,
  /\bwe(?:'ve| have) got you covered\b/i,
  /\bcontact us today to discuss your needs\b/i,
  /\blet us help you create\b/i,
  /\bfrom classic [a-z ]{0,24} to custom\b/i,
  /\bour (?:experienced|dedicated|talented) (?:florists|team|staff)\b/i,
  /\bwe(?:'re| are) here to (?:support|help) you\b/i,
  // "At <Shop>, we believe/understand/know ..." — the most recognisable filler
  // opener there is. Two faults, both found by writing a test that quoted the
  // rule's own match back:
  //
  //  - It required a lowercase "at", so it never matched at the START of a
  //    sentence, which is the only place this sentence is ever written. It has
  //    effectively never fired. Ashley's caption tripped other rules instead.
  //  - Its character class had no "&" or "-", so it also skipped every shop
  //    called "Rose & Thorn" or "Petal-and-Stem" — and only those shops.
  //
  // Deliberately not the /i flag: the shop's name must still start with a
  // capital, or "at the shop, we believe" would read as a shop name.
  /\b[Aa]t [A-Z][\w'&\- ]{1,40}, we (?:believe|understand|know)\b/,
  // "At Lilies in Bloom, we understand that losing a loved one is never easy"
  // slipped through: the opener was only counted once and the threshold is
  // two. It is the single most recognisable filler sentence there is.
  /\bwe understand (?:that|how)\b/i,
  /\bthat(?:'s| is) why we(?:'re| are)\b/i,
  /\bmeaningful (?:and )?(?:beautiful )?arrangements?\b/i,
  /\bhonou?rs? your loved one(?:'s)? memory\b/i,
  /\bduring this difficult time\b/i,
  /\bhigh[- ]quality\b/i,
  /\bwide (?:range|selection|variety) of\b/i,
  /\bevery step of the way\b/i,
  /\byour (?:one[- ]stop|go[- ]to)\b/i
];

// A florist supplies the FLOWERS for a funeral. The service itself is held by
// a funeral home, a church, a crematorium — never at the flower shop.
//
// Ashley, reading a generated flyer that said "Funeral / SERVICES AVAILABLE"
// above her shop name and phone number: "it reads like I'm going to hold
// funeral services here at the flower shop." She is right, and it is the kind
// of claim that could genuinely mislead a grieving family into ringing the
// wrong number at the worst moment of their lives.
const SERVICE_CLAIM_RE =
  /\b(?:funeral|memorial|graveside|burial|cremation)\s+services?\b/i;
// "Funeral arrangements" is the other trap: to a florist it means flower
// arrangements, to everyone else it means the undertaking. Safe only when the
// copy says somewhere what is actually being arranged.
const AMBIGUOUS_ARRANGEMENT_RE = /\b(?:funeral|memorial)\s+arrangements?\b/i;
const FLOWER_WORD_RE =
  /\b(flower|floral|bouquet|spray|sprays|wreath|casket|posy|stems?|blooms?|lil(?:y|ies)|roses?|arrangement of|tribute of)\b/i;

// Any run of digits that a customer could read as a way to contact the shop.
// Deliberately loose: a fabricated number does not have to be well-formed to
// be dialled, and "555-1234" on a real shop's flyer is worse than useless.
// One number, not a run of everything that looks numeric.
//
// This pattern used to be /\+?\d[\d()\s.-]{5,}\d/ — a digit, then any run of
// digits, brackets, spaces, dots and dashes, then a digit. It is greedy across
// sentence boundaries, so a flyer carrying the same number twice a few
// characters apart matched ONCE, spanning both:
//
//   "Contact us today at (555) 555-5555. (555) 555-5555"
//     -> "555) 555-5555. (555) 555-5555"  = 20 digits
//
// Every caller then discarded it, because 20 digits is not a phone number. So
// the guard was silent — not because the shop had no phone stored, but because
// printing the number TWICE, which is exactly what a flyer does (once on the
// ribbon, once in the contact panel), hid it from the check written to catch
// it. A shop WITH its number on file would have been missed the same way.
//
// Now: an optional country or trunk prefix, then a real number shape, then a
// hard stop. A seven-digit local number is still matched on its own, because
// "555-1234" is the form Ashley's first invented number took. Times, dates,
// prices, percentages and years are not phone numbers and must never match —
// the tests below pin each of them.
//
// The seven-digit form's trailing guard rejects a digit, a slash or a colon
// (a date, a time) and a dot followed by a digit (a decimal inside a price),
// but NOT a plain full stop: an earlier version excluded "." outright, which
// meant a number ending a sentence — "Call 555-1234." — did not match at all,
// and a test that only ever wrote the number mid-sentence never noticed.
const CONTACT_NUMBER_RE =
  /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)|(?<![\d.,:\/-])\d{3}[-.\s]\d{4}(?![\d\/:]|\.\d)/g;
const digitsOnly = (value) => String(value || "").replace(/\D/g, "");

/**
 * Phone numbers in generated content that the florist never supplied and that
 * are not the shop's own.
 *
 * Ashley's flyer came back reading "CALL US AT 555-1234 FOR CUSTOM FUNERAL
 * ARRANGEMENTS TODAY" above her real number. Every fact guard here passed it,
 * because they check that supplied facts SURVIVE — none of them asked whether
 * a fact had been ADDED. A number nobody gave the model is the worst kind of
 * invention: it is actionable, it looks authoritative, and a family ringing it
 * does not reach the shop.
 *
 * Compared on digits alone so formatting differences never read as a new
 * number, and short runs (a time, a date, a price, a year) are ignored. Pure.
 */
export function detectFabricatedContactNumbers({ requestText, shopPhone, copyText } = {}) {
  const copy = String(copyText || "");
  const allowed = new Set();
  for (const known of [shopPhone, ...(String(requestText || "").match(CONTACT_NUMBER_RE) || [])]) {
    const d = digitsOnly(known);
    if (d.length >= 7) {
      allowed.add(d);
      // A number written with a country or trunk prefix in one place and
      // without it in another is the same number, not a new one.
      if (d.length > 10) allowed.add(d.slice(-10));
      if (d.length === 10) allowed.add("1" + d);
    }
  }
  const invented = [];
  for (const found of copy.match(CONTACT_NUMBER_RE) || []) {
    const d = digitsOnly(found);
    if (d.length < 7 || d.length > 15) continue;
    const variants = [d, d.slice(-10), d.length === 10 ? "1" + d : d];
    if (variants.some((v) => allowed.has(v))) continue;
    if (!invented.includes(found.trim())) invented.push(found.trim());
  }
  return invented;
}

// ---------------------------------------------------------------------------
// A number nobody can ring.
//
// Ashley's funeral flyer, generated through the real path, carried
// "(555) 555-5555" twice — on the ribbon and in the contact panel. An earlier
// one carried "(555) 123-4567". A grieving family reads that, dials it, and
// does not reach the shop. Of everything this file guards against, this is the
// only one that actively costs the florist the order.
//
// The existing guard could not fire, and the reason is written into its own
// comment: it compares against the shop's own number, so a shop whose record
// has no phone stored gets no opinion at all. That reasoning is sound for
// telling one real number from another — but it is not needed here.
// 555-555-5555 is fake on its face. The 555 exchange is reserved in the North
// American plan precisely so it can never reach anybody, and 123-4567, a run
// of one repeated digit, and a straight ascending run are what a model writes
// when it is filling a slot rather than stating a fact.
//
// So placeholders are recognised WITHOUT knowing the shop's number, which
// means the check works for every shop — including one whose profile is
// incomplete, which is exactly the shop most likely to be handed an invented
// number and the one the old check abandoned.
// ---------------------------------------------------------------------------

/** True for a number that cannot reach any business. Pure. */
export function isPlaceholderPhoneNumber(value) {
  const d = digitsOnly(value);
  if (d.length < 7) return false;
  const local = d.slice(-7);
  const ten = d.length >= 10 ? d.slice(-10) : null;
  // The reserved fictional exchange. No real business has one.
  if (local.startsWith("555")) return true;
  // The other slot-fillers a model reaches for.
  if (local === "1234567") return true;
  if (/^(\d)\1{6}$/.test(local)) return true;
  if (local === "0123456" || local === "2345678") return true;
  if (ten && /^(\d)\1{9}$/.test(ten)) return true;
  if (ten && ten === "1234567890") return true;
  return false;
}

/**
 * Placeholder numbers written into copy that the florist never supplied.
 *
 * Deliberately independent of the shop's own number: this is the check that
 * still works when the shop's profile has no phone on it. A number the florist
 * typed into the request themselves is theirs and is left alone — their stated
 * fact outranks this, as every stated fact does. Pure.
 */
export function detectPlaceholderContactNumbers({ requestText, copyText } = {}) {
  const supplied = new Set(
    (String(requestText || "").match(CONTACT_NUMBER_RE) || []).map((n) => digitsOnly(n))
  );
  const found = [];
  for (const raw of String(copyText || "").match(CONTACT_NUMBER_RE) || []) {
    const d = digitsOnly(raw);
    if (d.length < 7 || d.length > 15) continue;
    if (supplied.has(d)) continue;
    if (!isPlaceholderPhoneNumber(d)) continue;
    if (!found.includes(raw.trim())) found.push(raw.trim());
  }
  return found;
}

/**
 * Removes every phone number from `copyText` that the florist never supplied
 * and that is not the shop's own, returning the cleaned text and what went.
 *
 * Detecting was never enough. Every guard in this file feeds a bounded retry,
 * and a retry is a second opinion, not a guarantee — when the second attempt
 * invented a number too, it was rendered onto the flyer and persisted exactly
 * like the first. A number that cannot reach the shop must not survive to the
 * canvas at all, whatever the model does.
 *
 * When the shop's own number is known it is substituted, so the flyer keeps
 * its call to action. When it is not, the number is cut and the sentence it
 * sat in goes with it — a flyer with no number is one a florist can fix; a
 * flyer with a wrong number sends a grieving family to a dead line.
 *
 * Never rewrites anything else: this removes an INVENTED fact, which is the
 * opposite of the rule that a supplied fact must survive byte for byte.
 *
 * Pure. Returns { text, removed, substituted }.
 */
export function stripFabricatedContactNumbers({ requestText, shopPhone, copyText } = {}) {
  const original = String(copyText || "");
  if (!original) return { text: original, removed: [], substituted: false };
  const invented = new Set(
    detectFabricatedContactNumbers({ requestText, shopPhone, copyText: original }).map((n) => n.trim())
  );
  for (const p of detectPlaceholderContactNumbers({ requestText, copyText: original })) invented.add(p.trim());
  if (!invented.size) return { text: original, removed: [], substituted: false };

  const real = String(shopPhone || "").trim();
  const removed = [...invented];
  let text = original;

  if (real) {
    for (const number of invented) text = text.split(number).join(real);
  } else {
    // No number to put in its place, so the clause it sits in goes too — the
    // flyer must never read "Contact us today at ." Sentences are rebuilt
    // rather than patched, so no fragment of the invented number survives.
    const kept = [];
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if ([...invented].some((n) => sentence.includes(n))) continue;
      kept.push(sentence);
    }
    text = kept.join(" ");
    // A number standing alone as its own line (a call-to-action field) leaves
    // nothing behind when it goes.
    for (const number of invented) text = text.split(number).join(" ");
  }
  text = text.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
  return { text, removed, substituted: Boolean(real) };
}

// ---------------------------------------------------------------------------
// Unverified inventory / business-state claims.
//
// Real, live-found failure (Phase 3 live acceptance test, real Cloudflare
// provider, real "Lilies in Bloom" shop with ZERO real inventory rows on
// file): "We're thrilled to welcome our latest shipment of gorgeous
// Freedom roses to the studio!" — a confident, specific claim about a
// real-world event (a shipment arriving) that never happened, paired with
// an invented specific rose variety. Every existing guard in this file is
// about OPERATIONAL notices (closures/hours/deadlines) or a PERMANENT-
// closure misread — none of them ever asked "did the model just claim a
// real-world inventory/stocking event with nothing behind it?" An empty
// `inventorySummary` upstream (ai-creative-engine.js's buildSocialPostTask)
// meant "Florisyn has no verified inventory evidence," not "the shop has
// no flowers" — but with no detector here to catch the difference, the
// model was free to assert either.
//
// Two distinct claim shapes, matched separately because they need
// different evidence:
//   1. A bare business-state claim ("just arrived," "back in stock,"
//      "limited stock") — a factual assertion about something that
//      happened, which Florisyn cannot verify unless the florist's own
//      request already said so (an explicit supplied fact, exactly like a
//      phone number or a time — see factsPreserved()'s own principle).
//   2. A NAMED flower/variety explicitly framed as currently at/from the
//      shop ("we have X," "we're featuring X," "back in stock: X") — safe
//      only when real verified inventory names it, or the florist's own
//      request named that flower herself.
//
// Deliberately NOT a ban on flower names or on the word "fresh" — "Fresh
// flowers can brighten someone's day" and "Send someone a little beauty
// today" must never trip this; a plain mention, a request to write ABOUT
// a named flower, or a flower the florist's OWN request explicitly
// supplied are all untouched. Only a specific, current-stock CLAIM
// requires evidence, matching the "claim semantics, not a word ban" rule
// this fix was built around.
// ---------------------------------------------------------------------------

const INVENTORY_STATE_SIGNAL_RE =
  /\b(just arrived|just got (?:it|them|these|this) in|just got in|just received|freshly arrived|newly arrived|latest shipment|new shipment|fresh shipment|arrived today|back in stock|now in stock|now available|currently available|just restocked|\brestocked\b|limited stock|only \d+ left|while supplies last)\b/i;

// A named flower/foliage variety this codebase's model output has
// actually invented or could invent — deliberately a SEPARATE list from
// SPECIFIC_DETAIL_RE's own (below), rather than a shared refactor, so
// this fix can never change that unrelated, already-tested detector's
// behavior. Includes the exact terms from the live failure
// (leatherleaf, Freedom rose) alongside the common wholesale names this
// codebase already treats as canonical examples elsewhere (florist-ai-
// vision.js's own vision prompt).
const NAMED_FLOWER_RE =
  /\b(freedom roses?|spray roses?|garden roses?|roses?|tulips?|peon(?:y|ies)|ranunculus|alstroemerias?|leatherleaf(?: ferns?)?|leathernleaf|eucalyptus|hydrangeas?|carnations?|chrysanthemums?|mums?|orchids?|dais(?:y|ies)|iris(?:es)?|gladiol(?:us|i)|glads|snapdragons?|freesias?|anemones?|delphiniums?|larkspur|statice|asters?|proteas?|dahlias?|callas?|sunflowers?|lil(?:y|ies)|baby'?s breath|gypsophila)\b/i;

// A flower explicitly framed as CURRENT stock, not just mentioned in
// passing — an availability/possession VERB immediately signals "this is
// at the shop right now," distinct from a bare possessive ("our roses are
// gorgeous") which this deliberately does NOT match on its own (too
// broad — it would flag ordinary, harmless copy that isn't claiming
// anything beyond aesthetic opinion). Matches Ashley's own worked
// examples exactly: "We have Freedom roses" / "We're featuring fresh
// peonies today" / "Back in stock: ranunculus" all carry an explicit
// availability verb; "Our roses are looking gorgeous today" does not.
const CURRENT_STOCK_VERB_RE =
  /\bwe(?:'re| are)\s+featuring\b|\bwe\s+have\b|\bwe'?ve\s+got\b|\bwe\s+(?:offer|carry|stock)\b|\bwe(?:'re| are)\s+(?:offering|carrying|stocking|using|showcasing|crafting)\b|\bback\s+in\s+stock\b/i;

// Phase 3 follow-up, real live-found gap: the sentences above all require
// an explicit "we"/"we're" subject immediately before the verb — but the
// actual live regression ("Our expert florists are busy crafting stunning
// arrangements using a mix of fresh flowers, including peonies,
// alstroemeria, and spray roses") has no "we" at all; the subject is "Our
// expert florists." These verb SHAPES are specific enough to present-
// tense business composition (unlike a bare "have/carries," which appear
// constantly in harmless third-person sentences like "Roses have long
// symbolized love" or "a rose's color even carries its own meaning") that
// they never need a first-person subject check — "using," "made with,"
// "featuring," and "including" essentially only ever describe what an
// arrangement IS actually composed of right now, whatever the sentence's
// subject. Deliberately still excludes bare "have/has/carries/carry" —
// those stay gated to the explicit "we" forms above for exactly that
// reason.
const BUSINESS_USE_VERB_RE = /\busing\b|\bmade\s+(?:with|using|from)\b|\bfeatur(?:ing|es|e)\b|\binclud(?:ing|es)\b|\boffers?\b|\bstocks?\b|\bsells?\b/i;

// A florist explicitly stating she HAS real stock — "I have 40 roses I
// need to sell," "we've got roses," "we just received 50 red roses" — is
// exactly as real a supplied fact as a phone number or a time, even
// though it may not share INVENTORY_STATE_SIGNAL_RE's own exact wording.
// Real, live-found false positive this exists to prevent: "I have 40
// roses I need to sell" came back as "Fresh Roses Just Arrived!" — a
// reasonable creative embellishment of a fact she DID supply, not an
// invention, and an earlier version of this detector flagged it anyway
// because "just arrived" itself never appears in the request. The actual
// question is never "does the model's exact phrase appear in the
// request" — it's "did the request supply real possession of the named
// flower this sentence is about," which the per-flower check below (via
// requestNamedFlowers) already answers correctly; this only covers the
// remaining case of a BARE state-claim with no flower name attached at
// all ("our latest shipment just arrived!"), where there's no flower to
// check possession of.
const EXPLICIT_POSSESSION_RE =
  /\b(?:i|we)\s+(?:actually\s+|really\s+)?(?:have|'ve got|have got|got|received|just got|just received)\b|\b\d+\s+(?:stems?|roses?|tulips?|peon(?:y|ies)|carnations?|hydrangeas?|lil(?:y|ies)|dais(?:y|ies)|orchids?|sunflowers?)\b/i;

/**
 * Sentences in `generatedText` that assert an unverified inventory/
 * business-state fact. Each returned entry is the exact offending
 * sentence, for the same "quote it back, don't just say 'fix this'"
 * reason detectWeakMarketingCopy's own filler-phrase check already uses.
 *
 * `requestText` is the florist's own real request — a state-claim or a
 * named flower supplied there is a real, florist-given fact, not an
 * invention (same principle as factsPreserved()/detectFabricatedContact
 * Numbers()). `verifiedFlowerNames` is the shop's real, currently-loaded
 * inventory (ai-generated-assets' own inventorySources) — a flower named
 * there is genuinely in stock, not invented.
 *
 * A sentence that names a specific flower is judged on THAT flower's own
 * evidence (real inventory, or the request naming it) regardless of the
 * exact claim-verb used — a florist who said "I have 40 roses" licenses
 * "Fresh Roses Just Arrived!" even though the model's exact wording
 * differs. Only a claim with NO flower name at all ("our latest shipment
 * just arrived!") falls back to requiring the request to carry an
 * equivalent state/possession signal, since there's no flower to check
 * evidence for.
 *
 * Pure. Never shop-specific — every input is supplied by the caller from
 * real request/inventory data.
 */
// Expands every entry into its own singular/plural variants (this file's
// existing floralWordVariants(), reused rather than a second copy of the
// same singular/plural logic) before building the comparison set — real,
// live-found gap this fixes: real inventory is stored singular ("Garden
// Rose"), generated copy naturally pluralizes ("Garden Roses"), and an
// exact-string Set lookup treated those as two different flowers,
// wrongly flagging a shop's own verified stock as unverified.
function expandFlowerVariants(names) {
  const set = new Set();
  for (const name of names || []) {
    for (const variant of floralWordVariants(String(name).toLowerCase())) set.add(variant);
  }
  return set;
}

export function detectUnverifiedInventoryStateClaim({ generatedText, requestText, verifiedFlowerNames = [] } = {}) {
  const text = String(generatedText || "");
  const request = String(requestText || "");
  const requestSuppliesShipmentSignal = INVENTORY_STATE_SIGNAL_RE.test(request) || EXPLICIT_POSSESSION_RE.test(request);
  const requestNamedFlowers = expandFlowerVariants(request.match(NAMED_FLOWER_RE) || []);
  const verifiedSet = expandFlowerVariants(verifiedFlowerNames);

  const violations = [];
  for (const sentence of sentencesOf(text)) {
    const hasStateSignal = INVENTORY_STATE_SIGNAL_RE.test(sentence);
    const hasCurrentStockFraming = CURRENT_STOCK_VERB_RE.test(sentence) || BUSINESS_USE_VERB_RE.test(sentence);
    if (!hasStateSignal && !hasCurrentStockFraming) continue;

    const flowerMatches = sentence.match(NAMED_FLOWER_RE) || [];
    if (flowerMatches.length) {
      const unverified = flowerMatches.some(
        (f) => !floralWordVariants(f.toLowerCase()).some((v) => verifiedSet.has(v) || requestNamedFlowers.has(v))
      );
      if (unverified) violations.push(sentence.trim());
      continue;
    }
    // No specific flower named — a bare business-state claim still needs
    // the request itself to have supplied an equivalent fact, since
    // there's no flower name to check real evidence against.
    if (hasStateSignal && !requestSuppliesShipmentSignal) {
      violations.push(sentence.trim());
    }
  }
  return violations;
}

/**
 * Removes every sentence flagged by detectUnverifiedInventoryStateClaim
 * from `text`, rebuilding the remainder — the same "cut the sentence, no
 * fragment survives" pattern stripFabricatedContactNumbers() already
 * uses for an invented phone number with nothing real to substitute.
 * There is no safe substitute for an invented shipment/stock claim (there
 * is no "real" one to put in its place), so this always removes rather
 * than replaces.
 *
 * Pure. Returns { text, removed }.
 */
export function stripUnverifiedInventoryClaims({ generatedText, requestText, verifiedFlowerNames = [] } = {}) {
  const original = String(generatedText || "");
  const violations = detectUnverifiedInventoryStateClaim({ generatedText: original, requestText, verifiedFlowerNames });
  if (!violations.length) return { text: original, removed: [] };
  const violationSet = new Set(violations);
  const kept = sentencesOf(original).filter((s) => !violationSet.has(s.trim()));
  const text = kept.join(" ").replace(/[ \t]{2,}/g, " ").trim();
  return { text, removed: violations };
}

// ---------------------------------------------------------------------------
// requestSignalsIntentionalInventoryUse / sanitizeUngroundedFlowerNames
//
// Product rule (Phase 3 follow-up): Lily must never independently CHOOSE
// or name a specific flower type/variety in customer-facing content — the
// default is generic floral language ("fresh flowers," "seasonal blooms")
// unless the florist herself named a flower in the current request, or
// real verified inventory supports it AND the request actually signals
// this post is meant to be inventory-driven. Verified stock existing is
// not, by itself, a license to name it in a post that was never about
// promoting that stock.
//
// This is a DIFFERENT check from detectUnverifiedInventoryStateClaim
// above on purpose: that one only ever looks at a CLAIM sentence (an
// explicit availability/business verb paired with a flower name) inside
// customer-facing body copy, so a genuinely educational or opinion
// sentence ("Roses are a classic choice for anniversaries") is never
// touched — exactly right for body/caption copy, where that creative
// latitude is real. creative_brief.primary_subject and visual_brief are a
// different kind of field: never an educational aside, always "what this
// post/image actually depicts" — so ANY named flower there needs the same
// evidence a claim sentence would, with no verb-gating at all.
// ---------------------------------------------------------------------------

const INTENTIONAL_INVENTORY_USE_RE =
  /\bpromote\b.{0,40}\b(?:i|we)\s+(?:actually\s+|really\s+)?have\b|\bwhat\s+i\s+(?:actually\s+)?have\b|\bwhat'?s\s+in\s+(?:the\s+)?(?:shop|store)\b|\bmy\s+(?:current\s+)?inventory\b|\bfeature\s+(?:my|our)\s+(?:current\s+)?(?:stock|inventory)\b/i;

/**
 * True when the florist's own request signals she wants THIS post to
 * actually be about her real, current inventory — not merely that
 * inventory happens to exist. Reuses the same request-side signals
 * detectUnverifiedInventoryStateClaim already trusts as real supplied
 * facts (INVENTORY_STATE_SIGNAL_RE, EXPLICIT_POSSESSION_RE), plus a few
 * additional real phrasings ("promote what I have," "what's in the
 * shop," "my inventory").
 */
export function requestSignalsIntentionalInventoryUse(requestText) {
  const request = String(requestText || "");
  return INVENTORY_STATE_SIGNAL_RE.test(request) || EXPLICIT_POSSESSION_RE.test(request) || INTENTIONAL_INVENTORY_USE_RE.test(request);
}

/**
 * Replaces any named flower/variety in a non-sentence descriptive field
 * (creative_brief.primary_subject, visual_brief) that isn't grounded in
 * the florist's own request, or in verified inventory when the request
 * actually signals real inventory-driven intent, with plain generic
 * floral wording. Never invents a replacement species — always the same
 * neutral phrase, matching the "generic wording, not a fabricated
 * substitute" principle stripFabricatedContactNumbers()/
 * stripUnverifiedInventoryClaims() already use.
 *
 * Pure. Returns { text, removed }.
 */
export function sanitizeUngroundedFlowerNames({ text, requestText, verifiedFlowerNames = [], inventoryIntentConfirmed = false } = {}) {
  const original = String(text || "");
  if (!original) return { text: original, removed: [] };
  const request = String(requestText || "");
  const requestNamedFlowers = expandFlowerVariants(request.match(NAMED_FLOWER_RE) || []);
  const verifiedSet = expandFlowerVariants(verifiedFlowerNames);
  const removed = [];
  const sanitized = original.replace(NAMED_FLOWER_RE, (match) => {
    const grounded = floralWordVariants(match.toLowerCase()).some(
      (v) => requestNamedFlowers.has(v) || (inventoryIntentConfirmed && verifiedSet.has(v))
    );
    if (grounded) return match;
    removed.push(match);
    return "flowers";
  });
  return { text: sanitized, removed };
}

// ---------------------------------------------------------------------------
// detectUnverifiedServiceAvailabilityClaim / stripUnverifiedServiceAvailability
// Claims
//
// Batch 1 architecture-audit fix (Part 2): a real, confirmed gap — the
// inventory-state check above only ever matches shipment/restock-shaped
// language (INVENTORY_STATE_SIGNAL_RE); a sentence claiming "same-day
// delivery," "open now," or "walk-ins welcome" never matched that
// signal and passed through completely unguarded except inside
// buildDeterministicCreativeRescueContent's own narrow hand-written
// fallback. The exact live-observed failure this closes: a flyer CTA
// generated "CALL 606-506-4039 FOR SAME-DAY DELIVERY." from nothing but
// a real phone number and generic florist context — same-day delivery
// was never something the florist said or Florisyn verified.
//
// Same "claim semantics, not a word ban" principle as the inventory
// check above: a sentence merely CONTAINING a phone number, or
// describing flowers as a nice gift "today," is never touched — only a
// sentence that actually ASSERTS a specific service/availability state
// (same-day delivery, open now, walk-ins welcome, ready today) needs
// real evidence behind it.
// ---------------------------------------------------------------------------

// Deliberately scoped to exactly the phrases the live-observed failure
// and Ashley's own instruction named — same-day delivery, open now/today,
// available now/today, walk-ins welcome, ready today, order-today-for-
// delivery-today — and nothing broader.
//
// Two real over-blocking regressions were found and fixed here, both by
// the same root cause: "available (now|today)" and "ready (now|today)"
// on their own are NOT service/availability claims — they're also
// completely ordinary PRODUCT copy ("Peonies are available now while
// supplies last," "Fresh blooms are ready for pickup today," "Get your
// flowers ready now for the big day"). None of those assert anything
// about the SHOP's delivery/pickup/order-fulfillment state; a bare
// adjacency match flagged them anyway. Both alternatives are now
// anchored to an explicit delivery/pickup/order noun immediately
// adjacent to "available"/"ready" — "delivery is available now,"
// "pickup available today," "your order is ready today" — which still
// catches the real service-state claims Ashley's own phrase list names
// while leaving ordinary product-availability copy untouched.
const SERVICE_AVAILABILITY_SIGNAL_RE =
  /\bsame[\s-]?day\s+delivery\b|\bdelivery\s+(?:is\s+)?available(?:\s+today)?\b|\bdelivery\s+today\b|\border\s+today\s+for\s+(?:delivery|pickup)\s+today\b|\bopen\s+(?:now|today)\b|\b(?:delivery|pickup|orders?)\s+(?:is\s+|are\s+)?available\s+(?:now|today)\b|\bwalk-?ins?\s+welcome\b|\b(?:order|pickup|it'?s)\s+(?:is\s+)?ready\s+(?:today|now)\b/i;

/**
 * Sentences in `generatedText` that assert a specific, unverified
 * service/availability state (same-day delivery, open now, walk-ins
 * welcome, ready today, and similar) with no evidence behind them.
 *
 * SUPPORTED when the florist's own `requestText` already states the
 * same signal ("we offer same-day delivery"), or a future verified
 * shop-configuration fact is supplied via `verifiedServiceSignals` (an
 * array of already-confirmed service-state strings — empty today, since
 * no such verified config source exists yet in this codebase; kept as
 * an explicit parameter so a real source can be wired in later without
 * a second, parallel detector).
 *
 * Deliberately narrow, not a word ban: "Fresh flowers can brighten
 * someone's day," "Order today," and "Call us for a free consultation"
 * must never trip this — only an actual service/availability CLAIM
 * (same-day delivery, open now/today, available now/today, walk-ins
 * welcome, ready today) requires evidence.
 *
 * Pure. Never shop-specific — every input is supplied by the caller.
 */
export function detectUnverifiedServiceAvailabilityClaim({ generatedText, requestText, verifiedServiceSignals = [] } = {}) {
  const text = String(generatedText || "");
  const request = String(requestText || "");
  const requestSupplies = SERVICE_AVAILABILITY_SIGNAL_RE.test(request);
  const verifiedSupplies = (verifiedServiceSignals || []).some((s) => SERVICE_AVAILABILITY_SIGNAL_RE.test(String(s || "")));
  if (requestSupplies || verifiedSupplies) return [];

  const violations = [];
  for (const sentence of sentencesOf(text)) {
    if (SERVICE_AVAILABILITY_SIGNAL_RE.test(sentence)) violations.push(sentence.trim());
  }
  return violations;
}

/**
 * Removes every sentence flagged by detectUnverifiedServiceAvailability
 * Claim from `text`, rebuilding the remainder — same "cut the sentence,
 * no fragment survives" pattern as stripUnverifiedInventoryClaims (there
 * is no safe substitute for an invented service-availability claim; only
 * the florist or verified shop config can supply the real one).
 *
 * Pure. Returns { text, removed }.
 */
export function stripUnverifiedServiceAvailabilityClaims({ generatedText, requestText, verifiedServiceSignals = [] } = {}) {
  const original = String(generatedText || "");
  const violations = detectUnverifiedServiceAvailabilityClaim({ generatedText: original, requestText, verifiedServiceSignals });
  if (!violations.length) return { text: original, removed: [] };
  const violationSet = new Set(violations);
  const kept = sentencesOf(original).filter((s) => !violationSet.has(s.trim()));
  const text = kept.join(" ").replace(/[ \t]{2,}/g, " ").trim();
  return { text, removed: violations };
}

// ---------------------------------------------------------------------------
// Invented temporal claims — real, live-found failure: a self-purchase
// caption for a Saturday request ("Give me a cute post about buying
// yourself flowers.") invented "Self-care Sunday" out of nothing. The
// request named no day at all; the model added a specific weekday purely
// because it sounded catchy. Deterministic, general fix — never a
// one-off ban on the word "Sunday" — following the exact same
// "supported only when the request itself supplies it" shape as
// detectUnverifiedServiceAvailabilityClaim above.
//
// Deliberately narrow scope: day-of-week names, relative-day phrases
// (tonight/tomorrow, this morning/afternoon/evening/weekend), and literal
// calendar dates (reusing DATE_RE, the same fact token every other
// date-sensitive check in this file already uses). Named holidays/
// seasonal occasions and event deadlines are governed by this codebase's
// own separate, already-correct occasion/campaign classification
// (marketing-canonical-concept.js) and are deliberately NOT duplicated
// here — this detector only covers the literal day/date claims a model
// can hallucinate with no classification system behind them at all.
//
// Bare "today" is deliberately EXCLUDED from this deterministic check
// (a real pre-existing test — "Visit us today" as an ordinary CTA —
// confirmed this): unlike "Sunday" (asserts a SPECIFIC day that can be
// objectively wrong) or "tomorrow"/"tonight" (assert a day OTHER than
// now), "today" is self-referential to whenever the post is actually
// read and is never a checkably false claim — it's the same idiomatic
// urgency word as "now," used throughout this codebase's own existing
// marketing copy ("order today," "call today"). The prompt-level
// TEMPORAL_FACT_SAFETY_RULE (ai-creative-engine.js) still discourages a
// model from manufacturing "today" as if it were a specific occasion;
// this deterministic backstop is reserved for the classes of temporal
// claim that are actually, objectively checkable and were the real
// live-found failure mode.
// ---------------------------------------------------------------------------

const DAY_OF_WEEK_RE = /\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;
const RELATIVE_DAY_RE = /\b(?:tonight|tomorrow)\b|\bthis\s+(?:morning|afternoon|evening|weekend)\b/i;
const INVENTED_TEMPORAL_CLAIM_RE = new RegExp(`${DAY_OF_WEEK_RE.source}|${RELATIVE_DAY_RE.source}|${DATE_RE.source}`, "i");

/**
 * Sentences in `generatedText` that name a specific day-of-week, relative
 * day, or calendar date with nothing in `requestText` actually supplying
 * that class of temporal claim.
 *
 * SUPPORTED whenever the florist's own request already carries the same
 * class of temporal signal anywhere in it (a day name, "today," a real
 * date, etc.) — mirrors detectUnverifiedServiceAvailabilityClaim's own
 * "supported by the request" escape hatch exactly; this is never a
 * blanket ban on all temporal language, only on INVENTING it from
 * nothing the request never supplied.
 *
 * Pure. Never shop-specific.
 */
export function detectInventedTemporalClaim({ generatedText, requestText } = {}) {
  const text = String(generatedText || "");
  const request = String(requestText || "");
  if (INVENTED_TEMPORAL_CLAIM_RE.test(request)) return [];
  const violations = [];
  for (const sentence of sentencesOf(text)) {
    if (INVENTED_TEMPORAL_CLAIM_RE.test(sentence)) violations.push(sentence.trim());
  }
  return violations;
}

/**
 * Removes every sentence flagged by detectInventedTemporalClaim from
 * `text`, rebuilding the remainder — same "cut the sentence, no fragment
 * survives" pattern as stripUnverifiedServiceAvailabilityClaims (there is
 * no safe substitute for an invented day/date; only the florist's own
 * request can supply the real one).
 *
 * Pure. Returns { text, removed }.
 */
export function stripInventedTemporalClaims({ generatedText, requestText } = {}) {
  const original = String(generatedText || "");
  const violations = detectInventedTemporalClaim({ generatedText: original, requestText });
  if (!violations.length) return { text: original, removed: [] };
  const violationSet = new Set(violations);
  const kept = sentencesOf(original).filter((s) => !violationSet.has(s.trim()));
  const text = kept.join(" ").replace(/[ \t]{2,}/g, " ").trim();
  return { text, removed: violations };
}

// ---------------------------------------------------------------------------
// One-concept coherence — does the caption and the flyer's own on-image
// text actually describe the SAME post?
//
// Real, live-found failure (the same Phase 3 test): the caption described
// a new rose shipment; the flyer's on-image text, generated as a
// completely separate AI call from the same bare brief with no knowledge
// of the caption already written, independently decided the post was
// sympathy/funeral work ("Thinking of You," "standing spray or casket
// flowers"). Both individually passed every existing per-text guard —
// the fault only exists BETWEEN the two outputs, which nothing checked.
//
// Deliberately deterministic, no second AI system: reuses
// BEREAVEMENT_CONTEXT_RE (the same check now gating the sympathy-writing
// prompt rules) to classify each side, plus the objective/promotion
// checks below. A caller with a genuine, real mismatch gets one concrete
// reason back — not a black-box "no."
// ---------------------------------------------------------------------------

/**
 * Why this specific flyer text is incoherent with the concept the caption
 * already established, or null when it's fine. `concept` is the
 * structured object marketing-studio.js builds from the FIRST successful
 * generation (copyGen) — see its own definition for the shape.
 *
 * Pure. Never shop-specific.
 */
export function detectConceptCoherenceMismatch({ concept, captionText, flyerText, requestText } = {}) {
  const caption = String(captionText || "");
  const flyer = String(flyerText || "");
  const request = String(requestText || "");

  // 1. The flyer's own sympathy status disagrees with the CONCEPT's — the
  // concept (concept.isSympathy) is the authoritative classification,
  // already computed from the real request + the caption together, not
  // re-derived from a symmetrical keyword comparison between the two
  // texts. Real, live-found false positive an earlier version of this
  // check had: comparing BEREAVEMENT_CONTEXT_RE against the caption's OWN
  // text directly flagged a genuinely correct sympathy post, because a
  // gentle, well-written sympathy caption ("our thoughts are with the
  // family") can easily avoid every literal keyword the regex looks for
  // while the flyer correctly uses real sympathy-card language ("With
  // Sympathy") — a real difference in WORD CHOICE, not a real difference
  // in CONCEPT. Trusting the concept's own already-decided classification
  // avoids that false positive entirely.
  if (concept && typeof concept.isSympathy === "boolean") {
    const flyerIsSympathy = BEREAVEMENT_CONTEXT_RE.test(flyer);
    if (flyerIsSympathy !== concept.isSympathy) {
      return concept.isSympathy
        ? "This post is sympathy/funeral work, but the flyer text doesn't read that way — both halves of the same post must agree."
        : "The flyer reads as sympathy/funeral work, but nothing about this post is actually about a death or a loss — a caption and its flyer must describe the same post.";
    }
  }

  // 2. An "operational" objective (a plain schedule/hours/logistics
  // notice) paired with emotional or promotional language — the two are
  // fundamentally different registers, and operational facts belong
  // stated plainly (buildDeterministicNoticeContent's own standard).
  if (concept?.objective === "operational" && (CELEBRATORY_RE.test(flyer) || REAL_PROMOTION_SIGNAL_RE.test(flyer))) {
    return "The objective is operational (a plain schedule/logistics notice), but the flyer text reads as celebratory or promotional — an operational notice must stay plain and factual.";
  }

  // 3. "promotion" claimed with nothing in the real request supporting a
  // real sale/discount/offer — the objective itself becomes an invented
  // business claim otherwise (requirement 9-I).
  if (concept?.objective === "promotion" && !requestSignalsRealPromotion(request)) {
    return "The objective was classified as promotion, but nothing in the actual request describes a real sale, discount, or offer — a promotion objective must be supported by a real promotion, never invented to sound more exciting.";
  }

  // 4. Named-flower subject mismatch — both sides name specific flowers,
  // but share none in common. Deliberately narrow (both sides must name
  // at least one) so a side that simply doesn't mention a flower at all
  // (very common, and fine) never trips this.
  const captionFlowers = new Set((caption.match(NAMED_FLOWER_RE) || []).map((f) => f.toLowerCase()));
  const flyerFlowers = new Set((flyer.match(NAMED_FLOWER_RE) || []).map((f) => f.toLowerCase()));
  if (captionFlowers.size && flyerFlowers.size && ![...flyerFlowers].some((f) => captionFlowers.has(f))) {
    return `The caption and flyer name completely different flowers (caption: ${[...captionFlowers].join(", ")}; flyer: ${[...flyerFlowers].join(", ")}) — both halves of the same post must describe the same subject.`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// The stock-phrase list above is whack-a-mole, and three rounds of real output
// proved it. Each time a phrase was banned the next attempt produced the same
// empty sentence in a new shape: "we understand the importance of" became "we
// understand that", "we're here to support you" became "that's why we're here
// to help". A list can only ever ban the sentence that has already been seen.
//
// So this is the same rule the model's own prompt states — "if a sentence
// would suit a plumber with the nouns swapped, cut it" — made deterministic,
// by asking the opposite question: does this sentence contain ANYTHING a
// customer could actually picture, check, or act on?
//
// A concrete detail is a named bloom, the physical thing being made, a real
// number (a time, a price, a phone number, a count of stems), a named day or
// month, or something specific about how the flowers reach the customer.
// Category words a marketing generator reaches for by default — "flowers",
// "arrangements", "florists", "designs", "quality", "service", "team" — are
// deliberately NOT anchors: they are exactly what is left when the specifics
// have been written out of a sentence.
// ---------------------------------------------------------------------------
const SPECIFIC_DETAIL_RE = new RegExp(
  [
    // A real number: a time, a price, a date, a phone number, a stem count.
    "\\d",
    // A bloom or greenery a customer can picture.
    "\\b(?:roses?|lil(?:y|ies)|carnations?|chrysanthemums?|mums?|orchids?|tulips?|peon(?:y|ies)|" +
      "hydrangeas?|gerberas?|dais(?:y|ies)|irises|iris|gladiol(?:us|i)|glads|snapdragons?|" +
      "alstroemerias?|freesias?|ranunculus|anemones?|delphiniums?|larkspur|statice|asters?|" +
      "proteas?|dahlias?|callas?|sunflowers?|baby'?s breath|gypsophila|eucalyptus|ferns?|ivy|" +
      "greenery|foliage|carnation)\\b",
    // The physical thing actually being made.
    "\\b(?:standing spray|casket (?:spray|flowers?|piece)|sprays?|wreaths?|garlands?|swags?|" +
      "pos(?:y|ies)|corsages?|boutonni[eè]res?|urns?|easels?|bud vases?|vases?|baskets?|" +
      "sheaf|sheaves|cent(?:re|er)pieces?)\\b",
    // Something concrete about how it is made or how it reaches them.
    "\\b(?:same[- ]day|next[- ]day|hand[- ](?:tied|delivered|made)|deliver(?:ed|y)? to|" +
      "pick(?:[- ]?up)|in the cooler|by hand|made here|in the shop|on the bench)\\b",
    // A real day or month.
    "\\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\\b",
    "\\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\\b"
  ].join("|"),
  "i"
);

// Long enough that a florist plainly meant to say something with it. A short
// line ("Open until five." / "Come and see us.") is not filler, it is brevity,
// and must never be counted here.
const SUBSTANTIVE_SENTENCE_WORDS = 9;

// Exported (Batch 1, Part 8) so marketing-openai-creative-brief.js's
// text-token-separation classifier can reuse this exact sentence split
// rather than re-implementing its own — one sentence-splitting rule for
// the whole codebase, not a second copy that could quietly drift from
// this one.
export function sentencesOf(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The sentences in this copy that are long enough to be saying something and
 * contain nothing a customer could picture, check or act on.
 *
 * The shop's own name is stripped before the test rather than counted as a
 * detail. A shop called "Lilies in Bloom" would otherwise make every sentence
 * that merely names the shop read as though it mentioned a flower — the exact
 * sentence ("At Lilies in Bloom, we understand that losing a loved one is
 * never easy") that this check exists to catch. Naming yourself is not
 * specificity.
 *
 * Pure. Never shop-specific: the name is supplied by the caller from real shop
 * data, never hardcoded.
 */
export function findHollowSentences(copyText, shopName) {
  const name = String(shopName || "").trim();
  const stripName = (s) =>
    name ? s.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ") : s;
  return sentencesOf(copyText).filter((sentence) => {
    const bare = stripName(sentence);
    if (bare.split(/\s+/).filter(Boolean).length < SUBSTANTIVE_SENTENCE_WORDS) return false;
    return !SPECIFIC_DETAIL_RE.test(bare);
  });
}

// ---------------------------------------------------------------------------
// A sympathy flyer never leads with the product.
//
// Ashley, on a flyer headed "Funeral / FLOWERS AVAILABLE": "Funeral Flowers
// doesn't at all sound sympathetic. That would make you lose sales. Think if
// you lost a loved one would you buy from someone who just says we have
// funeral flowers, NO."
//
// She is right, and none of the guards above could see it. They check tone,
// stock phrasing, invented facts, and whether the shop claims to hold the
// service. Every one of them passes "Funeral Flowers Available", because
// nothing is wrong with it except the only thing that matters: it is a supply
// notice. A family two days after a death is not shopping a category. The
// headline is the largest thing on the flyer and the first thing read, and on
// sympathy work it has to be addressed to the person, not to the market.
//
// What a real sympathy piece leads with is what a card would say — "With
// Sympathy", "In Loving Memory", "Thinking of You", "With Deepest Sympathy",
// "For the Family" — or what the shop will actually do for them. The flowers
// are named in the message underneath, where they belong.
// ---------------------------------------------------------------------------

/** The occasion as a bare category or a stock line, with nothing human in it. */
const PRODUCT_LABEL_HEADLINE_RE =
  /^\s*(?:our\s+|the\s+|new\s+)?(?:funeral|sympathy|memorial|bereavement|condolence|casket|graveside|remembrance)\s*(?:&|and)?\s*(?:flowers?|florals?|arrangements?|bouquets?|sprays?|tributes?|pieces?|designs?|work|services?)?\s*(?:now\s+)?(?:available|in\s+stock|for\s+sale|on\s+offer|here|today)?\s*[.!]?\s*$/i;

/** An availability/supply framing anywhere in a short headline. */
const AVAILABILITY_HEADLINE_RE =
  /\b(?:now\s+available|available\s+now|available|in\s+stock|for\s+sale|on\s+offer|we\s+(?:offer|stock|sell|have)|order\s+(?:your|now)|shop\s+(?:our|now)|prices?\s+from)\b/i;

/**
 * True when this headline addresses the bereaved rather than advertising to
 * them. Kept as an explicit allow-list of the things a sympathy card actually
 * says, because the failure mode being guarded is a model reaching for the
 * category name — and a category name will never accidentally look like this.
 */
const SYMPATHY_ADDRESS_RE =
  /\b(?:with\s+(?:our\s+)?(?:deepest\s+|heartfelt\s+)?sympath(?:y|ies)|in\s+(?:loving\s+)?memory|in\s+remembrance|thinking\s+of\s+you|with\s+love|for\s+the\s+family|when\s+words|our\s+(?:deepest\s+)?condolences|forever\s+remembered|always\s+remembered|gone\s+but|rest\s+in\s+peace|a\s+life\s+(?:well\s+)?(?:lived|remembered)|celebration\s+of\s+life|say(?:ing)?\s+goodbye|honou?ring\s+a\s+life)\b/i;

/**
 * Why this headline is wrong for sympathy work, or null when it is fine.
 *
 * Only ever consulted for bereavement requests — on a Valentine's flyer
 * "Roses Available" is an ordinary, correct headline and none of this applies.
 *
 * Pure. Never shop-specific.
 */
export function detectSympathyProductHeadline(requestText, headline, copyText) {
  const head = String(headline || "").trim();
  if (!head) return null;
  // "Wake up to fresh flowers every Monday" is not a bereavement. The shared
  // bereavement test cannot tell those two senses of the word apart, and here
  // the cost of getting it wrong is a spring post rewritten as a funeral.
  const deWake = (t) => String(t || "").replace(/\bwake\s+up\b/gi, " ");
  const context = deWake(`${requestText || ""} ${copyText || ""} ${head}`);
  if (!BEREAVEMENT_CONTEXT_RE.test(context)) return null;
  // Already saying the human thing. Naming the flowers as well is fine —
  // "With Sympathy — Funeral Flowers" leads with the person, which is the
  // whole point; only the label ALONE is the fault.
  if (SYMPATHY_ADDRESS_RE.test(head)) return null;
  const bare = PRODUCT_LABEL_HEADLINE_RE.test(head);
  // Availability framing is judged against the CONTEXT, not against the
  // headline's own words. A funeral flyer headed simply "Now Available" is the
  // same fault and carries no bereavement word at all to recognise it by —
  // which is exactly the shape a model reaches for once it has been told not
  // to write "Funeral Flowers Available".
  const advertised = AVAILABILITY_HEADLINE_RE.test(head);
  if (!bare && !advertised) return null;
  return `"${head}" is a product label, not a sympathy headline. A family two days after a death is not shopping a category — lead with what a card would say ("With Sympathy", "In Loving Memory", "Thinking of You") or with what the shop will do for them, and name the flowers in the message underneath.`;
}

/**
 * A supply notice in sentence form, which is how the same fault reaches a
 * caption. "Funeral Flowers Available" is a headline; "We offer a variety of
 * funeral flowers" is the identical thought written out, and the caption is
 * the part that actually gets posted to Facebook.
 *
 * Deliberately narrower than the headline test. A bare "we have" is not a
 * supply notice — "We have been making funeral flowers for thirty years" is a
 * perfectly good opening — so only the stocking sense counts.
 */
const SUPPLY_OPENING_RE = new RegExp(
  [
    "\\b(?:now\\s+)?available\\b",
    "\\bin\\s+stock\\b",
    "\\bfor\\s+sale\\b",
    "\\bwe\\s+(?:offer|stock|sell|carry|provide)\\b",
    "\\bwe\\s+have\\s+(?:a\\s+)?(?:variety|range|selection|lots?|plenty)\\b",
    "\\bwe\\s+have\\s+\\w+\\s+(?:flowers?|arrangements?|sprays?|tributes?|pieces?)\\b"
  ].join("|"),
  "i"
);

/**
 * Why this copy's OPENING is wrong for sympathy work, or null when it is fine.
 *
 * The first sentence of a caption does the same job the headline does on a
 * flyer: it is what a grieving family reads before deciding whether to keep
 * reading. Ashley's point about "Funeral Flowers" applies to it word for word,
 * and the guards missed it in exactly the same way — a caption opening "We
 * offer a variety of sympathy arrangements" is specific, invents nothing, uses
 * no stock phrase, and passed every check in this file.
 *
 * Pure. Never shop-specific.
 */
export function detectSympathyProductOpening(requestText, copyText) {
  const copy = String(copyText || "").trim();
  if (!copy) return null;
  const context = String(`${requestText || ""} ${copy}`).replace(/\bwake\s+up\b/gi, " ");
  if (!BEREAVEMENT_CONTEXT_RE.test(context)) return null;
  const opening = sentencesOf(copy)[0] || "";
  if (!opening || SYMPATHY_ADDRESS_RE.test(opening)) return null;
  if (!SUPPLY_OPENING_RE.test(opening)) return null;
  return `"${opening}" opens by advertising stock. The first line is what a grieving family reads before deciding whether to keep reading — open with what the shop will do for them, or what families actually ask for, and name what is in stock after that.`;
}

/**
 * Why a piece of finished post copy is not publishable as written — tone and
 * emptiness, not facts. Returns an array of plain reasons, empty when the copy
 * reads fine, so a caller can put them straight back to the model.
 *
 * Deliberately conservative: it names concrete phrases and one specific
 * framing error rather than trying to judge writing quality in general, which
 * a regular expression cannot do and should not pretend to.
 */
// Generic floral-business words that turn up in all kinds of ordinary shop
// names and, on their own, say nothing specific enough to reliably flag as
// "the post fixated on this" — excluded from the fixation check below so a
// shop named e.g. "The Garden Room", "Petal & Stem", "Rose & Ivy", or
// "Blossoms Florist" doesn't get flagged just because its own copy uses an
// ordinary decorative/business word from its own name a couple of times.
const GENERIC_FLORAL_BUSINESS_WORDS = new Set([
  "bloom", "blooms", "blooming", "garden", "gardens", "floral", "florals",
  "flower", "flowers", "florist", "florists", "shop", "shoppe", "boutique",
  "studio", "co", "company", "house", "market", "room", "petal", "petals",
  "stem", "stems", "vine", "vines", "ivy", "blossom", "blossoms", "bud",
  "buds", "leaf", "leaves", "sprig", "sprigs"
]);

// Ordinary English function words a shop name can still contain ("Lilies
// IN Bloom", "The Rose AND Vine") — never a meaningful identity/flower
// signal on their own, and "in"/"and" appear constantly in any real post
// for unrelated reasons, so counting them would flag nearly everything.
const ENGLISH_STOPWORDS_IN_NAMES = new Set(["the", "a", "an", "in", "on", "of", "and", "or", "for", "to", "at", "by", "with"]);

// A handful of common flower names whose plural doesn't follow the regular
// "add/drop a trailing s" pattern the fallback below assumes — iris/irises
// is the one an independent review actually caught breaking (the fallback
// turned "iris" into the nonsense "iri"). Kept as an explicit, tiny lookup
// rather than a general morphology library, matching this file's existing
// preference for small, real, checkable word lists over clever parsing.
const IRREGULAR_FLORAL_PLURALS = { iris: "irises", irises: "iris" };

// lily/lilies, daisy/daisies, rose/roses, peony/peonies and similar — a
// small, deliberately loose singular/plural expander so the fixation check
// below counts "lily" and "lilies" as the same word without needing a real
// morphology library. Under-matching (an irregular form this misses) only
// means a real fixation goes uncaught this one time, never a false flag —
// the ies/y branches below are what an earlier draft got wrong: "lily"
// only ever expanded to the nonsense "lilys", never to the real plural
// "lilies", so a shop named in the singular (e.g. "Lily Flowers") whose
// copy fixated entirely on the plural word went uncaught.
function floralWordVariants(word) {
  const variants = new Set([word]);
  if (IRREGULAR_FLORAL_PLURALS[word]) {
    variants.add(IRREGULAR_FLORAL_PLURALS[word]);
  } else if (word.endsWith("ies")) {
    variants.add(`${word.slice(0, -3)}y`); // lilies -> lily
  } else if (/[^aeiou]y$/.test(word)) {
    variants.add(`${word.slice(0, -1)}ies`); // lily -> lilies, daisy -> daisies, peony -> peonies
  } else if (word.endsWith("s")) {
    variants.add(word.slice(0, -1)); // roses -> rose
  } else {
    variants.add(`${word}s`); // rose -> roses
  }
  return [...variants];
}

// The actual reported failure's own shape, not just "the word appears" —
// "Our lily collection is looking stunning... varieties on display" reads
// as the post being framed as a product line built around that flower, not
// a passing, ordinary mention of real inventory ("Our roses are looking
// gorgeous today" is fine — a real shop selling real roses gets to say
// so). An independent review found the earlier version (any 2+ raw
// mentions) flagged exactly that kind of ordinary, correct copy. Requiring
// this framing — or, failing that, a much heavier repetition (3+ raw
// mentions, the "our lilies... our lilies... our lilies" shape) — is what
// actually targets the reported failure without punishing a normal post.
function isFramedAsFlowerLine(copy, variants) {
  const alt = variants.join("|");
  return new RegExp(`\\b(?:our|the)\\s+(?:${alt})\\b[^.!?]{0,25}\\b(collection|selection|arrangements?|varieties|variety|display)\\b`, "i").test(copy);
}

export function detectWeakMarketingCopy(requestText, copyText, options = {}) {
  const request = String(requestText || "");
  const copy = String(copyText || "");
  const reasons = [];
  if (!copy.trim()) return reasons;

  // Real, live-found failure that survived shopIdentityRule's own prompt
  // instruction: "Make today's Facebook post for lilies in bloom" (shop:
  // "Lilies in Bloom" — nothing more than the shop's own name restated,
  // no real occasion at all) still came back "Our lily collection is
  // looking stunning, with gorgeous Asiatic and Oriental varieties on
  // display" — entirely about the flower, invented sub-varieties and all.
  // A prompt instruction is a statistical nudge, not a hard constraint
  // (see generateImageCheckingText's own reasoning for the same lesson on
  // the image side) — this is the reactive backstop, checked only when
  // requestIsJustShopName already established there is no real topic here
  // to legitimately be writing about.
  if (options.shopName && requestIsJustShopName(request, options.shopName)) {
    // significantWords — the same tokenizer requestIsJustShopName itself
    // uses (shared, not a second copy of the same regex) — also fixes a
    // real gap an independent review found: a shop name with a possessive
    // ("Iris's Flowers") used to collapse into the nonsense token "iriss"
    // here, hiding the real identity word "iris" from every check below.
    const nonStopwordShopWords = [...new Set(significantWords(options.shopName))].filter((w) => !ENGLISH_STOPWORDS_IN_NAMES.has(w));
    const nonGenericShopWords = nonStopwordShopWords.filter((w) => !GENERIC_FLORAL_BUSINESS_WORDS.has(w));
    // A second real gap the same review found: excluding generic words
    // like "ivy"/"blossom" fixed the "Rose & Ivy"/"Blossoms Florist" false
    // positives above by preferring a shop's more SPECIFIC word when one
    // exists — but applied blindly, it also silently stopped checking a
    // shop whose entire identity genuinely IS one of those words (a real
    // shop simply named "Ivy," or "Ivy & Blossom"), leaving it with zero
    // fixation checking at all, forever. Only drop the generic words when
    // something more specific is actually left to check instead of them —
    // never drop the shop's own name down to nothing.
    const identityWords = nonGenericShopWords.length ? nonGenericShopWords : nonStopwordShopWords;
    for (const word of identityWords) {
      const variants = floralWordVariants(word);
      const matches = copy.match(new RegExp(`\\b(?:${variants.join("|")})\\b`, "gi")) || [];
      if (isFramedAsFlowerLine(copy, variants) || matches.length >= 3) {
        reasons.push(
          `This post is framed entirely around "${word}" (mentioned ${matches.length} time${matches.length === 1 ? "" : "s"}), even though the request was nothing more than the shop's own name — there is no real occasion here. Write an ordinary "come see us today" update instead. Only mention "${word}" at all if it's genuinely in the shop's real current inventory, using the real product name exactly as given — never invent a specific variety or type that wasn't supplied.`
        );
      }
    }
  }

  const requestIsBereavement = BEREAVEMENT_CONTEXT_RE.test(request);
  if (requestIsBereavement || BEREAVEMENT_CONTEXT_RE.test(copy)) {
    if (!requestIsBereavement) {
      // The OPPOSITE direction of the celebratory-mismatch check below: a
      // request with NO death/loss signal at all — an everyday "flowers say
      // I care" post, a birthday, a thank-you — coming back with invented
      // sympathy/funeral language the florist never asked for. Real,
      // live-found failure: "Make me a post to remind everyone that flowers
      // say I care without saying a word" — a universal, ordinary sentiment
      // — came back reading "to express their love and condolences in the
      // most delicate moments," treating a plain feel-good post as a
      // bereavement message. A shop's actual sympathy work deserves the
      // careful writing the check below exists for; it must never be
      // invented onto a request that was never about a death or a loss at
      // all. Checked ONLY when the request itself shows no bereavement
      // signal — a real sympathy request phrased in words this regex
      // doesn't happen to catch must fall through to the check below
      // instead, not be wrongly told its own sympathy wording was invented.
      const invented = copy.match(BEREAVEMENT_CONTEXT_RE);
      reasons.push(
        `"${invented[0]}" reads as sympathy/funeral wording, but nothing about this request was about a death or a loss. Never invent bereavement framing onto an ordinary post — write about what was actually asked for.`
      );
    }
    const hit = copy.match(CELEBRATORY_RE);
    if (hit) {
      reasons.push(
        `This is sympathy writing and it uses celebratory language ("${hit[0]}"). A death is not a milestone or an occasion to celebrate. Write plainly and gently, with no upbeat framing and no exclamation marks.`
      );
    }
  }

  // Only judgeable when the shop's own number is known. Without it there is no
  // way to tell the real number from an invented one, and guessing would flag
  // every correct flyer and send the retry chasing its own tail forever. A
  // caller that cannot supply it gets no opinion rather than a wrong one.
  const invented = options.shopPhone
    ? detectFabricatedContactNumbers({ requestText: request, shopPhone: options.shopPhone, copyText: copy })
    : // Without the shop's number one real number cannot be told from another
      // — but a PLACEHOLDER needs no such comparison, and this is the case
      // that put "(555) 555-5555" on Ashley's funeral flyer twice. A shop with
      // an incomplete profile is the one most likely to be handed an invented
      // number, and the one the old check abandoned.
      detectPlaceholderContactNumbers({ requestText: request, copyText: copy });
  if (invented.length) {
    reasons.push(
      `"${invented[0]}" is a phone number nobody gave you. Never write a number that is not the shop's own or one the florist supplied — a family ringing it does not reach the shop.`
    );
  }

  const claim = copy.match(SERVICE_CLAIM_RE);
  if (claim) {
    reasons.push(
      `"${claim[0]}" says this shop holds the service itself. A florist supplies the FLOWERS for a funeral — the service is held by a funeral home or a church. Say "funeral flowers", "sympathy flowers" or "flowers for the service" instead.`
    );
  } else if (AMBIGUOUS_ARRANGEMENT_RE.test(copy) && !FLOWER_WORD_RE.test(copy)) {
    reasons.push(
      "\"Funeral arrangements\" reads as undertaking rather than flowers when nothing nearby says otherwise. Name the flowers."
    );
  }

  // The headline is judged on its own: it is the largest thing on the flyer and
  // the first thing read, and a fault there is not diluted by the sentences
  // under it. Only supplied when there IS a separate headline — a caption has
  // none, and inventing one from its first sentence would be judging a thing
  // the florist never wrote.
  const headlineFault = detectSympathyProductHeadline(requestText, options.headline, copy);
  if (headlineFault) reasons.push(headlineFault);

  // The same fault written out as a sentence, which is how it reaches a
  // caption. Only when the headline check has not already said it — on a flyer
  // the concatenated text begins with the headline, so both would fire on one
  // fault and the retry would read it as two.
  if (!headlineFault) {
    // On a flyer the headline is the first thing in `copy`; strip it so the
    // opening judged here is the message's own first sentence, not the
    // headline a second time.
    const head = String(options.headline || "").trim();
    const withoutHeadline = head && copy.startsWith(head) ? copy.slice(head.length).replace(/^[\s.—-]+/, "") : copy;
    const openingFault = detectSympathyProductOpening(requestText, withoutHeadline);
    if (openingFault) reasons.push(openingFault);
  }

  // The phrases the model ACTUALLY wrote, not just how many rules matched.
  //
  // Ashley's caption came back carrying three of these at once — "we
  // understand the importance of", "our experienced florists", "high-quality"
  // — so the check fired, the retry ran, and the second attempt came back
  // just as stock. It shipped anyway. Handing back "cut the stock phrases"
  // tells a model there is a problem without telling it where: it can only
  // guess which sentence offended, and it guessed wrong. Quoting its own words
  // back is the difference between a note and an instruction.
  //
  // Real, live-found failure: a later, real caption shipped with exactly
  // ONE of these — "we've got you covered" — and passed, because this used
  // to require two. Every phrase on this list was chosen because it reads
  // as recognizable stock copy the instant it appears, not because it takes
  // several of them together to be a problem — the retry instruction below
  // already says "must not appear anywhere in the rewrite," which a
  // threshold of two silently contradicted for exactly this case. One is
  // enough.
  const fillerHits = FILLER_PHRASES.map((re) => copy.match(re))
    .filter(Boolean)
    .map((hit) => hit[0].trim());
  if (fillerHits.length >= 1) {
    reasons.push(
      "Most of this could be about any business in any industry. These exact phrases must not appear anywhere in the rewrite: " +
        fillerHits.map((phrase) => `"${phrase}"`).join(", ") +
        ". Say something only this florist could say."
    );
  } else {
    // The general form of the same failure, for the shapes the list above has
    // not seen yet. Only raised when the copy is MOSTLY hollow — one general
    // sentence among specific ones is ordinary writing, not filler — and only
    // as a second opinion, so a post already condemned above isn't told the
    // same thing twice in different words.
    const substantive = sentencesOf(copy).filter(
      (s) => s.split(/\s+/).filter(Boolean).length >= SUBSTANTIVE_SENTENCE_WORDS
    );
    const hollow = findHollowSentences(copy, options.shopName);
    if (hollow.length >= 2 && hollow.length >= substantive.length * 0.6) {
      reasons.push(
        `Nothing in this can be pictured or acted on — "${hollow[0]}" would read the same for any business with the nouns swapped. Name the actual flowers, what is being made, or what happens next.`
      );
    }
  }

  // The post Ashley was shown ran to five long sentences of it.
  const sentences = copy.split(/[.!?]+\s/).filter((part) => part.trim().length > 12);
  if (sentences.length > 5 && copy.length > 420) {
    reasons.push("Far too long for a social post. Three or four short sentences, and stop.");
  }

  return reasons;
}

// ===========================================================================
// BATCH 1 — the authoritative Marketing output-safety pipeline.
//
// Real, live-found failure history this batch closes (all four reproduced
// as regression tests below): (A) a weak, generic visual/copy pattern with
// nothing specific to this florist; (B) an invented "latest shipment of
// Freedom roses" paired with accidental funeral content from one generic
// request; (C) invented present-tense "using peonies/alstroemeria/spray
// roses" composition claims with zero verified inventory; (D) a generated
// "marble counter" scene detail (visual_brief/creative_brief — the AI
// image model's own invention) crossing into customer-facing wording as
// "on our marble counter," an asserted fact about the real shop's real
// premises with nothing behind it.
//
// Every one of these was caught, piecemeal, by a different call site
// hand-wiring its own subset of detectors in a different order
// (marketing-studio.js's generate_content got the most; revise_content,
// ai-orchestrator.js's Lily job runner, and marketing-compound-
// orchestrator.js got none at all). evaluateMarketingOutput() below is the
// one place that decision gets made from now on — every detector it calls
// already existed above in this same file; nothing here is a second
// implementation of anything.
// ===========================================================================

// ---------------------------------------------------------------------------
// The visual-fiction boundary.
//
// An AI image model's visual_brief/creative_brief is free to invent a
// scene — a marble counter, a cooler, a delivery van, a wedding — that is
// exactly what it's asked to imagine, and creativity there is free. But a
// scene detail is not evidence about the real shop: nothing verifies this
// shop actually HAS a marble counter, a delivery van, or a booking for
// "today's wedding." The moment an invented detail crosses from the visual
// concept into customer-facing WORDING as an asserted fact ("on our marble
// counter"), it becomes exactly the same shape of unverified business
// claim detectUnverifiedInventoryStateClaim already exists to catch for
// inventory — this is that same principle applied to physical premises
// and events instead of stock.
//
// Deliberately narrow and claim-shaped, not a ban on any of these words —
// "marble counters make a beautiful display surface" (an opinion, no
// possessive "our") and "weddings are one of our favorite occasions to
// arrange for" (a category, not a specific claimed event) are never
// flagged; only an explicit possessive/locative claim about THIS shop's
// own premises, or a specific claimed event, is.
// ---------------------------------------------------------------------------

const SCENE_FICTION_CLAIM_RE =
  /\b(?:on|in|at|outside|near|from) (?:our|the shop'?s|the store'?s) (marble counters?|coolers?|storefronts?|delivery vans?|shop windows?|front windows?|display cases?|checkout counters?|workbenches?)\b|\bour (?:delivery van|storefront|cooler|marble counter)\b|\bon display in our shop\b|\bat (?:today'?s|this) wedding\b/i;

/**
 * Sentences in `generatedText` that assert a specific real-world physical
 * detail or event as a FACT about the shop, with nothing verifying it.
 * Each returned entry is the exact offending sentence — same "quote it
 * back" convention as detectUnverifiedInventoryStateClaim.
 *
 * `shopEvidence.confirmedPhysicalDetails` (an array of phrases), when a
 * caller actually has real, independently-verified premises data, exempts
 * a matching phrase from being flagged — no current caller supplies this,
 * so in practice every match is flagged, which is the conservative,
 * correct default per "AI-generated visual details may never become
 * business facts unless independently verified."
 *
 * Pure. Never shop-specific — every input is supplied by the caller.
 */
export function detectVisualFictionLeakage({ generatedText, shopEvidence = {} } = {}) {
  const text = String(generatedText || "");
  const confirmed = new Set((shopEvidence?.confirmedPhysicalDetails || []).map((d) => String(d).toLowerCase()));
  const violations = [];
  for (const sentence of sentencesOf(text)) {
    const match = sentence.match(SCENE_FICTION_CLAIM_RE);
    if (!match) continue;
    if (confirmed.has(match[0].toLowerCase())) continue;
    violations.push(sentence.trim());
  }
  return violations;
}

/**
 * Removes every sentence flagged by detectVisualFictionLeakage from
 * `text`, rebuilding the remainder — the same "cut the sentence, no
 * fragment survives" pattern stripUnverifiedInventoryClaims() already
 * uses, since there is no safe substitute for an invented physical detail
 * either.
 *
 * Pure. Returns { text, removed }.
 */
export function stripVisualFictionLeakage({ generatedText, shopEvidence = {} } = {}) {
  const original = String(generatedText || "");
  const violations = detectVisualFictionLeakage({ generatedText: original, shopEvidence });
  if (!violations.length) return { text: original, removed: [] };
  const violationSet = new Set(violations);
  const kept = sentencesOf(original).filter((s) => !violationSet.has(s.trim()));
  const text = kept.join(" ").replace(/[ \t]{2,}/g, " ").trim();
  return { text, removed: violations };
}

// ---------------------------------------------------------------------------
// CTA coherence — the call-to-action line is the one most likely to carry
// urgency/sale language out of habit ("Order now and save!") even when
// nothing about the post is a real sale, and the one most likely to go
// celebratory on a plain operational notice. Reuses the SAME signals
// detectConceptCoherenceMismatch already trusts (REAL_PROMOTION_SIGNAL_RE
// via requestSignalsRealPromotion, CELEBRATORY_RE) rather than a third,
// separate urgency vocabulary.
// ---------------------------------------------------------------------------

const CTA_URGENCY_RE = /\blimited time\b|\bwhile supplies last\b|\bdon'?t miss\b|\bhurry\b|\bact now\b|\bsale ends\b|\btoday only\b/i;

export function detectCtaCoherenceMismatch({ concept, ctaText, requestText } = {}) {
  const cta = String(ctaText || "").trim();
  if (!cta) return null;
  const request = String(requestText || "");

  if (concept?.objective === "operational" && (CELEBRATORY_RE.test(cta) || REAL_PROMOTION_SIGNAL_RE.test(cta))) {
    return `The CTA ("${cta}") reads as celebratory or promotional, but this post is a plain operational notice — the call to action must stay factual (a phone number, "Stop by today"), never a sales pitch.`;
  }

  if ((REAL_PROMOTION_SIGNAL_RE.test(cta) || CTA_URGENCY_RE.test(cta)) && !requestSignalsRealPromotion(request) && concept?.objective !== "promotion") {
    return `The CTA ("${cta}") invents urgency or a sale/discount that nothing in the actual request describes — a call to action must never manufacture urgency that isn't real.`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// evaluateMarketingOutput — the ONE authoritative Marketing output-safety
// evaluator. Every text/creative-scene output any Marketing/Lily route
// produces must be checked here before it is shown to a florist or used to
// build an image prompt — never re-implemented per route. This function
// invents no new detection logic of its own beyond the two small additions
// above (detectVisualFictionLeakage, detectCtaCoherenceMismatch): it
// composes the existing, independently-tested detectors in this file
// (detectWeakMarketingCopy, detectUnverifiedInventoryStateClaim,
// detectPermanentClosureMismatch, detectInventedOperationalContent,
// stripFabricatedContactNumbers, sanitizeUngroundedFlowerNames,
// detectConceptCoherenceMismatch) into one decision.
//
// component:
//   "caption"        — the Facebook/social caption (an object with
//                       headline/body/cta, or a plain string).
//   "flyer_text"      — the flyer's on-image headline/body/cta.
//   "video_concept"   — a video plan's script/scenes/captions, joined into
//                       one string by the caller.
//   "creative_scene"  — visual_brief or creative_brief.primary_subject: a
//                       bare descriptive noun phrase, never a claim
//                       sentence — evaluated ONLY for ungrounded flower
//                       names (sanitizeUngroundedFlowerNames), since
//                       that's the one thing this kind of field can invent
//                       that must never survive.
//
// isRetryAttempt: pass true when `candidate` is itself the result of a
// caller's ONE bounded corrective retry — turns a still-unrepairable
// problem into "reject" instead of a second "retry" (no recursive
// retries; the caller must fall back or fail closed at that point).
//
// Returns { decision, safeCandidate, repaired, reasons, evidenceUsed, checksRun }.
// safeCandidate is ALWAYS populated for a text component (never null) —
// the deterministic repair pass (fabricated numbers, unverified inventory
// claims, leaked visual-fiction detail) runs unconditionally, so there is
// always a best-effort cleaned value to fall back to even when `reasons`
// also calls for a retry, mirroring the pre-existing "strip regardless of
// the retry outcome" behavior this replaces.
// decision:
//   "pass"   — candidate is safe to use exactly as given (safeCandidate
//              equals the original candidate).
//   "repair" — candidate had ONLY a deterministically-fixable problem (a
//              fabricated phone number and nothing else) — safeCandidate
//              is the repaired value, always safe to use, no retry needed.
//   "retry"  — an unrepairable problem exists (weak copy, an unverified
//              inventory/visual-fiction claim — deterministically
//              strippable, but still worth a retry first since a rewrite
//              may fix it without losing the sentence, an invented
//              sympathy/celebratory mismatch, a permanent-closure misread,
//              invented operational content, a concept/CTA coherence
//              mismatch, an unsupported promotion) and this is the FIRST
//              look (isRetryAttempt was false) — `reasons` is real,
//              specific feedback for one bounded regeneration attempt;
//              safeCandidate is the best-effort stripped fallback if the
//              caller chooses not to retry.
//   "reject" — the same shape of problem survived a SECOND look
//              (isRetryAttempt was true) — the caller must fall back to a
//              deterministic/real-photo/safe-generic asset, or fail
//              closed; safeCandidate (the stripped text) must still never
//              be shown as-is when reasons remain — only a real fallback
//              may be shown.
export function evaluateMarketingOutput({
  route,
  request,
  shopEvidence = {},
  inventoryEvidence = [],
  verifiedServiceSignals = [],
  canonicalConcept = null,
  creativeScene = null,
  candidate,
  component,
  isRetryAttempt = false
} = {}) {
  const requestText = String(request || "");
  const verifiedFlowerNames = (inventoryEvidence || []).map((i) => (typeof i === "string" ? i : i?.name)).filter(Boolean);
  const shopName = shopEvidence?.name || shopEvidence?.shopName || null;
  const shopPhone = shopEvidence?.phone || null;
  const checksRun = [];
  const evidenceUsed = {
    verifiedFlowerNames,
    shopNameKnown: Boolean(shopName),
    shopPhoneKnown: Boolean(shopPhone),
    requestFactTokens: extractFactTokens(requestText)
  };

  if (component === "creative_scene") {
    checksRun.push("sanitizeUngroundedFlowerNames");
    const inventoryIntentConfirmed = requestSignalsIntentionalInventoryUse(requestText);
    evidenceUsed.inventoryIntentConfirmed = inventoryIntentConfirmed;
    const original = String(candidate || "");
    const cleaned = sanitizeUngroundedFlowerNames({ text: original, requestText, verifiedFlowerNames, inventoryIntentConfirmed });
    if (cleaned.removed.length) {
      return {
        decision: "repair",
        safeCandidate: cleaned.text,
        repaired: true,
        reasons: cleaned.removed.map((f) => `"${f}" is not a flower the florist named or verified inventory supports for this post — replaced with generic wording.`),
        evidenceUsed,
        checksRun
      };
    }
    return { decision: "pass", safeCandidate: original, repaired: false, reasons: [], evidenceUsed, checksRun };
  }

  // Text components: caption / flyer_text / video_concept. Normalized into
  // a { headline, body, cta } field map (unused fields stay null).
  //
  // Two independent passes over the SAME raw candidate, deliberately not
  // combined into one, mirroring exactly how the code this replaces
  // behaved (marketing-studio.js's own copyQuality/flyerQuality plus its
  // unconditional post-retry strip):
  //   1. `reasons` — computed on the RAW, pre-repair candidate. This is
  //      what decides whether a bounded model retry is worth asking for.
  //      An unverified inventory claim or a leaked visual-fiction detail
  //      counts here even though it's ALSO deterministically strippable —
  //      exactly like the pre-existing behavior, where such a violation
  //      both earns a retry AND gets stripped as a backstop regardless of
  //      what the retry produces. A fabricated contact number deliberately
  //      does NOT count here — that was always a silent, unconditional
  //      substitution, never something worth spending a retry on.
  //   2. The deterministic repair pass — ALWAYS run, unconditional on
  //      whether `reasons` is empty, so `safeCandidate` is always the
  //      best-effort cleaned text a caller can fall back to even when a
  //      retry is also warranted (never null) — the caller decides
  //      whether to retry first and re-evaluate, or use this directly.
  const isObjectCandidate = Boolean(candidate && typeof candidate === "object");
  const originalFields = isObjectCandidate
    ? { headline: candidate.headline ?? null, body: candidate.body ?? null, cta: candidate.cta ?? null }
    : { headline: null, body: String(candidate ?? ""), cta: null };
  const joinFields = (f) => [f.headline, f.body, f.cta].filter((v) => v != null && v !== "").join(" ").trim();
  const rawJoined = joinFields(originalFields);

  const reasons = [];

  checksRun.push("detectWeakMarketingCopy");
  for (const w of detectWeakMarketingCopy(requestText, rawJoined, { shopPhone, shopName, headline: originalFields.headline })) {
    reasons.push(w);
  }

  checksRun.push("detectUnverifiedInventoryStateClaim");
  for (const v of detectUnverifiedInventoryStateClaim({ generatedText: rawJoined, requestText, verifiedFlowerNames })) {
    reasons.push(
      `"${v}" claims a specific business/inventory fact ("just arrived," "we have X," etc.) with no verified evidence behind it. Only claim what the real inventory data above or the florist's own request actually supports — use generic flower language instead.`
    );
  }

  checksRun.push("detectUnverifiedServiceAvailabilityClaim");
  for (const v of detectUnverifiedServiceAvailabilityClaim({ generatedText: rawJoined, requestText, verifiedServiceSignals })) {
    reasons.push(
      `"${v}" claims a specific service/availability state ("same-day delivery," "open now," "walk-ins welcome," etc.) with no verified evidence behind it. Only claim a service state the florist's own request actually states or Florisyn has verified — drop the claim or generalize it otherwise.`
    );
  }

  checksRun.push("detectInventedTemporalClaim");
  for (const v of detectInventedTemporalClaim({ generatedText: rawJoined, requestText })) {
    reasons.push(
      `"${v}" names a specific day-of-week, "today/tonight/tomorrow," "this weekend," or a date that the florist's own request never supplied — never invent a day or date just because it sounds catchy. Only use temporal language the request itself actually gives you.`
    );
  }

  checksRun.push("detectVisualFictionLeakage");
  for (const v of detectVisualFictionLeakage({ generatedText: rawJoined, shopEvidence })) {
    reasons.push(
      `"${v}" describes a specific real-world detail (a location, an object, an event) that was never verified — only the AI-generated visual concept invented it. Never assert this as a fact about the shop; keep it purely in the visual description, or drop it from the wording.`
    );
  }

  checksRun.push("detectPermanentClosureMismatch");
  const closureMismatch = detectPermanentClosureMismatch(requestText, rawJoined);
  if (closureMismatch) {
    reasons.push(
      "This reads as a permanent closure, but the request only ever described a temporary/scheduled change — never write a temporary change as if the business itself is shutting down."
    );
  }

  checksRun.push("detectInventedOperationalContent");
  if (!closureMismatch && detectInventedOperationalContent(requestText, rawJoined)) {
    reasons.push(
      "This invents urgency, a reason, gratitude, or a future plan the florist never wrote — a plain operational notice must say only what was actually asked."
    );
  }

  if (canonicalConcept && component === "flyer_text") {
    checksRun.push("detectConceptCoherenceMismatch");
    const mismatch = detectConceptCoherenceMismatch({
      concept: canonicalConcept,
      captionText: canonicalConcept.captionExcerpt || "",
      flyerText: rawJoined,
      requestText
    });
    if (mismatch) reasons.push(mismatch);

    checksRun.push("detectCtaCoherenceMismatch");
    const ctaMismatch = detectCtaCoherenceMismatch({ concept: canonicalConcept, ctaText: originalFields.cta || "", requestText });
    if (ctaMismatch) reasons.push(ctaMismatch);
  }

  // Deterministic repair pass — always runs, per field, regardless of
  // whether `reasons` above found anything else wrong.
  checksRun.push(
    "stripFabricatedContactNumbers",
    "stripUnverifiedInventoryClaims",
    "stripUnverifiedServiceAvailabilityClaims",
    "stripInventedTemporalClaims",
    "stripVisualFictionLeakage"
  );
  const fields = { ...originalFields };
  let repaired = false;
  for (const key of ["headline", "body", "cta"]) {
    if (fields[key] == null) continue;
    let text = fields[key];
    const numberCleaned = stripFabricatedContactNumbers({ requestText, shopPhone, copyText: text });
    if (numberCleaned.removed.length) {
      text = numberCleaned.text;
      repaired = true;
    }
    const inventoryCleaned = stripUnverifiedInventoryClaims({ generatedText: text, requestText, verifiedFlowerNames });
    if (inventoryCleaned.removed.length) {
      text = inventoryCleaned.text;
      repaired = true;
    }
    const serviceCleaned = stripUnverifiedServiceAvailabilityClaims({ generatedText: text, requestText, verifiedServiceSignals });
    if (serviceCleaned.removed.length) {
      text = serviceCleaned.text;
      repaired = true;
    }
    const temporalCleaned = stripInventedTemporalClaims({ generatedText: text, requestText });
    if (temporalCleaned.removed.length) {
      text = temporalCleaned.text;
      repaired = true;
    }
    const fictionCleaned = stripVisualFictionLeakage({ generatedText: text, shopEvidence });
    if (fictionCleaned.removed.length) {
      text = fictionCleaned.text;
      repaired = true;
    }
    fields[key] = text;
  }
  const safeCandidate = isObjectCandidate ? { ...candidate, ...fields } : fields.body;

  if (reasons.length) {
    return { decision: isRetryAttempt ? "reject" : "retry", safeCandidate, repaired, reasons, evidenceUsed, checksRun };
  }
  if (repaired) {
    return { decision: "repair", safeCandidate, repaired: true, reasons: [], evidenceUsed, checksRun };
  }
  return { decision: "pass", safeCandidate: candidate, repaired: false, reasons: [], evidenceUsed, checksRun };
}
