/**
 * Florisyn Marketing Studio — the one deterministic diversity evaluator
 * (Batch 5, "Repair recent-content diversity + brand-memory learning").
 *
 * Real problem this closes: nothing before this ever actually STOPPED
 * Lily from repeating the same opening line, CTA, subject, or creative
 * family back-to-back — the old recent-content module only ever handed
 * the model a soft "please don't repeat these" hint (marketing-recent-
 * content-grounding.js's buildRecentContentGroundingBrief), which a
 * generation call is free to ignore, and nothing downstream ever checked
 * whether it actually did.
 *
 * This module is the one place that:
 *   - takes the structured recent-content history (marketing-recent-
 *     content-grounding.js's loadRecentContentHistory — published-
 *     preferred, approved-fallback, deduped by content item) and a
 *     candidate's own canonical concept (Batch 4);
 *   - runs bounded, deterministic, structured comparisons for meaningful
 *     repetition (Part D) — never a fuzzy AI similarity call;
 *   - returns a pass/retry decision a caller can fold into whatever
 *     bounded retry it already runs (Part E) — this module never retries
 *     anything itself.
 *
 * Deliberately narrow, matching Part D's own instruction: every check
 * here compares STRUCTURED fields (enums) or a short NORMALIZED opening/
 * full-text string — never a word-overlap or keyword-similarity score —
 * so ordinary florist vocabulary ("flowers," "beautiful," "arrangement,"
 * "local," "order") can never by itself trigger a retry. Two captions
 * that both happen to say "beautiful arrangement" but open differently
 * and serve different objectives/subjects pass cleanly.
 */

// Part D: "repeated objective too many times in a row" and the other
// structural-repetition checks all use the same streak definition — the
// candidate plus this many of the most-recent history entries (already
// sorted most-recent-first) sharing the same value. 3 in a row is the
// smallest number that actually earns the word "pattern" rather than
// "coincidence," without penalizing two similar posts back to back (a
// real, legitimate case — a shop running the same weekly special twice).
const REPEAT_STREAK_THRESHOLD = 3;

function leadingStreak(candidateValue, historyValues) {
  if (!candidateValue) return 1;
  let streak = 1;
  for (const v of historyValues) {
    if (v && v === candidateValue) streak += 1;
    else break;
  }
  return streak;
}

function checkStreak({ field, candidateValue, recentHistory, reasonText }) {
  if (!candidateValue) return null;
  const historyValues = recentHistory.map((e) => e[field]);
  const streak = leadingStreak(candidateValue, historyValues);
  if (streak < REPEAT_STREAK_THRESHOLD) return null;
  return { field, reason: reasonText(streak), matches: recentHistory.filter((e) => e[field] === candidateValue).slice(0, streak - 1) };
}

/**
 * @param {object} params
 * @param {{headline?: string, body?: string, caption?: string, cta?: string}} params.candidate
 *   the newly-generated content being checked — body/caption is the
 *   caption text, cta is the on-image/CTA text.
 * @param {object|null} params.canonicalConcept - this candidate's own
 *   Batch 4 canonical concept (objective/occasionCategory/
 *   primarySubjectClass/ctaIntent/creativeFamily/visualDirection/
 *   assetRoute) — the primary structured source for every field-level
 *   comparison below (Part F); never re-derived from free text when this
 *   is already available.
 * @param {object[]} params.recentHistory - structured entries from
 *   loadRecentContentHistory, most-recent-first.
 * @param {string|null} [params.templateFamily] - the flyer template id
 *   this candidate used, if any (not part of canonicalConcept's own
 *   schema — Part D #7's own signal).
 * @returns {{decision:"pass"|"retry", reasons:string[], repeatedSignals:string[], recentMatches:object[]}}
 */
export function evaluateMarketingDiversity({ candidate = {}, canonicalConcept = null, recentHistory = [], platform = null, contentItemId = null, templateFamily = null } = {}) {
  const reasons = [];
  const repeatedSignals = [];
  const recentMatches = [];

  const captionText = candidate.body || candidate.caption || "";
  const openingPattern = normalizeOpening(captionText);
  const normalizedCaption = normalizeCaption(captionText);
  const ctaText = normalizeCaption(candidate.cta || "");

  const addMatch = (signal, matches) => {
    repeatedSignals.push(signal);
    for (const m of matches) recentMatches.push({ contentItemId: m.contentItemId, platform: m.platform, signal });
  };

  // Part D #1: identical or near-identical opening line — ANY match in
  // the recent window is worth a retry, not just a streak; a single
  // repeated opening line is exactly the failure mode Ashley described.
  if (openingPattern) {
    const openingMatches = recentHistory.filter((e) => e.captionOpeningPattern && e.captionOpeningPattern === openingPattern);
    if (openingMatches.length) {
      reasons.push("This opens with almost the same wording as a recent real post — write a genuinely different opening line.");
      addMatch("opening_line", openingMatches);
    }
  }

  // Part D #8: the same normalized caption text, essentially word-for-word.
  if (normalizedCaption) {
    const captionMatches = recentHistory.filter((e) => e.normalizedCaptionText && e.normalizedCaptionText === normalizedCaption);
    if (captionMatches.length) {
      reasons.push("This caption is essentially identical to a recent real post's caption — write something genuinely new.");
      addMatch("caption_text", captionMatches);
    }
  }

  // Part D #3: repeated objective too many times in a row.
  const objective = canonicalConcept?.objective ?? null;
  const objectiveStreak = checkStreak({
    field: "objective",
    candidateValue: objective,
    recentHistory,
    reasonText: (n) => `The last ${n - 1} real posts (and this one) all share the same objective ("${objective}") — vary the goal of this post if the request allows it.`
  });
  if (objectiveStreak) {
    reasons.push(objectiveStreak.reason);
    addMatch("objective", objectiveStreak.matches);
  }

  // Part D #4: repeated concept/subject class. Also covers Part D #9
  // ("same concept duplicated across platforms") as a natural consequence
  // — recentHistory is already deduplicated to one entry per content
  // item (see loadRecentContentHistory), so any match here is inherently
  // a DIFFERENT post, never this same post's own other-platform variant.
  const conceptFingerprint = canonicalConcept
    ? [objective, canonicalConcept.occasionCategory, canonicalConcept.primarySubjectClass, canonicalConcept.ctaIntent, canonicalConcept.creativeFamily].map((v) => v || "_").join("|")
    : null;
  if (conceptFingerprint) {
    const conceptMatches = recentHistory.filter((e) => e.conceptFingerprint === conceptFingerprint);
    if (conceptMatches.length) {
      reasons.push("This post's underlying idea (subject, occasion, CTA, and format) is essentially the same as a recent real post — give this one a genuinely different angle.");
      addMatch("concept_fingerprint", conceptMatches);
    }
  }

  const subjectStreak = checkStreak({
    field: "primarySubjectClass",
    candidateValue: canonicalConcept?.primarySubjectClass ?? null,
    recentHistory,
    reasonText: (n) => `The last ${n - 1} real posts (and this one) all feature the same kind of subject ("${canonicalConcept.primarySubjectClass}") — vary what's actually shown.`
  });
  if (subjectStreak) {
    reasons.push(subjectStreak.reason);
    addMatch("primary_subject_class", subjectStreak.matches);
  }

  // Part D #2: repeated CTA pattern.
  const ctaIntent = canonicalConcept?.ctaIntent ?? null;
  const ctaStreak = checkStreak({
    field: "ctaIntent",
    candidateValue: ctaIntent,
    recentHistory,
    reasonText: (n) => `The last ${n - 1} real posts (and this one) all use the same call-to-action pattern ("${ctaIntent}") — vary the CTA if the request allows it.`
  });
  if (ctaStreak) {
    reasons.push(ctaStreak.reason);
    addMatch("cta_intent", ctaStreak.matches);
  } else if (ctaText) {
    // A CTA that's exact-word-for-word identical to the immediately
    // preceding real post is worth flagging even below the streak
    // threshold — the same "any exact match matters" treatment as the
    // opening line/caption text checks above, scoped to just the CTA.
    const exactCtaMatches = recentHistory.filter((e) => e.ctaText && e.ctaText === ctaText);
    if (exactCtaMatches.length) {
      reasons.push("This uses the exact same call-to-action wording as a recent real post — vary the phrasing.");
      addMatch("cta_text", exactCtaMatches);
    }
  }

  // Part D #5: repeated creative family.
  const creativeFamilyStreak = checkStreak({
    field: "creativeFamily",
    candidateValue: canonicalConcept?.creativeFamily ?? null,
    recentHistory,
    reasonText: (n) => `The last ${n - 1} real posts (and this one) all use the same creative format ("${canonicalConcept.creativeFamily}") — vary the format if the request allows it.`
  });
  if (creativeFamilyStreak) {
    reasons.push(creativeFamilyStreak.reason);
    addMatch("creative_family", creativeFamilyStreak.matches);
  }

  // Part D #6: repeated visual composition/direction, where structurally
  // detectable — photoStrategy is the one visualDirection field every
  // photo-bearing generation actually sets; mood/lighting/composition are
  // model-authored free text and deliberately NOT compared here (Part D's
  // own "avoid overbroad similarity rules" instruction).
  const photoStrategy = canonicalConcept?.visualDirection?.photoStrategy ?? null;
  const photoStrategyStreak = checkStreak({
    field: "visualPhotoStrategy",
    candidateValue: photoStrategy,
    recentHistory: recentHistory.map((e) => ({ ...e, visualPhotoStrategy: e.visualDirection?.photoStrategy ?? null })),
    reasonText: (n) => `The last ${n - 1} real posts (and this one) all use the same visual composition ("${photoStrategy}") — vary the composition if the request allows it.`
  });
  if (photoStrategyStreak) {
    reasons.push(photoStrategyStreak.reason);
    addMatch("visual_direction", photoStrategyStreak.matches);
  }

  // Part D #7: repeated template family.
  const templateStreak = checkStreak({
    field: "templateFamily",
    candidateValue: templateFamily,
    recentHistory,
    reasonText: (n) => `The last ${n - 1} real posts (and this one) all use the same flyer template — vary the template if one is available.`
  });
  if (templateStreak) {
    reasons.push(templateStreak.reason);
    addMatch("template_family", templateStreak.matches);
  }

  return {
    decision: reasons.length ? "retry" : "pass",
    reasons,
    repeatedSignals: [...new Set(repeatedSignals)],
    recentMatches
  };
}

function normalizeOpening(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(" ");
}

function normalizeCaption(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
