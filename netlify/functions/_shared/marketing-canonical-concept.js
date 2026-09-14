/**
 * Florisyn Marketing Studio — the one canonical marketing concept model
 * (Batch 4, "Persisted canonical concept + revision enforcement").
 *
 * Real problem this closes: generate_content already builds an ad-hoc
 * `concept` object (objective/primarySubject/captionExcerpt/isSympathy —
 * see marketing-studio.js) and threads it into the caption/flyer
 * generation calls and evaluateMarketingOutput's coherence checks for
 * THIS one request — but it was never persisted. A later revision
 * (revise_content) has no record of what the post was actually about, so
 * "make the caption shorter" or "regenerate the image" could silently
 * drift the underlying idea (subject, occasion, promotion state, CTA
 * intent, sympathy classification) with nothing to catch it, and Undo had
 * no concept to restore alongside the prior asset.
 *
 * This module is the one place that:
 *   - defines the canonical concept's shape and its bounded field enums
 *     (reusing every enum/detector that already exists elsewhere —
 *     SOCIAL_POST_OBJECTIVES, BEREAVEMENT_CONTEXT_RE,
 *     requestSignalsRealPromotion, requestSignalsIntentionalInventoryUse —
 *     never a second, competing classification system for the same idea);
 *   - builds a concept from real generation-time signals;
 *   - lets a revision inherit a parent's concept, changing only the
 *     fields the florist's own instruction actually asked to change;
 *   - detects, deterministically, when an instruction is an EXPLICIT
 *     concept-changing request vs. an ordinary wording/visual-execution
 *     tweak;
 *   - detects unrequested concept drift between two concepts (structured
 *     field comparison — never a new free-form AI call for this).
 *
 * Persistence: `asset.content.canonical_concept` (existing JSON column,
 * no migration) — see Part B/M of the Batch 4 spec.
 */

import { SOCIAL_POST_OBJECTIVES } from "./ai-creative-engine.js";
import { BEREAVEMENT_CONTEXT_RE, requestSignalsRealPromotion, requestSignalsIntentionalInventoryUse, sentencesOf, normalizeDiscountWording } from "./marketing-content-revision.js";

export const CANONICAL_CONCEPT_VERSION = 1;

// Reused, not redefined: the same fixed objective enum generateSocialPost
// itself already reports against (ai-creative-engine.js).
export { SOCIAL_POST_OBJECTIVES };

// Batch 4: no existing bounded classification covers these — the
// research pass behind this module confirmed FLORIST_OCCASIONS
// (marketing-occasion-calendar.js) is a month-planner concept never
// threaded into generation, and no CTA/subject-class enum exists at all.
// Kept deliberately small and deterministic (keyword/regex only, never a
// new AI call) — see classifyOccasionCategory/classifyPrimarySubjectClass/
// classifyCtaIntent below for exactly what drives each one.
export const OCCASION_CATEGORIES = Object.freeze([
  "sympathy",
  "birthday",
  "anniversary",
  "wedding_event",
  "graduation",
  "new_baby",
  "get_well",
  "holiday_seasonal",
  "operational_notice",
  // Batch 5.3 ("event/deadline classification"): a real staging
  // acceptance test proved a named school-dance-style event reminder
  // ("remind Students and Parents the Homecoming Dance is September
  // 19th... need to be ordered as soon as possible") silently collapsed
  // to "general" — none of the keyword rules above recognize it, and
  // "general" resolves in marketing-creative-direction.js's
  // resolveOccasionTreatment() to the SAME "everyday_floral" treatment
  // as any ordinary, no-deadline post, losing the "customer action +
  // real deadline" framing entirely before the image prompt is even
  // built. Deliberately narrow — named school-event occasions only
  // (Homecoming/Prom/school dance/school formal), never a broad "any
  // event word" classifier (see OCCASION_KEYWORD_RULES below).
  "event_reminder",
  "general"
]);

export const PRIMARY_SUBJECT_CLASSES = Object.freeze(["floral_arrangement", "mascot_or_character", "people_or_lifestyle", "storefront_or_location", "other"]);

export const CAPTION_INTENTS = Object.freeze(["informational", "promotional", "celebratory", "sympathetic", "operational_notice", "awareness_soft_sell"]);

export const CTA_INTENTS = Object.freeze(["order_now", "call_shop", "visit_shop", "learn_more", "contact_general", "none"]);

export const CREATIVE_FAMILIES = Object.freeze(["designed_flyer", "plain_photo_post", "video_concept", "text_only"]);

// Part K: reuses this codebase's own existing routing terminology
// (photo_choice: upload/generate/reuse; photo_strategy: subject_forward/
// calm_backdrop; style_tier: generated/template/upload) rather than
// inventing a parallel vocabulary — this enum just names the CONCLUSION
// those existing fields already imply.
export const ASSET_ROUTES = Object.freeze(["real_shop_photo", "prior_real_photo", "ai_generated_photo", "flyer_background", "deterministic_template", "video_concept", "none"]);

export const FACT_REQUIREMENT_KEYS = Object.freeze(["phone_number", "promotion", "inventory_grounding", "event_date", "shop_hours", "delivery_service"]);

export const SYMPATHY_CLASSIFICATIONS = Object.freeze(["sympathy", "not_sympathy"]);
export const INVENTORY_INTENTS = Object.freeze(["inventory_driven", "not_inventory_driven"]);
export const PROMOTION_INTENTS = Object.freeze(["real_promotion", "not_promotion"]);

// The concept's own "identity" fields — the ones a revision must never
// drift on without an explicit, detected concept-change request. Deliberately
// excludes visualDirection/factRequirements/platform/version/captionIntent:
// those are either execution detail (allowed to shift with ordinary
// wording/visual tweaks) or derived/administrative, not the idea itself.
export const CONCEPT_IDENTITY_FIELDS = Object.freeze([
  "objective",
  "occasionCategory",
  "primarySubjectClass",
  "ctaIntent",
  "promotionIntent",
  "sympathyClassification",
  "inventoryIntent",
  "assetRoute",
  // Batch 6: real identity decisions (what campaign, who it's for, what
  // structural creative mode) — not execution detail, so protected
  // against silent drift exactly like occasionCategory/ctaIntent above.
  // copyVoice is deliberately excluded: tone is allowed to shift with an
  // ordinary wording tweak, the same way captionIntent/visualDirection
  // already are. messageIntent (Test C, "everyday social creative
  // architecture" batch) is deliberately excluded for the same reason as
  // copyVoice: it is a rescue/composition-time signal about WHAT is being
  // said, not a protected identity fact — an ordinary wording tweak may
  // legitimately shift it (e.g. adding "today" mid-revision) without that
  // counting as concept drift.
  "namedCampaign",
  "audience",
  "creativeMode"
]);

// Batch 5.3: the three named school-dance-style event reminders. Kept as
// its own array (not inlined into OCCASION_KEYWORD_RULES) so both the
// coarse occasionCategory bucket below AND classifyNamedCampaign's finer
// disambiguation reuse the exact same patterns — never two competing
// regex sets that could disagree about what counts as "Homecoming."
const EVENT_REMINDER_RULES = [
  { campaign: "homecoming", re: /\bhomecoming\b/i },
  { campaign: "prom", re: /\bproms?\b/i },
  // "school formal" (not bare "formal", which false-positives on ordinary
  // phrases like "a formal arrangement") keeps this narrow, per Ashley's
  // own instruction not to build a broad "any event word" classifier.
  { campaign: "school_dance", re: /\bschool dance\b|\bschool formal\b/i }
];

// Batch 6 ("expand campaign/occasion classification"): major recurring
// florist holidays that previously fell through to plain "general" —
// real staging finding (Valentine's/Mother's Day/Christmas/Admin
// Professionals Day/National Girlfriends Day all unrecognized). Bucketed
// into the EXISTING "holiday_seasonal" category (never a new category
// per holiday — Ashley's own instruction: "avoid turning every named
// holiday into a completely separate layout implementation"); the
// specific identity is preserved separately via namedCampaign for
// palette/mood/copy-voice purposes, never by exploding the layout
// system itself. Alias-based, not literal-spelling-based: each pattern
// matches the ordinary natural-language forms a florist would actually
// type, not one exact phrase.
const NAMED_HOLIDAY_RULES = [
  { campaign: "valentines_day", re: /\bvalentine'?s?(?:\s*day)?\b/i },
  { campaign: "mothers_day", re: /\bmother'?s\s*day\b/i },
  { campaign: "christmas", re: /\bchristmas\b|\bxmas\b/i },
  { campaign: "admin_professionals_day", re: /\badministrative professionals?(?:'?\s*(?:day|week))?\b|\badmin(?:istrative)? assistants?(?:'?\s*day)?\b|\bsecretaries?(?:'?\s*day)?\b/i },
  { campaign: "girlfriends_day", re: /\b(?:national\s+)?girlfriends?\s*day\b/i }
];

const OCCASION_KEYWORD_RULES = [
  { category: "birthday", re: /\bbirthdays?\b/i },
  { category: "anniversary", re: /\banniversar(?:y|ies)\b/i },
  { category: "wedding_event", re: /\bweddings?\b|\bbridal\b|\bengagement\b/i },
  { category: "graduation", re: /\bgraduations?\b|\bgrads?\b/i },
  { category: "new_baby", re: /\bnew ?baby\b|\bbaby shower\b|\bnewborn\b/i },
  { category: "get_well", re: /\bget well\b|\bfeel better\b/i },
  // Batch 5.3: named school-dance-style event reminders — see
  // OCCASION_CATEGORIES's own comment on "event_reminder" above.
  ...EVENT_REMINDER_RULES.map((rule) => ({ category: "event_reminder", re: rule.re })),
  // Batch 6: the five newly-recognized holidays, all bucketed into the
  // existing holiday_seasonal category.
  ...NAMED_HOLIDAY_RULES.map((rule) => ({ category: "holiday_seasonal", re: rule.re }))
];

/**
 * Batch 4, Part A: occasionCategory. Sympathy is checked first (its own
 * dedicated, already-tested detector — BEREAVEMENT_CONTEXT_RE — is the
 * single source of truth; this never re-derives it independently, so the
 * two fields can never disagree). Then operational (reuses the objective
 * this request already earned). Then a small set of real, common florist
 * occasion keywords. Falls through to `holiday_seasonal` for a
 * seasonal_occasion objective, else `general` — never invents a category
 * nothing in the request actually supports.
 */
export function classifyOccasionCategory({ occasionTitle = "", requestText = "", objective = null, isSympathy = false } = {}) {
  if (isSympathy) return "sympathy";
  if (objective === "operational") return "operational_notice";
  const haystack = `${occasionTitle} ${requestText}`;
  for (const rule of OCCASION_KEYWORD_RULES) {
    if (rule.re.test(haystack)) return rule.category;
  }
  if (objective === "seasonal_occasion") return "holiday_seasonal";
  return "general";
}

const SUBJECT_CLASS_RULES = [
  { subjectClass: "mascot_or_character", re: /\b(mascot|cartoon character|costume character)\b/i },
  { subjectClass: "people_or_lifestyle", re: /\b(bride|groom|couple|customer|family|model|person|people)\b/i },
  { subjectClass: "storefront_or_location", re: /\b(storefront|shop front|store exterior|building exterior|shop interior)\b/i }
];

/**
 * Batch 4, Part A: primarySubjectClass — a coarse class over the free-
 * prose `primarySubject` (creative_brief.primary_subject / visual_brief).
 * Defaults to "floral_arrangement" — the overwhelming common case, and
 * consistent with this codebase's own "no independent flower choice"
 * rule (a subject is always some real flowers/arrangement unless the
 * request explicitly named something else, like a mascot).
 */
export function classifyPrimarySubjectClass(primarySubject) {
  const text = String(primarySubject || "");
  for (const rule of SUBJECT_CLASS_RULES) {
    if (rule.re.test(text)) return rule.subjectClass;
  }
  return text ? "floral_arrangement" : "other";
}

/**
 * Batch 4, Part A: captionIntent — the caption's rhetorical purpose.
 * Sympathy always wins (the same real, live-found requirement Batch 1's
 * own sympathy-writing-rules gate protects); otherwise a direct,
 * deterministic mapping off the SAME objective the caption was actually
 * written for — never a second, independently-derived classification.
 */
export function classifyCaptionIntent({ objective = null, isSympathy = false } = {}) {
  if (isSympathy) return "sympathetic";
  switch (objective) {
    case "operational":
      return "operational_notice";
    case "promotion":
      return "promotional";
    case "seasonal_occasion":
      return "celebratory";
    case "retention":
      return "awareness_soft_sell";
    case "awareness":
    default:
      return "informational";
  }
}

const CTA_INTENT_RULES = [
  { intent: "call_shop", re: /\bcall\b/i },
  { intent: "order_now", re: /\border\b|\bshop now\b|\bbuy\b/i },
  { intent: "visit_shop", re: /\bvisit\b|\bstop by\b|\bcome (?:in|by|see)\b/i },
  { intent: "learn_more", re: /\blearn more\b|\bdetails\b|\bfind out\b/i }
];

/** Batch 4, Part A: ctaIntent — deterministic keyword classification of
 * the actual CTA text this post carries. "none" only when there is
 * genuinely no CTA text to classify. */
export function classifyCtaIntent(ctaText) {
  const text = String(ctaText || "").trim();
  if (!text) return "none";
  for (const rule of CTA_INTENT_RULES) {
    if (rule.re.test(text)) return rule.intent;
  }
  return "contact_general";
}

// ---------------------------------------------------------------------------
// Batch 6 ("Premium Creative quality architecture") — namedCampaign,
// audience, creativeMode, copyVoice. Every one of these reuses the SAME
// already-computed occasionCategory/sympathy/promotion signals — never a
// second, independently-derived business-fact inference, matching this
// module's own standing rule (see file header).
// ---------------------------------------------------------------------------

export const NAMED_CAMPAIGNS = Object.freeze([
  "valentines_day",
  "mothers_day",
  "christmas",
  "admin_professionals_day",
  "girlfriends_day",
  "homecoming",
  "prom",
  "school_dance",
  "graduation",
  "wedding",
  "birthday",
  "anniversary",
  "new_baby",
  "get_well",
  "sympathy",
  "none"
]);

/**
 * Batch 6, Part 1: the FINE-GRAINED campaign identity underneath the
 * coarse occasionCategory bucket — e.g. occasionCategory "holiday_
 * seasonal" might be Valentine's, Mother's Day, Christmas, Admin
 * Professionals Day, or Girlfriends Day; occasionCategory "event_
 * reminder" might be Homecoming, Prom, or a school dance. Reuses
 * occasionCategory's own already-computed value rather than re-running a
 * second, competing keyword pass for the categories it already resolves
 * unambiguously (birthday/anniversary/wedding_event/graduation/new_baby/
 * get_well/sympathy) — only the two ambiguous buckets get a real second
 * look, using the exact same rule arrays occasionCategory itself used.
 */
export function classifyNamedCampaign({ occasionTitle = "", requestText = "", isSympathy = false, occasionCategory = null } = {}) {
  if (isSympathy || occasionCategory === "sympathy") return "sympathy";
  const DIRECT_MAP = {
    birthday: "birthday",
    anniversary: "anniversary",
    wedding_event: "wedding",
    graduation: "graduation",
    new_baby: "new_baby",
    get_well: "get_well"
  };
  if (occasionCategory && DIRECT_MAP[occasionCategory]) return DIRECT_MAP[occasionCategory];
  const haystack = `${occasionTitle} ${requestText}`;
  if (occasionCategory === "event_reminder") {
    for (const rule of EVENT_REMINDER_RULES) {
      if (rule.re.test(haystack)) return rule.campaign;
    }
  }
  if (occasionCategory === "holiday_seasonal") {
    for (const rule of NAMED_HOLIDAY_RULES) {
      if (rule.re.test(haystack)) return rule.campaign;
    }
  }
  return "none";
}

export const AUDIENCES = Object.freeze([
  "students",
  "parents",
  "students_and_parents",
  "brides",
  "wedding_clients",
  "funeral_families",
  "corporate_offices",
  "business_clients",
  "romantic_partners",
  "self_purchase",
  "gift_buyers",
  "general_local_customers",
  "existing_customers",
  "unknown_general"
]);

// Ordered most-specific-first — the first real match wins, so a request
// naming both "students and parents" resolves to the combined audience
// rather than just "students" (whichever rule happened to run first).
const AUDIENCE_RULES = [
  { audience: "students_and_parents", re: /\bstudents?\b[\s\S]*\bparents?\b|\bparents?\b[\s\S]*\bstudents?\b/i },
  { audience: "students", re: /\bstudents?\b/i },
  { audience: "parents", re: /\bparents?\b/i },
  { audience: "brides", re: /\bbrides?\b/i },
  { audience: "wedding_clients", re: /\bweddings?\b|\bbridal\b|\bengagement\b/i },
  { audience: "corporate_offices", re: /\bcorporate\b|\boffices?\b|\bworkplace\b/i },
  { audience: "self_purchase", re: /\bbuy(?:ing)? (?:yourself|myself)\b|\btreat (?:yourself|myself)\b|\bfor (?:yourself|myself)\b|\bself[- ]care\b/i },
  { audience: "romantic_partners", re: /\bgirlfriends?\b|\bboyfriends?\b|\bpartners?\b|\bspouse\b|\bwife\b|\bhusband\b|\bromantic\b/i },
  { audience: "gift_buyers", re: /\bgifts?\b|\bsurprise (?:her|him|them|someone)\b|\bfor (?:her|him|them)\b/i },
  { audience: "existing_customers", re: /\bexisting customers?\b|\breturning customers?\b|\bloyal customers?\b/i }
];

/**
 * Batch 6, Part 2: a deterministic, kept-as-a-plain-enum audience field
 * (a structured value + optional free descriptor was considered — see
 * this module's real usage pattern: every other canonicalConcept field
 * is a plain enum, and this batch's scope doesn't yet need more than
 * that; a future batch can add a descriptor without breaking this one).
 * Sympathy always resolves to funeral_families regardless of any other
 * text signal — the same "sympathy wins first" precedence occasionCategory
 * itself already uses. Falls back to general_local_customers — never an
 * invented specific audience nothing in the request actually supports.
 */
export function classifyAudience({ requestText = "", occasionTitle = "", isSympathy = false, occasionCategory = null } = {}) {
  if (isSympathy || occasionCategory === "sympathy") return "funeral_families";
  const haystack = `${occasionTitle} ${requestText}`;
  for (const rule of AUDIENCE_RULES) {
    if (rule.re.test(haystack)) return rule.audience;
  }
  return "general_local_customers";
}

// ---------------------------------------------------------------------------
// Test C ("everyday social creative architecture fix") — messageIntent and
// userTemporalIntent. Real, live-found gap the Test C forensic trace
// proved: "Create a Facebook post encouraging people to send flowers
// today" classified correctly (occasionCategory "general", creativeMode
// "everyday_floral") but had NO compact representation of the actual
// message being communicated, so once the AI-generated copy failed
// quality evaluation, the deterministic rescue had nothing to compose
// from beyond the fully generic, occasion-blind fallback — and the
// separate "today" framing was silently dropped along with it. Neither
// field is a new occasion category (occasionCategory stays "general";
// this is deliberately NOT solved with a fake "general_today" occasion,
// per Ashley's own explicit instruction) and neither is a hardcoded
// sentence list — both are narrow, deterministic, reused-signal
// classifications exactly like every other field in this module.
// ---------------------------------------------------------------------------

export const MESSAGE_INTENTS = Object.freeze(["send_flowers", "self_purchase", "brighten_day", "general_everyday"]);

// Deliberately narrow, real phrasings only — never a broad "any gift word"
// classifier. "send"/"flowers" within a short window of each other (either
// order) covers "send flowers today," "send someone flowers," "flowers you
// can send," etc.; "gift(ing) ... flowers" covers the equivalent phrasing
// with "gift" instead of "send."
const SEND_FLOWERS_INTENT_RE = /\bsend(?:ing)?\b[\s\S]{0,30}\bflowers?\b|\bflowers?\b[\s\S]{0,30}\bsend(?:ing)?\b|\bgift(?:ing)?\s+(?:someone\s+|them\s+|her\s+|him\s+)?flowers?\b/i;

// Only recognizes the FLORIST'S OWN request explicitly framing the post
// around brightening someone's day — this is an INPUT signal, never
// license for the rescue layer to invent this phrase as generic filler
// when the florist never said it (see MESSAGE_INTENT_PHRASES,
// marketing-content-revision.js, which only ever echoes this back when
// this exact intent was actually classified from the request).
const BRIGHTEN_DAY_INTENT_RE = /\bbrighten(?:s|ing)?\s+(?:someone'?s?|somebody'?s?|their|her|his|your)\s+day\b/i;

/**
 * Test C batch, Part 2: a compact canonical representation of the
 * ordinary MESSAGE a request communicates — deliberately independent of
 * occasionCategory (which stays "general" for all of these). Reuses the
 * existing audience classification for self_purchase (never a second,
 * competing "buying for yourself" detector) and checked FIRST, matching
 * this codebase's established self-purchase precedence elsewhere.
 * general_everyday is the honest fallback when no narrower signal
 * actually appears in the request — never invented, never forced.
 */
export function classifyMessageIntent({ requestText = "", audience = null, isSympathy = false, occasionCategory = null } = {}) {
  // Independent-review fix: a genuine sympathy request ("send flowers to
  // the Johnson family for their mother's funeral") matched
  // SEND_FLOWERS_INTENT_RE just as readily as an ordinary gifting post,
  // classifying "send_flowers" and carrying MESSAGE_INTENT_COPY_
  // GUIDANCE's send_flowers coaching (friend/partner/surprise framing)
  // into the same copy-generation prompt as the sympathy writing rules —
  // real, demonstrated, incongruous coaching for a delicate occasion, the
  // same class of gap self_purchase's own precedence below already
  // avoids for a different audience. Checked first, exactly like
  // sympathy's precedence everywhere else in this module — sympathy work
  // has its own complete, dedicated copy-voice/writing rules elsewhere
  // and needs no separate messageIntent coaching layered on top of them.
  if (isSympathy || occasionCategory === "sympathy") return "general_everyday";
  if (audience === "self_purchase") return "self_purchase";
  if (SEND_FLOWERS_INTENT_RE.test(requestText)) return "send_flowers";
  if (BRIGHTEN_DAY_INTENT_RE.test(requestText)) return "brighten_day";
  return "general_everyday";
}

// ---------------------------------------------------------------------------
// Test D ("promotion fact-integrity", 2026-09-14): a FIRST-CLASS promotion
// contract. The live failure: "Create a cute Facebook post for 20% off
// bouquets this weekend." came back with an invented coupon code
// (BLOOM20), an invented "at checkout" redemption and an invented "order
// online" channel — none supplied — and every generic fact-safety detector
// passed it, because none of them models a promotion's commercial terms.
//
// This classifier derives the contract ONLY from the florist's own request
// (plus, optionally, TRUSTED shop capabilities a caller passes in — never
// guessed). Everything not supplied is null/empty, and null means "do not
// invent": generation coaching, the evaluator, and the deterministic
// rescue all read this same object. Pure. Never shop-specific.
// ---------------------------------------------------------------------------
export const PROMOTION_FACTS_VERSION = 1;

const PROMO_PERCENT_RE = /\b(\d{1,3})\s?(?:%|percent)\s*off\b/i;
const PROMO_AMOUNT_RE = /\$\s?(\d+(?:\.\d{2})?)\s*off\b/i;
const PROMO_BOGO_RE = /\b(?:bogo|buy\s+one,?\s+get\s+one(?:\s+free)?|b1g1|two\s+for\s+(?:one|1)|2\s+for\s+1)\b/i;
// Case-sensitive on purpose: a real code is written in caps ("BLOOM20"),
// and a lowercase "code" in prose ("a code word") must never become one.
// A supplied code as the florist typed it (any case, hyphens allowed) —
// but only a token that looks like a code: it carries a digit, or it is
// written in caps. Prose after the word "code" ("our code word is
// kindness") never becomes one.
const PROMO_CODE_RE = /\b(?:[Pp]romo\s*[Cc]ode|[Cc]oupon\s*[Cc]ode|[Dd]iscount\s*[Cc]ode|[Cc]ode|CODE|[Cc]oupon|COUPON)\s*[:#]?\s*(?=[A-Za-z0-9-]*\d|[A-Z0-9-]{3,}\b)([A-Za-z][A-Za-z0-9-]{2,19})\b/;
const DAY_RE_SRC = "(?:mon|tues|wednes|thurs|fri|satur|sun)day(?:\\s+\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?)?";
const PROMO_TIMING_RE = new RegExp(
  "\\b(" +
    [
      // Ranges first (longest match wins): "Friday 9/19 through Sunday 9/21", "Saturday and Sunday".
      `(?:this\\s+|next\\s+)?${DAY_RE_SRC}\\s*(?:through|thru|to|-|–|&|and)\\s*(?:this\\s+|next\\s+)?${DAY_RE_SRC}`,
      `(?:through|thru|until|till)\\s+(?:the\\s+)?(?:end\\s+of\\s+(?:the\\s+)?(?:month|week|year|weekend|season)|weekend|month|week|tomorrow|tonight|${DAY_RE_SRC}|(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?|[a-z]+(?:'s)?\\s+day)`,
      "this\\s+weekend", "this\\s+week", "today", "tonight", "tomorrow",
      `(?:this|next)\\s+${DAY_RE_SRC}`,
      `${DAY_RE_SRC}(?:\\s+only)?`,
      "all\\s+(?:week|month|weekend)(?:\\s+long)?",
      "\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?(?!\\s*(?:dozen|off|price|%|-))"
    ].join("|") +
    ")\\b",
  "i"
);
const PRODUCT_STOP = "this|today|tonight|tomorrow|through|thru|until|till|on|at|for|with|when|in|online|over|under|above|only|next|all|instead|now|again|too|please|to|if|who|anyone|everyone|you|your|that|which|per|from|by|during|while|because|so|but|as|starting|storewide|sitewide|(?:mon|tues|wednes|thurs|fri|satur|sun)days?|weekends?|—|-";
const PROMO_PRODUCT_RE = new RegExp(
  `\\boff\\s+(?:on\\s+)?(?:all\\s+|any\\s+|every\\s+|our\\s+|select\\s+)?(?!(?:${PRODUCT_STOP})\\b)([a-z][a-z' &-]{1,40}?)(?=\\s+(?:${PRODUCT_STOP})\\b|[.!?,;:]|\\s*$)`,
  "i"
);
// "buy one get one free on bouquets" — a BOGO names its product after "on".
const PROMO_PRODUCT_BOGO_RE = new RegExp(
  `\\b(?:bogo|buy\\s+one,?\\s+get\\s+one(?:\\s+free)?|b1g1|two\\s+for\\s+(?:one|1))\\s+(?:on\\s+)?(?:all\\s+|any\\s+|every\\s+|our\\s+|select\\s+)?(?!(?:${PRODUCT_STOP})\\b)([a-z][a-z' &-]{1,40}?)(?=\\s+(?:${PRODUCT_STOP})\\b|[.!?,;:]|\\s*$)`,
  "i"
);
// "bouquets are 20% off this weekend" — the product comes BEFORE the offer.
const PROMO_PRODUCT_BEFORE_RE = /\b(?:all\s+|any\s+|every\s+|our\s+)?([a-z][a-z' &-]{1,40}?)\s+(?:are|is)\s+(?:now\s+)?\d{1,3}\s?%\s*off\b/i;
const PROMO_CHANNEL_RULES = Object.freeze([
  { re: /\b(?:order|shop|buy|redeem|book)\s+online\b|\bonline\s+(?:orders?|ordering|only|store|shop|checkout)\b|\bon\s+our\s+(?:site|website|app)\b|\bour\s+(?:website|app)\b|\bvia\s+(?:our\s+|the\s+)?app\b|\blink\s+in\s+(?:our\s+)?bio\b|\bthrough\s+(?:instagram|facebook|dms?|messenger|our\s+page)\b|\bdm\s+us\b|https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|shop|co|us|florist)\b/i, channel: "online" },
  { re: /\bin[- ]store\b|\bin\s+the\s+shop\b|\bstop\s+by\b|\bwalk[- ]ins?\b/i, channel: "in_store" },
  { re: /\bcall\s+(?:us|the\s+shop)\b|\bby\s+phone\b|\bphone\s+orders?\b/i, channel: "phone" }
]);
const PROMO_RESTRICTION_RE =
  /\b(?:exclud\w+[^.,;]*|minimum\s+(?:purchase|order|spend)[^.,;]*|while\s+supplies\s+last|while\s+stocks?\s+last|limited\s+(?:quantit\w+|time|stock)|in[- ]store\s+only|online\s+only|one\s+per\s+customer|cannot\s+be\s+combined[^.,;]*|not\s+valid[^.,;]*|some\s+exclusions\s+apply|terms\s+apply|select\s+(?:items|styles|bouquets)|regular[- ]priced?\s+items?|free\s+(?:delivery|shipping))\b/gi;

/**
 * The promotion contract for a request, or null when the request is not a
 * real promotion at all. Only what the florist SUPPLIED (or a caller's
 * trusted, verified capability) is ever non-null.
 *
 * Shape: { version, discount: { type: "percent"|"amount"|"bogo", value,
 * text } | null, product, timing, promoCode, redemptionChannel,
 * restrictions: string[] }.
 */
export function classifyPromotionFacts({ requestText = "", promotionIntent = null, verifiedCapabilities = null } = {}) {
  // Worded discounts ("twenty percent off", "half off", "save $5") are
  // normalized to digits first, so the contract carries the real value.
  const request = normalizeDiscountWording(String(requestText || ""));
  const isPromotion = promotionIntent != null ? promotionIntent === "real_promotion" : requestSignalsRealPromotion(request);
  if (!isPromotion) return null;

  let discount = null;
  const pct = request.match(PROMO_PERCENT_RE);
  const amt = request.match(PROMO_AMOUNT_RE);
  const bogo = request.match(PROMO_BOGO_RE);
  if (pct) discount = { type: "percent", value: pct[1], text: `${pct[1]}% off` };
  else if (amt) discount = { type: "amount", value: amt[1], text: `$${amt[1]} off` };
  else if (bogo) discount = { type: "bogo", value: null, text: bogo[0].toLowerCase() };

  const productMatch = request.match(PROMO_PRODUCT_RE) || request.match(PROMO_PRODUCT_BEFORE_RE) || request.match(PROMO_PRODUCT_BOGO_RE);
  const product = productMatch ? productMatch[1].trim().toLowerCase() : null;
  const discountIndex = pct ? pct.index : amt ? amt.index : bogo ? bogo.index : -1;
  const afterDiscount = discountIndex >= 0 ? request.slice(discountIndex) : "";
  const timingMatch = afterDiscount.match(PROMO_TIMING_RE) || request.match(PROMO_TIMING_RE);
  const timing = timingMatch ? timingMatch[1].replace(/\s+/g, " ").toLowerCase() : null;
  // A dollar condition the florist stated ("any bouquet over $40") is a
  // supplied restriction, never lost.
  const overMatch = request.match(/\b(?:orders?\s+)?(?:over|above|of)\s+\$\s?\d+(?:\.\d{2})?\b/i);
  const codeMatch = request.match(PROMO_CODE_RE);
  const promoCode = codeMatch ? codeMatch[1] : null;

  let redemptionChannel = null;
  for (const rule of PROMO_CHANNEL_RULES) {
    if (rule.re.test(request)) { redemptionChannel = rule.channel; break; }
  }
  // A trusted capability (never the model's guess, never the request's
  // own wording) may establish an online channel — the only way "order
  // online" ever becomes legal without the florist saying it.
  if (!redemptionChannel && verifiedCapabilities?.onlineOrdering === true) redemptionChannel = "online";

  const restrictions = [];
  for (const m of request.matchAll(PROMO_RESTRICTION_RE)) {
    const phrase = m[0].trim().replace(/\s+/g, " ");
    if (phrase && !restrictions.includes(phrase)) restrictions.push(phrase);
  }
  if (overMatch && !restrictions.some((r) => r.toLowerCase().includes(overMatch[0].toLowerCase()))) restrictions.push(overMatch[0].trim());

  return { version: PROMOTION_FACTS_VERSION, discount, product, timing, promoCode, redemptionChannel, restrictions };
}

export const USER_TEMPORAL_INTENTS = Object.freeze(["today", "tonight", "tomorrow", "this_weekend"]);

const USER_TEMPORAL_INTENT_RULES = [
  { value: "today", re: /\btoday\b/i },
  { value: "tonight", re: /\btonight\b/i },
  { value: "tomorrow", re: /\btomorrow\b/i },
  { value: "this_weekend", re: /\bthis\s+weekend\b/i }
];

/**
 * Test C batch, Part 3: a safe, narrow signal meaning ONLY "the florist's
 * own request explicitly framed this copy around a given day word" — it
 * must never be read to imply availability, same-day delivery, inventory,
 * an order cutoff, or a guaranteed delivery window on that day (those
 * remain governed entirely by the existing, unmodified
 * detectUnverifiedServiceAvailabilityClaim / detectInventedTemporalClaim
 * detectors — this field is never itself a safety check).
 *
 * Deliberately mutually exclusive with hasMaterialTimingCommitment (the
 * same detector deriveFactRequirements already uses): when the request
 * carries a genuine business-timing COMMITMENT ("we close at 2 PM
 * today"), that is a completely different, already-correctly-handled
 * case (factRequirements "event_date," routed to exact_layout) — this
 * field stays null so rescue/copy composition never mistakes a real
 * business commitment for casual day-framing.
 */
export function classifyUserTemporalIntent({ requestText = "" } = {}) {
  if (hasMaterialTimingCommitment(requestText)) return null;
  for (const rule of USER_TEMPORAL_INTENT_RULES) {
    if (rule.re.test(requestText)) return rule.value;
  }
  return null;
}

export const CREATIVE_MODES = Object.freeze([
  "campaign_poster",
  "photo_forward_social",
  "editorial_brand",
  "sympathy_elegance",
  "promotional_sales",
  "playful_promotion",
  "operational_notice",
  "everyday_floral",
  // Personal-occasion concept-preservation batch: the structural fix for
  // the Birthday acceptance-test defect. A well-classified, common
  // personal-celebration occasion (see PERSONAL_CELEBRATION_OCCASIONS
  // below) was previously invisible to classifyCreativeMode entirely and
  // fell through to the SAME "everyday_floral" bucket as a request with no
  // occasion at all — flattening real occasion identity before it ever
  // reached copy tone, visual direction, or rescue. This mode exists so
  // that identity survives.
  "personal_celebration"
]);

// Personal-occasion concept-preservation batch, Part 2: the bounded set of
// OCCASION_CATEGORIES values classifyCreativeMode below gives their own
// dedicated, occasion-aware treatment rather than the generic
// "everyday_floral" fallthrough. Deliberately narrow and reused verbatim
// (never re-derived) by classifyCopyVoice and by buildDeterministicCreative
// RescueContent's own occasion table (marketing-content-revision.js) — one
// real source of truth for which occasions this batch actually covers.
// "congratulations" has no OCCASION_CATEGORIES entry to reuse (Ashley's own
// instruction: never invent a category name that doesn't already exist in
// the canonical schema), so it is not included here.
export const PERSONAL_CELEBRATION_OCCASIONS = Object.freeze(["birthday", "anniversary", "new_baby", "get_well"]);

// Shared across classifyCreativeMode and classifyCopyVoice — a request
// signaling humor/urgency/conversational tone (Ashley's own "last chance
// to order Homecoming flowers!" example) can carry BOTH a campaign_poster
// STRUCTURE and a playful VOICE at once; these two classifiers deliberately
// never have to choose one or the other because structure and tone are
// resolved independently from the same underlying signal.
const PLAYFUL_SIGNAL_RE = /\bfunny\b|\bhumor(?:ous)?\b|\bjoke\b|\bplayful\b|\bconversational\b|\blast chance\b|\bdon'?t miss\b|\bhurry\b|\bforgot\b|\bsave the day\b/i;
const ELEGANT_SIGNAL_RE = /\belegant\b|\bboutique\b|\bpremium\b|\bluxury\b|\beditorial\b|\bsophisticated\b/i;
const PHOTO_FORWARD_SIGNAL_RE = /\bcute post\b|\bbuy(?:ing)? (?:yourself|myself)\b|\btreat (?:yourself|myself)\b|\blifestyle\b|\bjust a (?:photo|picture)\b|\bsimple post\b|\bcasual\b|\bno (?:on-image )?text\b|\bminimal text\b/i;

/**
 * Batch 6, Part 3: the CENTRAL architectural fix the audit named — a
 * higher-level creative-MODE decision that (unlike the old occasion-
 * category-only path) can actually change STRUCTURE, not just append a
 * sentence to the same everyday layout. Deliberately layered ON TOP of
 * occasionCategory/namedCampaign/promotionIntent/sympathy — never a
 * second, competing classification of the same underlying signals.
 * Sympathy and operational notices keep their existing, non-negotiable
 * precedence (checked first, unconditionally). A "major campaign" (any
 * named holiday, event reminder, or graduation) always resolves to
 * campaign_poster regardless of tone signals — creativeMode owns
 * STRUCTURE; classifyCopyVoice (below) owns TONE, independently.
 */
export function classifyCreativeMode({
  occasionCategory = null,
  namedCampaign = null,
  sympathyClassification = null,
  promotionIntent = null,
  requestText = ""
} = {}) {
  if (sympathyClassification === "sympathy" || occasionCategory === "sympathy") return "sympathy_elegance";
  if (occasionCategory === "operational_notice") return "operational_notice";
  const isMajorCampaign = occasionCategory === "event_reminder" || occasionCategory === "holiday_seasonal" || namedCampaign === "graduation";
  if (isMajorCampaign) return "campaign_poster";
  const isPlayful = PLAYFUL_SIGNAL_RE.test(requestText);
  if (promotionIntent === "real_promotion") return isPlayful ? "playful_promotion" : "promotional_sales";
  if (namedCampaign === "wedding" || ELEGANT_SIGNAL_RE.test(requestText)) return "editorial_brand";
  // Personal-occasion concept-preservation batch, Part 2: a well-
  // classified personal-celebration occasion (birthday/anniversary/
  // new_baby/get_well) gets its own structural mode rather than silently
  // collapsing into "everyday_floral" — the real, proven Birthday
  // acceptance-test defect. Checked ahead of the text-only signals below
  // (PHOTO_FORWARD_SIGNAL_RE/isPlayful) because occasionCategory is a
  // structured, already-classified signal and should win over an
  // incidental phrase match — but still after sympathy/operational/major-
  // campaign/promotion/wedding, none of which this ever overrides.
  if (PERSONAL_CELEBRATION_OCCASIONS.includes(occasionCategory)) return "personal_celebration";
  if (PHOTO_FORWARD_SIGNAL_RE.test(requestText)) return "photo_forward_social";
  if (isPlayful) return "playful_promotion";
  return "everyday_floral";
}

export const COPY_VOICES = Object.freeze([
  "professional",
  "warm",
  "compassionate",
  "elegant",
  "celebratory",
  "playful",
  "humorous",
  "conversational",
  "urgent",
  "romantic",
  "community_friendly",
  "informational"
]);

/**
 * Batch 6, Part 5: the tone decision the copy-generation prompt
 * (buildFlyerContentTask, ai-creative-engine.js) is now wired to read —
 * see that module for exactly how. Multiple attributes may coexist
 * (Ashley's own explicit requirement); never a single forced value.
 * Sympathy is non-negotiable and always wins, matching every other
 * sympathy precedence rule already in this codebase.
 */
export function classifyCopyVoice({
  creativeMode = null,
  namedCampaign = null,
  occasionCategory = null,
  sympathyClassification = null,
  factRequirements = [],
  requestText = ""
} = {}) {
  if (sympathyClassification === "sympathy" || occasionCategory === "sympathy") return ["compassionate", "elegant"];
  if (creativeMode === "operational_notice") return ["informational"];

  const voices = new Set();
  const isUrgentDeadline = Array.isArray(factRequirements) && factRequirements.includes("event_date");
  const playfulSignal = PLAYFUL_SIGNAL_RE.test(requestText);

  if (namedCampaign === "valentines_day") voices.add("romantic");
  if (["mothers_day", "girlfriends_day", "christmas"].includes(namedCampaign)) {
    voices.add("celebratory");
    voices.add("warm");
  }
  if (namedCampaign === "admin_professionals_day") {
    voices.add("professional");
    voices.add("warm");
    voices.add("community_friendly");
  }
  if (creativeMode === "campaign_poster") {
    voices.add("celebratory");
    if (isUrgentDeadline) voices.add("urgent");
  }
  if (creativeMode === "playful_promotion" || playfulSignal) {
    voices.add("playful");
    voices.add("conversational");
    voices.add("urgent");
    if (/\bfunny\b|\bhumor(?:ous)?\b|\bjoke\b/i.test(requestText)) voices.add("humorous");
  }
  if (creativeMode === "editorial_brand") voices.add("elegant");
  // Personal-occasion concept-preservation batch, Part 2/4: the SAME real
  // gap this batch's other fixes close — a birthday/anniversary/new_baby/
  // get_well post previously earned no tone signal at all beyond the flat
  // professional+warm default every unmatched request gets, which is
  // exactly why the model's own generated copy had nothing celebratory (or
  // gentle, for get_well) to work with. get_well is deliberately NOT
  // "celebratory" — a caring, compassionate tone fits a recovery far
  // better than an upbeat one, the same real distinction sympathy already
  // makes elsewhere in this function. "fun" is checked directly (not
  // folded into the shared PLAYFUL_SIGNAL_RE, which also drives OTHER
  // creativeModes' fallback selection above) — Ashley's own explicit
  // requirement that a "fun Facebook post" birthday request be compatible
  // with a playful tone, scoped narrowly to this one branch.
  if (creativeMode === "personal_celebration") {
    voices.add("warm");
    if (namedCampaign === "get_well") {
      voices.add("compassionate");
    } else {
      voices.add("celebratory");
    }
    if (namedCampaign === "anniversary") voices.add("romantic");
    if (namedCampaign === "birthday" && (playfulSignal || /\bfun\b/i.test(requestText))) voices.add("playful");
  }
  // Live-found defect fix: a casual, photo-forward social post (e.g. "a
  // cute post about buying yourself flowers") was falling through to the
  // generic professional+warm default below — the same flat, business-
  // brochure voice every unmatched request gets, with nothing casual or
  // social about it. Generalized to the creativeMode itself (not one
  // audience value) so it applies to any photo_forward_social request,
  // reusing existing COPY_VOICES values only — never a new voice.
  if (creativeMode === "photo_forward_social") {
    voices.add("warm");
    voices.add("conversational");
  }
  if (!voices.size) {
    voices.add("professional");
    voices.add("warm");
  }
  return [...voices];
}

/** Batch 4, Part K: assetRoute — the concrete photo-sourcing route,
 * derived directly from the SAME existing fields generate_content already
 * computes (photo_choice/photo_strategy/style_tier/userUploadedPhoto/
 * reusedFromAssetId) — never a second, independently-derived label that
 * could disagree with what the asset itself actually records. */
export function deriveAssetRoute({ contentType = null, photoStrategy = null, styleTier = null, userUploadedPhoto = false, reusedFromAssetId = null } = {}) {
  if (contentType === "reel" || contentType === "short_video" || contentType === "long_video") return "video_concept";
  if (reusedFromAssetId) return "prior_real_photo";
  if (userUploadedPhoto) return "real_shop_photo";
  if (styleTier === "template") return "deterministic_template";
  if (photoStrategy === "subject_forward" && styleTier === "generated") return "ai_generated_photo";
  if (photoStrategy === "calm_backdrop" && styleTier === "generated") return "flyer_background";
  if (styleTier === "generated") return "ai_generated_photo";
  return "none";
}

/** Batch 4, Part A: creativeFamily — a direct, structural mapping off the
 * asset/content type this post already is, never a second guess at it. */
export function deriveCreativeFamily({ assetType = null, contentType = null } = {}) {
  if (assetType === "flyer") return "designed_flyer";
  if (assetType === "video_concept" || contentType === "reel" || contentType === "short_video" || contentType === "long_video") return "video_concept";
  if (assetType === "image") return "plain_photo_post";
  return "text_only";
}

const FACT_SIGNAL_RULES = [
  { key: "phone_number", re: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
  { key: "shop_hours", re: /\bhours?\b|\bopen(?:ing)?\b|\bclos(?:e|ed|ing)\b/i },
  { key: "delivery_service", re: /\bdeliver(?:y|ies|ing)?\b/i }
];

// A bare time-of-day/weekday/relative-day mention or calendar date, on
// its own, is NOT evidence of a material date/time commitment — "Create
// today's Facebook post" merely names WHEN the post itself is being
// made, not a fact about the business. Real detection requires this
// expression to co-occur, in the SAME SENTENCE (see
// hasMaterialTimingCommitment below), with a genuine commitment word.
const DATE_OR_TIME_EXPRESSION_RE =
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\btoday\b|\btomorrow\b|\bthis (?:weekend|week)\b|\bnext (?:weekend|week)\b|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/i;

// Words that mean a nearby date/time expression is making a real
// business commitment (an event, a closing/opening/reopening, a sale
// window, a class, a deadline, an appointment, an order/delivery cutoff)
// rather than just naming when the content is being posted. Deliberately
// broad enough to cover florist-relevant scheduling language without
// matching ordinary creative/CTA verbs ("create," "post," "write,"
// "share") that carry no timing commitment of their own.
const MATERIAL_TIMING_COMMITMENT_RE =
  /\b(?:clos(?:e|es|ed|ing)|open(?:s|ed|ing)?|reopen(?:s|ed|ing)?|end(?:s|ed|ing)?|start(?:s|ed|ing)?|deadline|due|class(?:es)?|event|sale|promo(?:tion)?|workshop|pop-?up|appointment|ceremony|rsvp|regist(?:er|ered|ering)|hours?|deliver(?:y|ies|ing)?|order(?:s|ed|ing)?|plac(?:e|ed|ing)|reserv(?:e|ed|ation)|held|scheduled)\b/i;

/**
 * True when SOME sentence in `text` carries both a date/time expression
 * and a material-timing-commitment word — sentence-scoped (reusing
 * sentencesOf(), the same split marketing-content-revision.js's own
 * fact-safety checks already use — never a duplicate parser) so an
 * unrelated CTA sentence elsewhere in the same haystack (e.g. "Call
 * 606-506-4039 to place an order.") can never combine with a wholly
 * separate sentence's own incidental "today" to manufacture a false
 * commitment.
 */
function hasMaterialTimingCommitment(text) {
  return sentencesOf(text).some((sentence) => DATE_OR_TIME_EXPRESSION_RE.test(sentence) && MATERIAL_TIMING_COMMITMENT_RE.test(sentence));
}

/**
 * Batch 4, Part J: factRequirements — which REAL shop facts this concept
 * depends on staying verified through any revision. Deliberately never
 * includes AI scene details (visual_brief/creative_brief prose remains
 * creative fiction, not a shop fact this list tracks) — only the same
 * categories of real, checkable claims Batch 1's own evaluator already
 * polices (a phone number, a promotion, real inventory, a material
 * date/time commitment, shop hours, a delivery/service claim).
 *
 * Batch 3 staging-acceptance fix (authoritative root-cause fix, not a
 * router-level workaround — see marketing-engine-router.js's own
 * BUSINESS_CRITICAL_FACT_KEYS comment): `event_date` used to fire off a
 * bare `\btoday\b`/`\btomorrow\b`/weekday match anywhere in the
 * request/CTA/body — real staging failure: "Create today's Facebook post
 * for Lilies in Bloom." (ordinary, non-operational creative) was marked
 * as requiring an event_date fact purely because of the word "today's,"
 * which forced Premium AI Creative routing closed even though nothing
 * about the business's own date/time state was actually being claimed.
 * See hasMaterialTimingCommitment() above for the real semantics now
 * required: a date/time expression AND a genuine commitment word, in the
 * same sentence.
 */
export function deriveFactRequirements({ requestText = "", ctaText = "", bodyText = "", objective = null, invGroundedCount = 0 } = {}) {
  const keys = new Set();
  const haystack = `${requestText} ${ctaText} ${bodyText}`;
  for (const rule of FACT_SIGNAL_RULES) {
    if (rule.re.test(haystack)) keys.add(rule.key);
  }
  if (hasMaterialTimingCommitment(requestText) || hasMaterialTimingCommitment(ctaText) || hasMaterialTimingCommitment(bodyText)) {
    keys.add("event_date");
  }
  if (objective === "promotion") keys.add("promotion");
  if (invGroundedCount > 0) keys.add("inventory_grounding");
  return [...keys];
}

/**
 * Batch 4, Part A/C: builds one normalized canonical concept from real
 * generation-time signals. Every field is derived from an existing,
 * already-computed value or an existing detector — never a second AI
 * call, never a duplicate objective/category system.
 */
export function buildCanonicalConcept({
  requestText = "",
  occasionTitle = "",
  platform = null,
  contentType = null,
  assetType = null,
  objective = null,
  primarySubject = null,
  ctaText = null,
  bodyText = "",
  isSympathy = false,
  promotionSignaled = null,
  inventoryIntentSignaled = null,
  creativeBrief = null,
  photoStrategy = null,
  styleTier = null,
  userUploadedPhoto = false,
  reusedFromAssetId = null,
  invGroundedCount = 0
} = {}) {
  const sympathy = Boolean(isSympathy);
  const promotion = promotionSignaled != null ? Boolean(promotionSignaled) : requestSignalsRealPromotion(requestText);
  const inventoryDriven = inventoryIntentSignaled != null ? Boolean(inventoryIntentSignaled) : requestSignalsIntentionalInventoryUse(requestText);
  const occasionCategory = classifyOccasionCategory({ occasionTitle, requestText, objective, isSympathy: sympathy });
  const primarySubjectClass = classifyPrimarySubjectClass(primarySubject);
  const ctaIntent = classifyCtaIntent(ctaText);
  const assetRoute = deriveAssetRoute({ contentType, photoStrategy, styleTier, userUploadedPhoto, reusedFromAssetId });
  const creativeFamily = deriveCreativeFamily({ assetType, contentType });
  const sympathyClassification = sympathy ? "sympathy" : "not_sympathy";
  const promotionIntent = promotion ? "real_promotion" : "not_promotion";
  const factRequirements = deriveFactRequirements({ requestText, ctaText: ctaText || "", bodyText, objective, invGroundedCount });

  // Batch 6 ("Premium Creative quality architecture"): namedCampaign/
  // audience/creativeMode/copyVoice — computed here, ONCE, from the
  // signals already derived above, so every downstream consumer (the
  // Creative Director, buildFlyerContentTask's tone line, a future
  // creativeDirection resolver) reads the same authoritative decision
  // rather than each re-deriving its own.
  const namedCampaign = classifyNamedCampaign({ occasionTitle, requestText, isSympathy: sympathy, occasionCategory });
  const audience = classifyAudience({ requestText, occasionTitle, isSympathy: sympathy, occasionCategory });
  const creativeMode = classifyCreativeMode({ occasionCategory, namedCampaign, sympathyClassification, promotionIntent, requestText });
  const copyVoice = classifyCopyVoice({ creativeMode, namedCampaign, occasionCategory, sympathyClassification, factRequirements, requestText });
  // Test C ("everyday social creative architecture fix"): computed here,
  // ONCE, from the request text and the audience already derived above —
  // the same "one authoritative decision, every downstream consumer
  // reuses it" pattern namedCampaign/audience/creativeMode/copyVoice
  // already establish.
  const messageIntent = classifyMessageIntent({ requestText, audience, isSympathy: sympathy, occasionCategory });
  const userTemporalIntent = classifyUserTemporalIntent({ requestText });

  return {
    version: CANONICAL_CONCEPT_VERSION,
    objective: objective || null,
    occasionCategory,
    primarySubjectClass,
    captionIntent: classifyCaptionIntent({ objective, isSympathy: sympathy }),
    ctaIntent,
    namedCampaign,
    audience,
    creativeMode,
    copyVoice,
    messageIntent,
    userTemporalIntent,
    visualDirection: {
      mood: creativeBrief?.mood || null,
      lighting: creativeBrief?.lighting || null,
      composition: creativeBrief?.composition || null,
      floralStyle: creativeBrief?.floral_style || null,
      photoStrategy: photoStrategy || null
    },
    creativeFamily,
    factRequirements,
    assetRoute,
    platform: platform || null,
    sympathyClassification,
    inventoryIntent: inventoryDriven ? "inventory_driven" : "not_inventory_driven",
    promotionIntent,
    // Test D: the structured promotion contract (null for a non-promotion).
    // Deliberately NOT an identity field — a wording revision must not be
    // treated as concept drift because a promo code was supplied later.
    promotionFacts: classifyPromotionFacts({ requestText, promotionIntent })
  };
}

/**
 * Batch 4, Part D: a revision's starting point — the parent's concept,
 * with only the explicitly-supplied `overrides` applied. Never rebuilds
 * the whole concept from scratch (that's exactly the drift this batch
 * exists to prevent) — an ordinary wording/visual-execution revision
 * calls this with NO overrides at all, so every identity field survives
 * byte-for-byte.
 */
export function inheritConcept(parentConcept, overrides = {}) {
  if (!parentConcept || typeof parentConcept !== "object") return null;
  const next = { ...parentConcept, ...overrides, version: CANONICAL_CONCEPT_VERSION };
  if (overrides.visualDirection) {
    next.visualDirection = { ...parentConcept.visualDirection, ...overrides.visualDirection };
  }
  return next;
}

// ---------------------------------------------------------------------------
// Part E: deterministic detection of an EXPLICIT concept-changing request.
// ---------------------------------------------------------------------------

// Each rule names which canonical-concept fields an instruction matching
// it is allowed to change. Deliberately narrow, real phrasings — an
// ordinary wording/visual tweak ("make it shorter," "make the image
// brighter") must never match any of these.
//
// Post-fix (independent review finding, HIGH): "focus on X instead of Y"
// and "make this about X instead" originally matched ANY noun pair —
// "focus on roses instead of tulips" or "make this about value instead of
// speed" both matched and were silently treated as an explicit
// subject/occasion change, even though neither names a real subject class
// or occasion category. Both are now gated by `validate`, requiring the
// named X/Y to actually match one of the same real occasion/subject-class
// keyword rules classifyOccasionCategory/classifyPrimarySubjectClass
// already use — an ordinary emphasis tweak with no real category word in
// it no longer counts as a deliberate concept change. "change the subject
// to ..." stays unconditional — it explicitly names "the subject," so
// there's no real ambiguity to gate.
function textNamesKnownOccasionOrSubject(text) {
  const haystack = String(text || "");
  if (OCCASION_KEYWORD_RULES.some((rule) => rule.re.test(haystack))) return true;
  if (SUBJECT_CLASS_RULES.some((rule) => rule.re.test(haystack))) return true;
  return false;
}

const CONCEPT_CHANGE_RULES = [
  {
    fields: ["occasionCategory", "sympathyClassification"],
    re: /\b(?:turn|change|make) this (?:post |flyer |image )?into an? sympathy\b|\bmake this an? sympathy post\b/i
  },
  {
    fields: ["occasionCategory", "sympathyClassification"],
    re: /\bfrom an? (\w+) post to an? sympathy post\b|\bfrom an? (\w+) (?:post|flyer) to an? (\w+) post\b/i
  },
  { fields: ["objective", "promotionIntent"], re: /\bmake this an? (?:real )?promotion\b|\bturn this into an? promotion\b|\bpromote \d+%? ?off\b/i },
  { fields: ["objective", "promotionIntent"], re: /\bremove the promotion\b|\bmake it awareness[- ]only\b|\bno longer a promotion\b/i },
  {
    fields: ["primarySubjectClass", "occasionCategory"],
    re: /\bfocus on ([a-z][\w\s]*?) instead of ([a-z][\w\s]*?)\b/i,
    validate: (match) => textNamesKnownOccasionOrSubject(match[1]) || textNamesKnownOccasionOrSubject(match[2])
  },
  { fields: ["inventoryIntent"], re: /\buse (?:the )?inventory we have today\b|\buse what'?s in stock\b|\bactually use (?:our|my) (?:real )?inventory\b/i },
  { fields: ["ctaIntent"], re: /\bchange the (?:call to action|cta) to\b|\bchange the cta\b/i },
  { fields: ["primarySubjectClass"], re: /\bchange the subject to\b/i },
  {
    fields: ["primarySubjectClass"],
    re: /\bmake this about (\w[\w\s]*) instead\b/i,
    validate: (match) => textNamesKnownOccasionOrSubject(match[1])
  },
  { fields: ["assetRoute"], re: /\buse (?:a|my) real photo instead\b|\bswitch to an? ai[- ]generated photo\b|\buse an uploaded photo instead\b/i }
];

/**
 * Returns `{ changed: boolean, fields: string[] }` — `fields` is the
 * union of every rule's declared fields that actually matched this
 * instruction AND, for a rule with its own `validate`, whose captured
 * text names a real occasion/subject category (see textNamesKnownOccasion
 * OrSubject above) — never returns fields a rule didn't explicitly name,
 * and never treats an ordinary emphasis/tone tweak with no real category
 * word as a concept change. This is the deterministic gate Part E
 * requires ("Create deterministic or tightly-scoped detection for
 * deliberate concept-changing instructions"), not a fuzzy AI
 * classification.
 */
export function detectExplicitConceptChangeRequest(instruction) {
  const text = String(instruction || "");
  const fields = new Set();
  for (const rule of CONCEPT_CHANGE_RULES) {
    const match = text.match(rule.re);
    if (!match) continue;
    if (rule.validate && !rule.validate(match, text)) continue;
    for (const f of rule.fields) fields.add(f);
  }
  return { changed: fields.size > 0, fields: [...fields] };
}

// ---------------------------------------------------------------------------
// Part I: structured concept-drift detection — comparing two concepts'
// identity fields, never a fuzzy AI comparison.
// ---------------------------------------------------------------------------

/**
 * Compares `candidateConcept` against `parentConcept` across
 * CONCEPT_IDENTITY_FIELDS only (visualDirection/factRequirements/
 * platform/version are execution detail, allowed to shift freely).
 * `allowedFields` (from detectExplicitConceptChangeRequest, or an empty
 * array for an ordinary revision) names which identity fields are
 * PERMITTED to differ — anything outside that set that actually changed
 * is reported as drift.
 */
export function detectConceptDrift(parentConcept, candidateConcept, allowedFields = []) {
  if (!parentConcept || !candidateConcept) return { hasDrift: false, driftedFields: [] };
  const allowed = new Set(allowedFields);
  const driftedFields = [];
  for (const field of CONCEPT_IDENTITY_FIELDS) {
    if (allowed.has(field)) continue;
    if (parentConcept[field] !== candidateConcept[field]) driftedFields.push(field);
  }
  return { hasDrift: driftedFields.length > 0, driftedFields };
}

// A small, bounded stopword list — enough to make the overlap check in
// detectImageSubjectDrift meaningful without pulling in an NLP library.
const STOPWORDS = new Set([
  "a", "an", "the", "of", "on", "in", "with", "and", "for", "to", "at", "by", "is", "are",
  "this", "that", "photo", "photograph", "image", "picture", "shot"
]);

function significantWords(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Batch 4, Part I #9: "image prompt drifting away from canonical subject
 * class." A bounded, deterministic word-overlap check — never a second AI
 * call. `null` when there's nothing to compare (no primarySubject on
 * file yet); a real, human-readable reason string when the actual image
 * prompt shares NONE of the concept's own subject words.
 */
export function detectImageSubjectDrift({ concept, imagePromptText, primarySubject } = {}) {
  const subjectText = primarySubject || "";
  if (!subjectText || !imagePromptText) return null;
  const subjectWords = new Set(significantWords(subjectText));
  if (!subjectWords.size) return null;
  const promptWords = new Set(significantWords(imagePromptText));
  const overlap = [...subjectWords].some((w) => promptWords.has(w));
  if (overlap) return null;
  return `The image prompt no longer shares any real word with the canonical subject ("${subjectText}") — this looks like a different photo, not a revision of the same one.`;
}
