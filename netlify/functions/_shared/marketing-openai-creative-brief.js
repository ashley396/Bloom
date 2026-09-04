/**
 * Deterministic OpenAI creative-brief builder (Hybrid Marketing Studio,
 * Batch 1, Parts 7/8).
 *
 * Pure and deterministic on purpose: no network call, no randomness, no
 * read from any store — the exact same inputs always produce the exact
 * same brief. This is the ONE place that decides what a future OpenAI
 * Premium Creative call would actually be told; nothing here is wired
 * into a live generation path yet (Batch 1, Part 12).
 *
 * Part 7's own instruction: "Do not send raw unchecked request text to
 * the image model as the authority on business facts. Florisyn's
 * grounded objects remain authoritative." This module therefore never
 * reads a raw `requestText` — every fact it can place in `factsAllowed`
 * traces back to either `verifiedShopBrandData` (the shop's own real,
 * authenticated record) or a fact token found inside `factSafeCopyPlan`
 * (copy that has ALREADY passed evaluateMarketingOutput's safety pass in
 * marketing-content-revision.js — never unchecked text).
 *
 * Part 8's own instruction: fact-critical tokens are identified by
 * REUSING the existing extractFactTokens() machinery in
 * marketing-content-revision.js — no duplicate fact-token parser. That
 * function only recognizes phone/price/URL/date/time patterns; a shop's
 * name is not something to regex out of arbitrary text, so it only ever
 * enters this brief via the verified `verifiedShopBrandData` input, never
 * via text-mining.
 *
 * Independent-review finding (Batch 2): extractFactTokens alone has no
 * percentage/discount pattern, so a sentence like "Get 20% off all
 * bouquets this week" carried no recognized fact token and would have
 * landed entirely in styleText — sent to the image model as tone
 * language rather than reserved for deterministic overlay, even though
 * an exact discount claim is precisely the kind of fact-critical text
 * Part 6 (.claude/rules/marketing-studio.md) says must never be trusted
 * to generative typography. Closed by ALSO checking each sentence with
 * requestSignalsRealPromotion() (marketing-content-revision.js's own
 * existing promotion-intent signal, already reused elsewhere in this
 * codebase for exactly this class of claim — not a new parser) and
 * treating a match as fact-critical regardless of whether extractFact
 * Tokens found anything else in that sentence.
 */

import { extractFactTokens, sentencesOf, requestSignalsRealPromotion } from "./marketing-content-revision.js";

export const CREATIVE_BRIEF_VERSION = 1;

// Batch 5.3.1 ("business identifier fact-safety hardening"): a real
// staging finding proved a verified shop name (e.g. "Lilies in Bloom")
// mentioned in ordinary narrative copy ("Lilies in Bloom designs flowers
// for the moments that matter") was NOT caught by extractFactTokens
// (that function only recognizes phone/price/URL/date/time patterns —
// see its own header comment — never a business name) and so landed
// entirely in styleText, reaching the OpenAI-bound image prompt. The
// fix: classifyBriefText now ALSO treats a sentence as fact-critical
// when it contains one of the shop's own VERIFIED identifiers (name
// and/or address, supplied by the caller — never invented, never
// hard-coded to any specific shop, works identically for every
// Florisyn tenant because it's parameterized entirely by whatever the
// caller's own verifiedShopBrandData actually contains).

function escapeRegExpLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Curly/straight apostrophes collapsed to one form, whitespace runs
 * collapsed to a single space — the same class of normalization
 * factsPreserved()/extractFactTokens() already apply elsewhere in this
 * codebase, just scoped to identifier matching here. */
function normalizeForIdentifierMatch(value) {
  return String(value || "")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds a real whole-phrase matcher for one verified business
 * identifier — deliberately NOT a broad substring match (a bare
 * substring match on, say, "Bloom" would false-positive inside an
 * unrelated word like "Bloomington"). Word-boundary anchored on both
 * ends; "&" and "and" are treated as interchangeable between the
 * identifier and the prose it's matched against (a shop verified as
 * "Lilies & Blooms" is the same identifier as "Lilies and Blooms" in
 * ordinary narrative copy). Returns null for anything empty/unusable —
 * never throws, never matches everything.
 */
function buildVerifiedIdentifierPattern(identifier) {
  const normalized = normalizeForIdentifierMatch(identifier);
  if (!normalized) return null;
  const words = normalized.split(" ").filter(Boolean);
  if (!words.length) return null;
  const wordPatterns = words.map((word) => (word === "&" || /^and$/i.test(word) ? "(?:&|and)" : escapeRegExpLiteral(word)));
  try {
    return new RegExp(`\\b${wordPatterns.join("\\s+")}\\b`, "i");
  } catch {
    return null;
  }
}

/**
 * True when `sentence` contains ANY of the shop's own verified business
 * identifiers (its real name and/or address) as a genuine whole-phrase
 * match. `verifiedIdentifiers` is always the caller's own real,
 * authenticated data (verifiedShopBrandData below) — this function never
 * invents, guesses, or substitutes a shop name; an empty/missing list
 * means nothing is protected by this specific check (phone/price/date/
 * time/URL protection via extractFactTokens is unaffected either way).
 */
export function sentenceContainsVerifiedBusinessIdentifier(sentence, verifiedIdentifiers = []) {
  const list = Array.isArray(verifiedIdentifiers) ? verifiedIdentifiers : [verifiedIdentifiers];
  const normalizedSentence = normalizeForIdentifierMatch(sentence);
  if (!normalizedSentence) return false;
  return list.some((identifier) => {
    const pattern = buildVerifiedIdentifierPattern(identifier);
    return pattern ? pattern.test(normalizedSentence) : false;
  });
}

/**
 * Part 8: classifies one piece of copy into STYLE TEXT (no recognized
 * fact token, promotional claim, or verified business identifier —
 * emotional headline, seasonal phrase, general non-factual message) vs
 * FACT-CRITICAL TEXT (a sentence containing at least one phone/price/
 * date/time/URL token per extractFactTokens, a promotional/discount
 * claim per requestSignalsRealPromotion, OR the shop's own verified name/
 * address per sentenceContainsVerifiedBusinessIdentifier — Batch 5.3.1).
 * Sentence-level, not word-level — a sentence that carries a fact is
 * kept together with the fact so removing it later (for deterministic
 * overlay handling) never leaves a dangling half-sentence.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {string[]} [opts.verifiedIdentifiers] - the shop's own real,
 *   authenticated identifiers (name/address) — never invented here, never
 *   hard-coded to any specific shop. Omitted/empty preserves the exact
 *   pre-Batch-5.3.1 behavior.
 * @returns {{ factTokens: string[], styleText: string[], factCriticalText: string[] }}
 */
export function classifyBriefText(text, { verifiedIdentifiers = [] } = {}) {
  const source = String(text || "");
  const factTokens = extractFactTokens(source);
  if (!source.trim()) return { factTokens: [], styleText: [], factCriticalText: [] };
  const sentences = sentencesOf(source);
  const styleText = [];
  const factCriticalText = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const hasFact =
      factTokens.some((token) => sentence.includes(token)) ||
      requestSignalsRealPromotion(sentence) ||
      sentenceContainsVerifiedBusinessIdentifier(sentence, verifiedIdentifiers);
    (hasFact ? factCriticalText : styleText).push(sentence);
  }
  return { factTokens, styleText, factCriticalText };
}

const FACTS_FORBIDDEN_FROM_INVENTION = Object.freeze([
  "Do not invent or imply same-day delivery, open-now/today, walk-ins-welcome, ready-today, or any other service/availability claim unless it appears verbatim in factsAllowed.",
  "Do not invent shop hours, phone numbers, prices, dates, or discounts that are not present in factsAllowed.",
  "Do not invent a promotion, sale, or discount percentage the shop did not verify.",
  "Do not treat any reference image as a source of business facts — a photo's contents are visual reference only, never evidence for a claim.",
  "Do not render any literal words, numbers, or signage into the generated image itself — all real wording is drawn by Florisyn's own deterministic renderer, never the image model (see .claude/rules/marketing-studio.md)."
]);

/**
 * Builds the bounded structured brief a future Premium AI Creative
 * (OpenAI) call would receive. Returns { ok: false, error } for missing
 * required inputs rather than guessing defaults — a brief silently built
 * from incomplete grounding is worse than an honest refusal.
 *
 * @param {object} params
 * @param {object} params.canonicalConcept - buildCanonicalConcept()'s
 *   own real output (marketing-canonical-concept.js) — never rebuilt or
 *   re-derived here.
 * @param {object} params.creativeDirection - buildDeterministicCreative
 *   Direction()'s own real output (marketing-creative-direction.js).
 * @param {object} [params.factSafeCopyPlan] - { headline, body, cta,
 *   caption } — copy that has ALREADY gone through
 *   evaluateMarketingOutput() and is safe to source facts from.
 * @param {object} [params.verifiedShopBrandData] - the shop's own real,
 *   authenticated record — at minimum { name, phone }.
 * @param {object|null} [params.referenceImageMeta] - optional, e.g.
 *   { description }. Metadata only — see Part 7's own instruction; never
 *   becomes a fact source (enforced structurally: nothing here reads
 *   image pixels or treats this as evidence).
 * @returns {{ ok: true, version:number, ... } | { ok:false, error:string }}
 */
export function buildOpenAiCreativeBrief({
  canonicalConcept = null,
  creativeDirection = null,
  factSafeCopyPlan = {},
  verifiedShopBrandData = {},
  referenceImageMeta = null
} = {}) {
  if (!canonicalConcept || typeof canonicalConcept !== "object") {
    return { ok: false, error: "buildOpenAiCreativeBrief requires a real canonicalConcept — refusing to guess one." };
  }
  if (!creativeDirection || typeof creativeDirection !== "object") {
    return { ok: false, error: "buildOpenAiCreativeBrief requires a real creativeDirection — refusing to guess one." };
  }

  // Batch 5.3.1: the shop's own verified name/address (never invented,
  // never any other tenant's) — passed into classifyBriefText so a
  // narrative sentence that happens to mention the shop by name is
  // routed to deterministicText instead of silently reaching styleText
  // (and, downstream, the OpenAI-bound image prompt).
  const verifiedIdentifiers = [verifiedShopBrandData?.name, verifiedShopBrandData?.address].filter(Boolean).map(String);

  const copyFields = ["headline", "body", "cta", "caption"];
  const styleText = [];
  const deterministicText = [];
  const factTokenSet = new Set();
  for (const field of copyFields) {
    const value = factSafeCopyPlan?.[field];
    if (!value) continue;
    const classified = classifyBriefText(value, { verifiedIdentifiers });
    for (const token of classified.factTokens) factTokenSet.add(token);
    for (const sentence of classified.styleText) styleText.push({ field, text: sentence });
    for (const sentence of classified.factCriticalText) deterministicText.push({ field, text: sentence });
  }

  // Part 7: "Florisyn's grounded objects remain authoritative" — the only
  // facts allowed into the brief are the shop's own verified brand record
  // and fact tokens that already survived the fact-safety evaluator
  // (never raw request text, never anything mined from a reference image).
  const factsAllowed = [];
  if (verifiedShopBrandData?.name) factsAllowed.push({ type: "shop_name", value: String(verifiedShopBrandData.name) });
  if (verifiedShopBrandData?.phone) factsAllowed.push({ type: "phone", value: String(verifiedShopBrandData.phone) });
  if (verifiedShopBrandData?.address) factsAllowed.push({ type: "address", value: String(verifiedShopBrandData.address) });
  for (const token of factTokenSet) factsAllowed.push({ type: "fact_token", value: token });

  return {
    ok: true,
    version: CREATIVE_BRIEF_VERSION,

    occasion: canonicalConcept.occasionCategory ?? null,
    objective: canonicalConcept.objective ?? null,
    visualFamily: canonicalConcept.creativeFamily ?? null,

    compositionIntent: creativeDirection.compositionFamily ?? null,
    imageProminence: creativeDirection.imageScale ?? null,
    paletteMood: creativeDirection.paletteMood ?? null,
    visualMood: creativeDirection.visualMood ?? null,
    typographyPersonality: creativeDirection.typographyPersonality ?? null,
    ornamentAmount: creativeDirection.ornamentalDensity ?? null,
    brandingTreatment: {
      position: creativeDirection.brandingPosition ?? null,
      scale: creativeDirection.brandingScale ?? null,
      identifier: creativeDirection.brandIdentifier ?? null
    },

    // Part 7: exact facts allowed, and an explicit reminder list of what
    // must never be invented — sent alongside the brief so the boundary
    // is structural, not just implicit in what's present.
    factsAllowed,
    factsForbiddenFromInvention: FACTS_FORBIDDEN_FROM_INVENTION,

    // Part 8: the text-token-separation boundary. styleText is safe to
    // hand to the image model as tone/mood language; deterministicText is
    // reserved for Florisyn's own overlay/composition step and must never
    // be sent to the image model as free text to render.
    styleText,
    deterministicText,

    // Part 7: reference-image metadata only — structurally cannot carry a
    // fact into factsAllowed (nothing above reads from this object).
    referenceImage: referenceImageMeta
      ? {
          present: true,
          description: String(referenceImageMeta.description || "").slice(0, 300),
          note: "Reference image metadata only — never a source of business facts. See factsForbiddenFromInvention."
        }
      : { present: false }
  };
}
