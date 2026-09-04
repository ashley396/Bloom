import test from "node:test";
import assert from "node:assert/strict";
import { buildCreativeDirectorDirection, _internalsForTesting } from "../netlify/functions/_shared/marketing-creative-director.js";
import { buildDeterministicCreativeDirection } from "../netlify/functions/_shared/marketing-creative-direction.js";

// Batch 5.1 ("Premium Creative Director module") — pure, deterministic
// translation of the existing creativeDirection/canonicalConcept objects
// into rich advertising-photography prompt language. No network call, no
// randomness, no fact leakage by construction (this module never
// receives factSafeCopyPlan/verifiedShopBrandData at all).

function concept(overrides = {}) {
  return {
    version: 1,
    objective: "awareness",
    occasionCategory: "general",
    ctaIntent: "none",
    factRequirements: [],
    ...overrides
  };
}

test("buildCreativeDirectorDirection fails closed (never guesses) without a real canonicalConcept", () => {
  const result = buildCreativeDirectorDirection({ canonicalConcept: null, creativeDirection: { compositionFamily: "hero_full_bleed" } });
  assert.equal(result.ok, false);
});

test("buildCreativeDirectorDirection fails closed (never guesses) without a real creativeDirection", () => {
  const result = buildCreativeDirectorDirection({ canonicalConcept: concept(), creativeDirection: null });
  assert.equal(result.ok, false);
});

test("buildCreativeDirectorDirection is pure/deterministic: identical inputs always produce identical output", () => {
  const cc = concept({ objective: "promotion", ctaIntent: "order_now" });
  const cd = buildDeterministicCreativeDirection({ canonicalConcept: { occasionCategory: "general", ctaIntent: "order_now" } });
  const a = buildCreativeDirectorDirection({ canonicalConcept: cc, creativeDirection: cd });
  const b = buildCreativeDirectorDirection({ canonicalConcept: cc, creativeDirection: cd });
  assert.deepEqual(a, b);
});

test("every real OCCASION_TREATMENTS value produces a distinct, non-empty framing sentence", () => {
  const { ENUM_REFERENCE, OCCASION_TREATMENT_FRAMING } = _internalsForTesting;
  const seen = new Set();
  for (const value of ENUM_REFERENCE.OCCASION_TREATMENTS) {
    const phrase = OCCASION_TREATMENT_FRAMING[value];
    assert.ok(phrase && phrase.length > 0, `occasionTreatment "${value}" has no framing phrase`);
    assert.ok(!seen.has(phrase), `occasionTreatment "${value}" reuses another family's exact phrase — not actually distinct`);
    seen.add(phrase);
  }
});

// Enum-coverage regression: every real enum value marketing-creative-
// direction.js exports for a field this module translates must have a
// dictionary entry (even if that entry is intentionally null, e.g.
// "none"/"full_bleed_photo") — catches a future creative-direction.js
// enum addition silently falling back to nothing forever.
test("every phrase dictionary has a key for every real enum value it claims to translate", () => {
  const {
    ENUM_REFERENCE,
    COMPOSITION_FAMILY_PHRASES,
    SUBJECT_PLACEMENT_PHRASES,
    IMAGE_CROP_PHRASES,
    IMAGE_PLACEMENT_PHRASES,
    IMAGE_SCALE_PHRASES,
    VISUAL_MOOD_PHRASES,
    PALETTE_MOOD_PHRASES,
    TEXT_REGION_PHRASES,
    NEGATIVE_SPACE_STRATEGY_PHRASES,
    CTA_PROMINENCE_PHRASES,
    HEADLINE_SCALE_PHRASES,
    TYPOGRAPHY_PERSONALITY_PHRASES,
    BRANDING_POSITION_PHRASES,
    BRANDING_SCALE_PHRASES,
    ORNAMENTAL_DENSITY_PHRASES,
    DECORATIVE_MOTIF_PHRASES,
    BORDER_STYLE_PHRASES,
    BACKGROUND_TREATMENT_PHRASES,
    DIVIDER_STYLE_NOTED,
    BADGE_STYLE_NOTED,
    BANNER_STYLE_NOTED
  } = _internalsForTesting;

  const checks = [
    ["COMPOSITION_FAMILIES", ENUM_REFERENCE.COMPOSITION_FAMILIES, COMPOSITION_FAMILY_PHRASES],
    ["SUBJECT_PLACEMENTS", ENUM_REFERENCE.SUBJECT_PLACEMENTS, SUBJECT_PLACEMENT_PHRASES],
    ["IMAGE_CROPS", ENUM_REFERENCE.IMAGE_CROPS, IMAGE_CROP_PHRASES],
    ["IMAGE_PLACEMENTS", ENUM_REFERENCE.IMAGE_PLACEMENTS, IMAGE_PLACEMENT_PHRASES],
    ["IMAGE_SCALES", ENUM_REFERENCE.IMAGE_SCALES, IMAGE_SCALE_PHRASES],
    ["VISUAL_MOODS", ENUM_REFERENCE.VISUAL_MOODS, VISUAL_MOOD_PHRASES],
    ["PALETTE_MOODS", ENUM_REFERENCE.PALETTE_MOODS, PALETTE_MOOD_PHRASES],
    ["TEXT_REGIONS", ENUM_REFERENCE.TEXT_REGIONS, TEXT_REGION_PHRASES],
    ["NEGATIVE_SPACE_STRATEGIES", ENUM_REFERENCE.NEGATIVE_SPACE_STRATEGIES, NEGATIVE_SPACE_STRATEGY_PHRASES],
    ["CTA_PROMINENCE_LEVELS", ENUM_REFERENCE.CTA_PROMINENCE_LEVELS, CTA_PROMINENCE_PHRASES],
    ["HEADLINE_SCALES", ENUM_REFERENCE.HEADLINE_SCALES, HEADLINE_SCALE_PHRASES],
    ["TYPOGRAPHY_PERSONALITIES", ENUM_REFERENCE.TYPOGRAPHY_PERSONALITIES, TYPOGRAPHY_PERSONALITY_PHRASES],
    ["BRANDING_POSITIONS", ENUM_REFERENCE.BRANDING_POSITIONS, BRANDING_POSITION_PHRASES],
    ["BRANDING_SCALES", ENUM_REFERENCE.BRANDING_SCALES, BRANDING_SCALE_PHRASES],
    ["ORNAMENTAL_DENSITIES", ENUM_REFERENCE.ORNAMENTAL_DENSITIES, ORNAMENTAL_DENSITY_PHRASES],
    ["DECORATIVE_MOTIFS", ENUM_REFERENCE.DECORATIVE_MOTIFS, DECORATIVE_MOTIF_PHRASES],
    ["BORDER_STYLES", ENUM_REFERENCE.BORDER_STYLES, BORDER_STYLE_PHRASES],
    ["BACKGROUND_TREATMENTS", ENUM_REFERENCE.BACKGROUND_TREATMENTS, BACKGROUND_TREATMENT_PHRASES]
  ];
  for (const [name, enumValues, dict] of checks) {
    for (const value of enumValues) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(dict, value),
        `${name} value "${value}" has no entry in its phrase dictionary (even a deliberate null entry must be present)`
      );
    }
  }
  // Divider/badge/banner styles are intentionally noted-only (renderer-
  // level detail, not photo-prompt content) — still assert every real
  // enum value is at least accounted for, so a future addition is caught.
  for (const value of ENUM_REFERENCE.DIVIDER_STYLES) assert.ok(DIVIDER_STYLE_NOTED.has(value), `DIVIDER_STYLES value "${value}" not accounted for`);
  for (const value of ENUM_REFERENCE.BADGE_STYLES) assert.ok(BADGE_STYLE_NOTED.has(value), `BADGE_STYLES value "${value}" not accounted for`);
  for (const value of ENUM_REFERENCE.BANNER_STYLES) assert.ok(BANNER_STYLE_NOTED.has(value), `BANNER_STYLES value "${value}" not accounted for`);
});

test("different occasion treatments produce meaningfully different directionText, not near-identical strings", () => {
  const base = { compositionFamily: "hero_full_bleed", imageScale: "dominant", paletteMood: "classic_brand", visualMood: "warm_inviting", textRegion: "negative_space_band_lower" };
  const everyday = buildCreativeDirectorDirection({ canonicalConcept: concept(), creativeDirection: { ...base, occasionTreatment: "everyday_floral" } });
  const sympathy = buildCreativeDirectorDirection({
    canonicalConcept: concept({ occasionCategory: "sympathy" }),
    creativeDirection: { ...base, occasionTreatment: "sympathy_elegance", visualMood: "quiet_respectful", paletteMood: "neutral_blush_ivory" }
  });
  const promo = buildCreativeDirectorDirection({
    canonicalConcept: concept({ objective: "promotion", ctaIntent: "order_now" }),
    creativeDirection: { ...base, occasionTreatment: "promotional_feature", visualMood: "bold_celebratory" }
  });
  assert.notEqual(everyday.directionText, sympathy.directionText);
  assert.notEqual(everyday.directionText, promo.directionText);
  assert.notEqual(sympathy.directionText, promo.directionText);
  assert.match(sympathy.directionText, /quiet|respectful|hushed/i);
  // "never celebratory" is an intentional, explicit negation in the
  // sympathy framing sentence itself — assert the word never appears
  // as a POSITIVE description (i.e. not immediately preceded by "never").
  assert.doesNotMatch(sympathy.directionText, /(?<!never )celebratory/i);
  assert.doesNotMatch(sympathy.directionText, /\bbold\b/i);
  assert.match(promo.directionText, /bold|confident/i);
});

test("textRegion drives negative-space guidance that matches the renderer's own region choice", () => {
  const lower = buildCreativeDirectorDirection({
    canonicalConcept: concept(),
    creativeDirection: { occasionTreatment: "everyday_floral", textRegion: "negative_space_band_lower" }
  });
  const upper = buildCreativeDirectorDirection({
    canonicalConcept: concept(),
    creativeDirection: { occasionTreatment: "everyday_floral", textRegion: "negative_space_band_upper" }
  });
  const banner = buildCreativeDirectorDirection({
    canonicalConcept: concept(),
    creativeDirection: { occasionTreatment: "everyday_floral", textRegion: "banner" }
  });
  assert.match(lower.directionText, /lower portion/i);
  assert.match(upper.directionText, /upper portion/i);
  assert.match(banner.directionText, /banner/i);
});

test("ctaIntent drives a distinct customer-action sentence; 'none' produces no invented action", () => {
  const withCta = buildCreativeDirectorDirection({
    canonicalConcept: concept({ ctaIntent: "call_shop" }),
    creativeDirection: { occasionTreatment: "everyday_floral" }
  });
  const withoutCta = buildCreativeDirectorDirection({
    canonicalConcept: concept({ ctaIntent: "none" }),
    creativeDirection: { occasionTreatment: "everyday_floral" }
  });
  assert.match(withCta.directionText, /calling the shop/i);
  assert.doesNotMatch(withoutCta.directionText, /calling the shop|placing an order|visiting the shop/i);
});

test("occasionCategory 'event_reminder' with a real event_date fact requirement produces urgency language; without one, purpose-specific but not urgent language", () => {
  const withDeadline = buildCreativeDirectorDirection({
    canonicalConcept: concept({ occasionCategory: "event_reminder", factRequirements: ["event_date"] }),
    creativeDirection: { occasionTreatment: "everyday_floral" }
  });
  const withoutDeadline = buildCreativeDirectorDirection({
    canonicalConcept: concept({ occasionCategory: "event_reminder", factRequirements: [] }),
    creativeDirection: { occasionTreatment: "everyday_floral" }
  });
  const ordinary = buildCreativeDirectorDirection({
    canonicalConcept: concept({ occasionCategory: "general" }),
    creativeDirection: { occasionTreatment: "everyday_floral" }
  });
  assert.match(withDeadline.directionText, /urgency|deadline/i);
  assert.match(withoutDeadline.directionText, /event-specific|purposeful/i);
  assert.doesNotMatch(ordinary.directionText, /event.reminder|urgency|deadline/i);
});

test("avoidance text always names the generic-template failure modes, as avoidance language only", () => {
  const result = buildCreativeDirectorDirection({ canonicalConcept: concept(), creativeDirection: { occasionTreatment: "everyday_floral", compositionFamily: "hero_full_bleed" } });
  assert.match(result.avoidanceText, /^Avoid:/);
  assert.match(result.avoidanceText, /generic AI-template/i);
  assert.match(result.avoidanceText, /blank center/i);
  assert.match(result.avoidanceText, /greeting-card symmetry/i);
  assert.match(result.avoidanceText, /clip-art/i);
  assert.match(result.avoidanceText, /centered decorative flower border/i, "hero_full_bleed should be warned against a stray decorative border");
});

test("a framed/paneled composition is NOT warned against its own appropriate border treatment", () => {
  const framed = buildCreativeDirectorDirection({ canonicalConcept: concept(), creativeDirection: { occasionTreatment: "boutique_floral", compositionFamily: "framed_panel" } });
  const layered = buildCreativeDirectorDirection({ canonicalConcept: concept(), creativeDirection: { occasionTreatment: "elegant_editorial", compositionFamily: "layered_editorial" } });
  assert.doesNotMatch(framed.avoidanceText, /centered decorative flower border/i);
  assert.doesNotMatch(layered.avoidanceText, /centered decorative flower border/i);
});

test("no raw/unrecognized field value is ever echoed verbatim into the output — only fixed dictionary phrases", () => {
  const maliciousConcept = concept({
    occasionCategory: "call 606-506-4039 now",
    objective: "the shop's phone is 555-0100",
    ctaIntent: "totally-made-up-intent"
  });
  const maliciousDirection = {
    occasionTreatment: "totally-made-up-family",
    compositionFamily: "not-a-real-family",
    visualMood: "555-0100",
    paletteMood: "another-injected-string",
    textRegion: "inject-me-here",
    brandingPosition: "inject-brand-position"
  };
  const result = buildCreativeDirectorDirection({ canonicalConcept: maliciousConcept, creativeDirection: maliciousDirection });
  assert.equal(result.ok, true, "an unrecognized field must never crash the module");
  const combined = `${result.directionText} ${result.avoidanceText}`;
  assert.doesNotMatch(combined, /606-506-4039/);
  assert.doesNotMatch(combined, /555-0100/);
  assert.doesNotMatch(combined, /totally-made-up/);
  assert.doesNotMatch(combined, /not-a-real-family/);
  assert.doesNotMatch(combined, /inject/i);
});

test("a real full end-to-end creativeDirection object (built via buildDeterministicCreativeDirection) always produces a non-empty directionText", () => {
  for (const occasionCategory of ["general", "sympathy", "operational_notice", "holiday_seasonal"]) {
    const cc = { occasionCategory, ctaIntent: occasionCategory === "operational_notice" ? "call_shop" : "none" };
    const cd = buildDeterministicCreativeDirection({ canonicalConcept: cc });
    const result = buildCreativeDirectorDirection({ canonicalConcept: concept({ occasionCategory }), creativeDirection: cd });
    assert.equal(result.ok, true);
    assert.ok(result.directionText.length > 0, `occasionCategory "${occasionCategory}" produced empty directionText`);
  }
});
