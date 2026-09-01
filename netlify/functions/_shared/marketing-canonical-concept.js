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
import { BEREAVEMENT_CONTEXT_RE, requestSignalsRealPromotion, requestSignalsIntentionalInventoryUse } from "./marketing-content-revision.js";

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
  "assetRoute"
]);

const OCCASION_KEYWORD_RULES = [
  { category: "birthday", re: /\bbirthdays?\b/i },
  { category: "anniversary", re: /\banniversar(?:y|ies)\b/i },
  { category: "wedding_event", re: /\bweddings?\b|\bbridal\b|\bengagement\b/i },
  { category: "graduation", re: /\bgraduations?\b|\bgrads?\b/i },
  { category: "new_baby", re: /\bnew ?baby\b|\bbaby shower\b|\bnewborn\b/i },
  { category: "get_well", re: /\bget well\b|\bfeel better\b/i }
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
  { key: "event_date", re: /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\btoday\b|\btomorrow\b|\bthis (?:weekend|week)\b|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/i },
  { key: "shop_hours", re: /\bhours?\b|\bopen(?:ing)?\b|\bclos(?:e|ed|ing)\b/i },
  { key: "delivery_service", re: /\bdeliver(?:y|ies|ing)?\b/i }
];

/**
 * Batch 4, Part J: factRequirements — which REAL shop facts this concept
 * depends on staying verified through any revision. Deliberately never
 * includes AI scene details (visual_brief/creative_brief prose remains
 * creative fiction, not a shop fact this list tracks) — only the same
 * categories of real, checkable claims Batch 1's own evaluator already
 * polices (a phone number, a promotion, real inventory, a stated date,
 * shop hours, a delivery/service claim).
 */
export function deriveFactRequirements({ requestText = "", ctaText = "", bodyText = "", objective = null, invGroundedCount = 0 } = {}) {
  const keys = new Set();
  const haystack = `${requestText} ${ctaText} ${bodyText}`;
  for (const rule of FACT_SIGNAL_RULES) {
    if (rule.re.test(haystack)) keys.add(rule.key);
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

  return {
    version: CANONICAL_CONCEPT_VERSION,
    objective: objective || null,
    occasionCategory,
    primarySubjectClass,
    captionIntent: classifyCaptionIntent({ objective, isSympathy: sympathy }),
    ctaIntent,
    visualDirection: {
      mood: creativeBrief?.mood || null,
      lighting: creativeBrief?.lighting || null,
      composition: creativeBrief?.composition || null,
      floralStyle: creativeBrief?.floral_style || null,
      photoStrategy: photoStrategy || null
    },
    creativeFamily,
    factRequirements: deriveFactRequirements({ requestText, ctaText: ctaText || "", bodyText, objective, invGroundedCount }),
    assetRoute,
    platform: platform || null,
    sympathyClassification: sympathy ? "sympathy" : "not_sympathy",
    inventoryIntent: inventoryDriven ? "inventory_driven" : "not_inventory_driven",
    promotionIntent: promotion ? "real_promotion" : "not_promotion"
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
