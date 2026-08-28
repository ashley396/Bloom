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

const BEREAVEMENT_CONTEXT_RE =
  /\b(funeral|sympathy|memorial|bereave(?:d|ment)|condolence|casket|graveside|wake|passed away|loss of|in memory|tribute|remembrance)\b/i;

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
  /\bat [A-Z][\w' ]{1,40}, we (?:believe|understand|know)\b/,
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
const CONTACT_NUMBER_RE = /\+?\d[\d()\s.-]{5,}\d/g;
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

function sentencesOf(text) {
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
 * Why a piece of finished post copy is not publishable as written — tone and
 * emptiness, not facts. Returns an array of plain reasons, empty when the copy
 * reads fine, so a caller can put them straight back to the model.
 *
 * Deliberately conservative: it names concrete phrases and one specific
 * framing error rather than trying to judge writing quality in general, which
 * a regular expression cannot do and should not pretend to.
 */
export function detectWeakMarketingCopy(requestText, copyText, options = {}) {
  const request = String(requestText || "");
  const copy = String(copyText || "");
  const reasons = [];
  if (!copy.trim()) return reasons;

  if (BEREAVEMENT_CONTEXT_RE.test(request) || BEREAVEMENT_CONTEXT_RE.test(copy)) {
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
    : [];
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

  const filler = FILLER_PHRASES.filter((re) => re.test(copy));
  if (filler.length >= 2) {
    reasons.push(
      "Most of this could be about any business in any industry. Cut the stock phrases and say something only this florist could say."
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
