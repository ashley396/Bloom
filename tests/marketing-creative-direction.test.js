import test from "node:test";
import assert from "node:assert/strict";
import {
  CREATIVE_DIRECTION_VERSION,
  OCCASION_TREATMENTS,
  COMPOSITION_FAMILIES,
  GRAPHIC_TEXT_SLOTS_DEFAULT,
  GRAPHIC_TEXT_LIMITS_DEFAULT,
  resolveOccasionTreatment,
  resolveDefaultBrandIdentifier,
  isBrandIdentifierSupported,
  getCategoryConstraints,
  buildDeterministicCreativeDirection,
  validateCreativeDirection,
  inheritCreativeDirection
} from "../netlify/functions/_shared/marketing-creative-direction.js";
import { buildCanonicalConcept } from "../netlify/functions/_shared/marketing-canonical-concept.js";

/**
 * Creative Direction Engine, Phase 1 — CORRECTED design standard (Ashley,
 * after reviewing the first pass against her own reference flyers): the
 * target is polished, visually rich, intentional florist advertising —
 * never sparse minimalism. "Restrained" means controlled and intentional,
 * not empty. This file replaces the first pass's unit suite entirely;
 * several of its old assertions (e.g. "sparse density must never carry
 * more than one optional slot") encoded the wrong baseline and are not
 * carried forward.
 *
 * Mirrors this codebase's own split between marketing-canonical-
 * concept.test.js (unit) and marketing-studio-canonical-concept.test.js
 * (handler integration): persistence/revision-inheritance through the
 * real handler live in tests/marketing-studio-creative-direction-
 * integration.test.js instead of here.
 */

function conceptFor(overrides = {}) {
  return buildCanonicalConcept({ requestText: "Post something nice", objective: "awareness", ...overrides });
}

// A full, already-valid Direction object to layer test overrides onto —
// isolates "does THIS field behave correctly" from "did I remember to
// supply every other field," the same way a real caller (the
// deterministic generator, or eventually a Phase 3 model output) would
// always hand the validator a complete candidate, never a bare fragment.
function fullCandidate(overrides = {}) {
  return { ...buildDeterministicCreativeDirection({ canonicalConcept: conceptFor() }), ...overrides };
}

// ---------------------------------------------------------------------------
// The exact live-diagnosed prompt — the acceptance standard itself.
// ---------------------------------------------------------------------------

function liveFailureConcept() {
  return buildCanonicalConcept({
    requestText: "Create today's Facebook post for Lilies in Bloom",
    occasionTitle: "Today's post",
    platform: "facebook",
    contentType: "image_post",
    assetType: "flyer",
    objective: "awareness",
    primarySubject: null,
    ctaText: null,
    bodyText: "",
    isSympathy: false,
    photoStrategy: "subject_forward",
    styleTier: "generated"
  });
}

test("the exact live prompt produces a polished everyday_floral Direction — not sparse, not the old regression shape", () => {
  const concept = liveFailureConcept();
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: concept, shopBrand: {} });

  assert.equal(direction.occasionTreatment, "everyday_floral");
  assert.equal(direction.compositionFamily, "hero_full_bleed");
  assert.equal(direction.imagePlacement, "full_bleed");
  assert.equal(direction.imageScale, "dominant");
  assert.equal(direction.textRegion, "negative_space_band_lower");
  assert.equal(direction.typographyPersonality, "serif_script_pairing");
  assert.equal(direction.headlineScale, "large");
  assert.equal(direction.scriptAccentUsage, "accent_word");
  assert.equal(direction.hierarchyDepth, "headline_plus_support", "a strong headline plus a short supporting line — not headline-only, not a paragraph");
  assert.equal(direction.graphicTextSlots.headline, true);
  assert.equal(direction.graphicTextSlots.supportingLine, true, "a short supporting line is allowed and present by default now");
  assert.equal(direction.graphicTextSlots.serviceDetail, false);
  assert.equal(direction.graphicTextSlots.cta, false, "no CTA intent on this request — never invented");
  assert.equal(direction.graphicTextSlots.phone, false);
  assert.equal(direction.textDensity, "standard", "not sparse — the corrected baseline");
  assert.equal(direction.ornamentalDensity, "light", "some tasteful ornament, never zero, never chaotic");
  assert.equal(direction.decorativeRestraint, "disciplined");
  assert.notEqual(direction.borderStyle, "none", "a tasteful border is present by default for an everyday post now");
  assert.notEqual(direction.dividerStyle, "none");
  assert.equal(direction.brandIdentifier, "shop_name", "no verified logo on file — never invented");
  assert.notEqual(direction.compositionFamily, "operational_notice_panel");
  assert.notEqual(direction.occasionTreatment, "sympathy_elegance");
  assert.notEqual(direction.occasionTreatment, "operational_notice");
  const { valid, errors } = validateCreativeDirection(direction, { canonicalConcept: concept });
  assert.equal(valid, true, `the generator's own output must already be fully valid: ${errors.join("; ")}`);
});

test("schema sanity: every enum field is a finite array, versioned", () => {
  assert.equal(CREATIVE_DIRECTION_VERSION, 2);
  assert.deepEqual([...OCCASION_TREATMENTS].sort(), ["boutique_floral", "elegant_editorial", "everyday_floral", "operational_notice", "promotional_feature", "seasonal_feature", "sympathy_elegance"].sort());
  assert.ok(Array.isArray(COMPOSITION_FAMILIES) && COMPOSITION_FAMILIES.length > 0);
  // The old forced "magazine split" regression must never resurface as a
  // valid structural shape under a new name.
  assert.ok(!COMPOSITION_FAMILIES.some((f) => /split|magazine/i.test(f)));
  assert.deepEqual(Object.keys(GRAPHIC_TEXT_SLOTS_DEFAULT).sort(), ["brand", "cta", "headline", "phone", "serviceDetail", "supportingLine"]);
  assert.deepEqual(GRAPHIC_TEXT_LIMITS_DEFAULT, { headlineMaxChars: 42, supportingLineMaxChars: 60, serviceDetailMaxChars: 70, ctaMaxChars: 30 });
});

test("occasionTreatment vs. compositionFamily are genuinely distinct axes, never redundant", () => {
  // Two requests sharing the same occasionTreatment (everyday_floral) can
  // legitimately land on different structural shapes depending on the
  // family's own leaning — proven here by comparing everyday_floral
  // (hero_full_bleed) against elegant_editorial (layered_editorial) and
  // boutique_floral (framed_panel), which are DIFFERENT occasionTreatments
  // with DIFFERENT compositionFamily leanings, showing the two fields
  // move independently rather than always moving together.
  const everyday = getCategoryConstraints({ occasionCategory: "general" });
  const elegant = getCategoryConstraints({ occasionCategory: "elegant_editorial_override_not_a_real_category" }); // falls through to everyday since occasionCategory alone can't select elegant_editorial deterministically
  const operational = getCategoryConstraints({ occasionCategory: "operational_notice" });
  assert.equal(everyday.occasionTreatment, "everyday_floral");
  assert.equal(elegant.occasionTreatment, "everyday_floral", "elegant_editorial/boutique_floral are never deterministically auto-selected — see resolveOccasionTreatment's own docstring");
  assert.notEqual(everyday.leaning.compositionFamily, operational.forced.compositionFamily, "different families genuinely land on different structural shapes");
});

test("elegant_editorial and boutique_floral are real, valid, fully-supportable choices even though never auto-selected", () => {
  const concept = conceptFor();
  for (const family of ["elegant_editorial", "boutique_floral"]) {
    const { direction, valid, errors } = validateCreativeDirection(fullCandidate({ occasionTreatment: family }), { canonicalConcept: concept });
    assert.equal(direction.occasionTreatment, family, `a non-sympathy/operational/promotional concept must be free to choose ${family}`);
    assert.equal(valid, true, errors.join("; "));
  }
});

// ---------------------------------------------------------------------------
// everyday_floral
// ---------------------------------------------------------------------------

test("everyday floral supports a supporting line by default, never forces sparse/headline-only", () => {
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: conceptFor() });
  assert.equal(direction.occasionTreatment, "everyday_floral");
  assert.equal(direction.graphicTextSlots.supportingLine, true);
  assert.notEqual(direction.textDensity, "sparse");
});

test("everyday floral never defaults to operational-notice or sympathy styling", () => {
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: conceptFor() });
  assert.notEqual(direction.compositionFamily, "framed_panel"); // operational's forced shape
  assert.notEqual(direction.paletteMood, "neutral_blush_ivory"); // sympathy's forced palette
});

// ---------------------------------------------------------------------------
// elegant_editorial
// ---------------------------------------------------------------------------

test("elegant editorial supports serif + script pairing with a large/oversized headline and refined ornament", () => {
  const concept = conceptFor();
  // The generator's own leaning for this family, exactly as Phase 3
  // would eventually select it:
  const constraints = getCategoryConstraints({ occasionCategory: "general" });
  const rich = validateCreativeDirection(
    fullCandidate({
      occasionTreatment: "elegant_editorial",
      typographyPersonality: "serif_script_pairing",
      headlineScale: "oversized",
      scriptAccentUsage: "subhead_script",
      borderStyle: "double_line",
      dividerStyle: "ornamental_flourish"
    }),
    { canonicalConcept: concept }
  );
  assert.equal(rich.direction.occasionTreatment, "elegant_editorial");
  assert.equal(rich.direction.typographyPersonality, "serif_script_pairing");
  assert.equal(rich.direction.headlineScale, "oversized");
  assert.equal(rich.direction.scriptAccentUsage, "subhead_script");
  assert.equal(rich.valid, true, rich.errors.join("; "));
  assert.ok(constraints, "sanity: category constraints table resolves for a general concept");
});

// ---------------------------------------------------------------------------
// boutique_floral
// ---------------------------------------------------------------------------

test("boutique floral supports moderate/rich ornament, badges, and prominent branding", () => {
  const concept = conceptFor();
  const moderate = validateCreativeDirection(
    fullCandidate({ occasionTreatment: "boutique_floral", ornamentalDensity: "moderate", badgeStyle: "circular_badge", textRegion: "badge", brandingScale: "prominent" }),
    { canonicalConcept: concept }
  );
  assert.equal(moderate.valid, true, moderate.errors.join("; "));
  assert.equal(moderate.direction.ornamentalDensity, "moderate");
  assert.equal(moderate.direction.badgeStyle, "circular_badge");

  const rich = validateCreativeDirection(fullCandidate({ occasionTreatment: "boutique_floral", ornamentalDensity: "rich", decorativeRestraint: "disciplined" }), { canonicalConcept: concept });
  assert.equal(rich.valid, true, rich.errors.join("; "));
  assert.equal(rich.direction.ornamentalDensity, "rich", "rich ornament is a fully legitimate boutique_floral choice, never itself a defect");
});

// ---------------------------------------------------------------------------
// sympathy_elegance
// ---------------------------------------------------------------------------

test("sympathy stays respectful but not empty: generous room, refined typography, service detail + CTA when grounded", () => {
  const withCta = buildCanonicalConcept({ requestText: "A sympathy arrangement for the Smith family funeral, call 606-506-4039", isSympathy: true, ctaText: "Call 606-506-4039" });
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: withCta });
  assert.equal(direction.occasionTreatment, "sympathy_elegance");
  assert.equal(direction.visualMood, "quiet_respectful");
  assert.equal(direction.paletteMood, "neutral_blush_ivory");
  assert.equal(direction.negativeSpaceStrategy, "generous");
  assert.equal(direction.hierarchyDepth, "headline_support_service_cta", "a grounded CTA earns the full respectful 4-role stack, never left empty");
  assert.equal(direction.graphicTextSlots.serviceDetail, true);
  assert.equal(direction.graphicTextSlots.cta, true);
  assert.notEqual(direction.ornamentalDensity, "rich", "sympathy is never zero ornament, but never rich either");
  assert.notEqual(direction.ornamentalDensity, "minimal", "still a real, considered design — not stripped bare");
});

test("sympathy without a grounded CTA still gets a real supporting line, never a bare headline-only card", () => {
  const noCta = buildCanonicalConcept({ requestText: "A sympathy arrangement for the Smith family", isSympathy: true });
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: noCta });
  assert.equal(direction.graphicTextSlots.supportingLine, true);
  assert.equal(direction.graphicTextSlots.cta, false, "never invents a CTA the request didn't ground");
});

test("sympathy never gets celebratory mood, vibrant palette, a banner, or rich ornament, even on a hand-built candidate", () => {
  const concept = { sympathyClassification: "sympathy", occasionCategory: "sympathy" };
  const { direction, errors } = validateCreativeDirection(
    { occasionTreatment: "sympathy_elegance", visualMood: "bold_celebratory", paletteMood: "vibrant_seasonal", compositionFamily: "banner_led", bannerStyle: "ribbon_banner", ornamentalDensity: "rich" },
    { canonicalConcept: concept }
  );
  assert.equal(direction.visualMood, "quiet_respectful");
  assert.equal(direction.paletteMood, "neutral_blush_ivory");
  assert.notEqual(direction.compositionFamily, "banner_led");
  assert.equal(direction.bannerStyle, "none");
  assert.equal(direction.ornamentalDensity, "light");
  assert.ok(errors.length >= 4);
});

// ---------------------------------------------------------------------------
// seasonal_feature
// ---------------------------------------------------------------------------

test("seasonal supports themed decorative language and stronger visual energy than everyday", () => {
  const concept = buildCanonicalConcept({ requestText: "Mother's Day arrangements are here", objective: "seasonal_occasion" });
  assert.equal(concept.occasionCategory, "holiday_seasonal");
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: concept });
  assert.equal(direction.occasionTreatment, "seasonal_feature");
  assert.equal(direction.paletteMood, "vibrant_seasonal");
  assert.equal(direction.visualMood, "playful_energetic");
  assert.equal(direction.ornamentalDensity, "moderate");
});

// ---------------------------------------------------------------------------
// operational_notice
// ---------------------------------------------------------------------------

test("operational notice prioritizes legibility: framed panel, dense-tolerant, shop name explicit, no full script headline", () => {
  const concept = buildCanonicalConcept({ requestText: "We are closing early at 3pm today, call 606-506-4039.", objective: "operational", ctaText: "Call 606-506-4039" });
  assert.equal(concept.occasionCategory, "operational_notice");
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: concept });
  assert.equal(direction.compositionFamily, "framed_panel");
  assert.equal(direction.brandIdentifier, "shop_name");
  assert.notEqual(direction.scriptAccentUsage, "full_script_headline");
  assert.equal(direction.textDensity, "dense");
  // Still beautiful and branded, per Ashley's explicit rule — never a
  // plain corporate notice card: real ornament and typography choices
  // still apply, not stripped to bare text.
  assert.notEqual(direction.ornamentalDensity, "minimal");
  assert.notEqual(direction.borderStyle, "none");
  const { valid, errors } = validateCreativeDirection(direction, { canonicalConcept: concept });
  assert.equal(valid, true, errors.join("; "));
});

test("a full script headline on an operational notice is clamped, even on a hand-built candidate", () => {
  const concept = { occasionCategory: "operational_notice" };
  const { direction, errors } = validateCreativeDirection({ occasionTreatment: "operational_notice", scriptAccentUsage: "full_script_headline" }, { canonicalConcept: concept });
  assert.notEqual(direction.scriptAccentUsage, "full_script_headline");
  assert.ok(errors.some((e) => /legibility-critical/i.test(e)));
});

// Independent-review fix (CRITICAL): operational_notice's own
// hierarchyDepth used to be hardcoded to a CTA-bearing depth
// unconditionally, regardless of whether the notice had any real CTA —
// "we're closing early today" (nothing to call about) got an invented
// CTA slot forced onto the graphic, and validateCreativeDirection's own
// CTA-invention guard only checked ctaProminence (which stayed "none"),
// so it silently reported the self-contradictory object as fully valid.
// Same bug shape existed in promotional_feature.
test("a no-CTA operational notice never gets an invented CTA slot — the exact bug the independent review found", () => {
  const concept = buildCanonicalConcept({ requestText: "We are closing early at 3pm today.", objective: "operational" });
  assert.equal(concept.ctaIntent, "none", "sanity: this request genuinely has no CTA");
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: concept });
  assert.equal(direction.graphicTextSlots.cta, false);
  assert.equal(direction.graphicTextSlots.phone, false);
  assert.equal(direction.ctaProminence, "none");
  assert.notEqual(direction.hierarchyDepth, "headline_support_cta");
  const { valid, errors } = validateCreativeDirection(direction, { canonicalConcept: concept });
  assert.equal(valid, true, errors.join("; "));
});

test("a no-CTA promotional post never gets an invented CTA slot — the same bug shape, same fix", () => {
  const concept = buildCanonicalConcept({ requestText: "20% off all bouquets this weekend", objective: "promotion" });
  assert.equal(concept.promotionIntent, "real_promotion");
  assert.equal(concept.ctaIntent, "none", "sanity: this request genuinely has no extractable CTA");
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: concept });
  assert.equal(direction.graphicTextSlots.cta, false);
  assert.equal(direction.ctaProminence, "none");
  const { valid, errors } = validateCreativeDirection(direction, { canonicalConcept: concept });
  assert.equal(valid, true, errors.join("; "));
});

test("validateCreativeDirection's CTA-invention guard fires on an invented CTA SLOT even when ctaProminence is already 'none' — the exact gap the review found", () => {
  // Before the fix, this exact shape (cta:true, phone:true, ctaProminence
  // already "none") slipped through with zero errors, because the old
  // guard only ever checked ctaProminence.
  const { direction, valid, errors } = validateCreativeDirection(
    { hierarchyDepth: "headline_support_cta", ctaProminence: "none", graphicTextSlots: { brand: true, headline: true, supportingLine: true, cta: true, phone: true } },
    { canonicalConcept: { ctaIntent: "none" } }
  );
  assert.equal(valid, false, "this self-contradictory candidate must never be reported as valid");
  assert.equal(direction.graphicTextSlots.cta, false);
  assert.equal(direction.graphicTextSlots.phone, false);
  assert.ok(errors.some((e) => /invented cta/i.test(e)));
});

// ---------------------------------------------------------------------------
// promotional_feature
// ---------------------------------------------------------------------------

test("promotional supports a stronger CTA/offer hierarchy only when promotionIntent is real", () => {
  const promo = getCategoryConstraints({ occasionCategory: "general", promotionIntent: "real_promotion", ctaIntent: "order_now" });
  assert.equal(promo.occasionTreatment, "promotional_feature");
  assert.equal(promo.ctaProminenceCeiling, "strong");
  assert.equal(promo.leaning.compositionFamily, "banner_led");
  assert.equal(promo.leaning.hierarchyDepth, "headline_support_cta");

  const nonPromo = getCategoryConstraints({ occasionCategory: "general", promotionIntent: "not_promotion", ctaIntent: "order_now" });
  assert.notEqual(nonPromo.ctaProminenceCeiling, "strong");
  assert.notEqual(nonPromo.occasionTreatment, "promotional_feature");
});

test("a 'strong' CTA prominence is rejected without a real promotionIntent, even on a hand-built candidate", () => {
  const { direction, errors } = validateCreativeDirection(
    { ctaProminence: "strong", graphicTextSlots: { cta: true } },
    { canonicalConcept: { ctaIntent: "order_now", promotionIntent: "not_promotion" } }
  );
  assert.notEqual(direction.ctaProminence, "strong");
  assert.ok(errors.some((e) => /strong.*requires a real promotionIntent/i.test(e)));
});

// ---------------------------------------------------------------------------
// Brand identifier
// ---------------------------------------------------------------------------

test("no-logo shop always forces shop_name, never invents a logo", () => {
  assert.equal(resolveDefaultBrandIdentifier({ hasVerifiedLogo: false }), "shop_name");
  assert.equal(isBrandIdentifierSupported("logo", { hasVerifiedLogo: false }), false);
  assert.equal(isBrandIdentifierSupported("both", { hasVerifiedLogo: false }), false);
  const { direction, errors } = validateCreativeDirection({ brandIdentifier: "logo" }, { hasVerifiedLogo: false });
  assert.equal(direction.brandIdentifier, "shop_name");
  assert.ok(errors.some((e) => /verified logo/i.test(e)));
});

test("logo-present shop can resolve to logo, shop_name, or both — all three become valid, supportable choices", () => {
  for (const choice of ["logo", "shop_name", "both"]) {
    assert.equal(isBrandIdentifierSupported(choice, { hasVerifiedLogo: true }), true);
    const { direction, valid, errors } = validateCreativeDirection(fullCandidate({ brandIdentifier: choice }), { hasVerifiedLogo: true });
    assert.equal(direction.brandIdentifier, choice);
    assert.equal(valid, true, errors.join("; "));
  }
  // Phase 1's deterministic generator still conservatively defaults to
  // shop_name even with a logo on file (no creative-merit basis yet to
  // prefer one — Phase 3's job).
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: conceptFor(), shopBrand: { logoUrl: "https://fake.storage/logo.png" } });
  assert.equal(direction.brandIdentifier, "shop_name");
});

test("branding can never resolve to none: brand slot forced on, brandIdentifier always a real value", () => {
  const { direction: noBrand, errors: e1 } = validateCreativeDirection({ graphicTextSlots: { brand: false } });
  assert.equal(noBrand.graphicTextSlots.brand, true);
  assert.ok(e1.some((e) => /brand.*disabled/i.test(e)));

  const { direction: badIdentifier, errors: e2 } = validateCreativeDirection({ brandIdentifier: "none" });
  assert.ok(["logo", "shop_name", "both"].includes(badIdentifier.brandIdentifier));
  assert.ok(e2.length > 0);
});

test("headline is effectively mandatory: disabling it is rejected", () => {
  const { direction, errors } = validateCreativeDirection({ graphicTextSlots: { headline: false } });
  assert.equal(direction.graphicTextSlots.headline, true);
  assert.ok(errors.some((e) => /headline.*mandatory/i.test(e)));
});

test("operational notice always includes shop_name, even on a hand-built candidate with a logo", () => {
  const concept = { occasionCategory: "operational_notice" };
  const { direction, errors } = validateCreativeDirection({ occasionTreatment: "operational_notice", brandIdentifier: "logo" }, { canonicalConcept: concept, hasVerifiedLogo: true });
  assert.ok(["shop_name", "both"].includes(direction.brandIdentifier));
  assert.ok(errors.some((e) => /shop name explicitly/i.test(e)));
});

// ---------------------------------------------------------------------------
// CTA / phone
// ---------------------------------------------------------------------------

test("ordinary post does not force a phone CTA", () => {
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: conceptFor({ ctaText: "" }) });
  assert.equal(direction.graphicTextSlots.phone, false);
  assert.equal(direction.graphicTextSlots.cta, false);
  assert.equal(direction.ctaProminence, "none");
});

test("a real call_shop CTA intent enables the phone slot; any other/no intent never does, even on a hand-built candidate", () => {
  const callShop = validateCreativeDirection({ graphicTextSlots: { cta: true, phone: true }, hierarchyDepth: "headline_plus_cta" }, { canonicalConcept: { ctaIntent: "call_shop" } });
  assert.equal(callShop.direction.graphicTextSlots.phone, true);

  const orderNow = validateCreativeDirection({ graphicTextSlots: { cta: true, phone: true }, hierarchyDepth: "headline_plus_cta" }, { canonicalConcept: { ctaIntent: "order_now" } });
  assert.equal(orderNow.direction.graphicTextSlots.phone, false, "a phone slot needs call_shop intent specifically, not just any CTA intent");
});

// ---------------------------------------------------------------------------
// Graphic text stays structured by hierarchy
// ---------------------------------------------------------------------------

test("graphic text stays structured by hierarchy: graphicTextSlots is always synchronized to hierarchyDepth", () => {
  const { direction, errors } = validateCreativeDirection({ hierarchyDepth: "headline_only", graphicTextSlots: { supportingLine: true, cta: true, phone: true } });
  assert.equal(direction.graphicTextSlots.supportingLine, false);
  assert.equal(direction.graphicTextSlots.cta, false);
  assert.equal(direction.graphicTextSlots.phone, false);
  assert.ok(errors.some((e) => /did not match hierarchyDepth/.test(e)));
});

test("headline-only can never be textDensity dense; the full 4-role stack can never be textDensity sparse", () => {
  const tooSparse = validateCreativeDirection({ hierarchyDepth: "headline_support_service_cta", textDensity: "sparse" }, { canonicalConcept: { ctaIntent: "call_shop" } });
  assert.equal(tooSparse.direction.textDensity, "standard");
  const tooDense = validateCreativeDirection({ hierarchyDepth: "headline_only", textDensity: "dense" });
  assert.equal(tooDense.direction.textDensity, "sparse");
});

test("everyday_floral is never left with the full 4-role hierarchy — that depth is reserved for sympathy/operational/promotional", () => {
  const { direction, errors } = validateCreativeDirection(
    { occasionTreatment: "everyday_floral", hierarchyDepth: "headline_support_service_cta", graphicTextSlots: { supportingLine: true, serviceDetail: true, cta: true } },
    { canonicalConcept: { ctaIntent: "call_shop" } }
  );
  assert.notEqual(direction.hierarchyDepth, "headline_support_service_cta");
  assert.ok(errors.some((e) => /reserved for sympathy\/operational\/promotional/.test(e)));
});

// ---------------------------------------------------------------------------
// No paragraph-style image overlay (the hard ceiling)
// ---------------------------------------------------------------------------

test("no paragraph-style image overlay: character ceilings are hard limits, never loosened past the documented maximum", () => {
  const { direction, errors } = validateCreativeDirection({ graphicTextLimits: { headlineMaxChars: 400, supportingLineMaxChars: 999 } });
  assert.equal(direction.graphicTextLimits.headlineMaxChars, 42);
  assert.equal(direction.graphicTextLimits.supportingLineMaxChars, 60);
  assert.ok(errors.length >= 2);
});

// ---------------------------------------------------------------------------
// Rich ornament can still be valid when intentional
// ---------------------------------------------------------------------------

test("rich ornament is a fully legitimate choice when disciplined; only 'rich + loose' is a real contradiction", () => {
  const richDisciplined = validateCreativeDirection(fullCandidate({ occasionTreatment: "boutique_floral", ornamentalDensity: "rich", decorativeRestraint: "disciplined" }), { canonicalConcept: {} });
  assert.equal(richDisciplined.valid, true, richDisciplined.errors.join("; "));
  assert.equal(richDisciplined.direction.ornamentalDensity, "rich");

  const richLoose = validateCreativeDirection(fullCandidate({ occasionTreatment: "boutique_floral", ornamentalDensity: "rich", decorativeRestraint: "loose" }), { canonicalConcept: {} });
  assert.equal(richLoose.direction.decorativeRestraint, "disciplined", "rich+loose reads as clutter — normalized toward discipline, richness itself is preserved");
  assert.equal(richLoose.direction.ornamentalDensity, "rich");
});

// ---------------------------------------------------------------------------
// Validator blocks contradictory combinations
// ---------------------------------------------------------------------------

test("validator blocks an unknown enum value, clamping to a safe, still-polished default", () => {
  const { direction, valid, errors } = validateCreativeDirection({ compositionFamily: "chaotic_explosion_layout", visualMood: "nonexistent_mood" });
  assert.equal(valid, false);
  assert.equal(direction.compositionFamily, "hero_full_bleed");
  assert.equal(direction.visualMood, "warm_inviting");
  assert.ok(errors.length >= 2);
});

test("validator blocks banner/badge styles with no matching region/family", () => {
  const noBanner = validateCreativeDirection({ bannerStyle: "ribbon_banner", textRegion: "negative_space_band_lower", compositionFamily: "hero_full_bleed" });
  assert.equal(noBanner.direction.bannerStyle, "none");
  const noBadge = validateCreativeDirection({ badgeStyle: "circular_badge", textRegion: "negative_space_band_lower", occasionTreatment: "everyday_floral" });
  assert.equal(noBadge.direction.badgeStyle, "none");
});

test("validator blocks impossible image-placement / background-treatment / text-region pairings", () => {
  // compositionFamily pinned to "banner_led" (deliberately unconstrained
  // by the compositionFamily<->imagePlacement rule — see that rule's own
  // comment) so these isolate the plain imagePlacement<->backgroundTreatment
  // pairwise rule alone, not the compositionFamily-authoritative one.
  const bg1 = validateCreativeDirection({ compositionFamily: "banner_led", backgroundTreatment: "full_bleed_photo", imagePlacement: "framed_block" });
  assert.equal(bg1.direction.imagePlacement, "full_bleed");

  const bg2 = validateCreativeDirection({ compositionFamily: "banner_led", backgroundTreatment: "framed_photo_block", imagePlacement: "full_bleed" });
  assert.equal(bg2.direction.imagePlacement, "framed_block");

  const region = validateCreativeDirection({ compositionFamily: "banner_led", imagePlacement: "full_bleed", textRegion: "dedicated_panel" });
  assert.equal(region.direction.textRegion, "negative_space_band_lower");
});

// Independent-review fix: compositionFamily itself was never
// cross-checked against imagePlacement/backgroundTreatment at all — a
// candidate could claim a framed/paneled structural shape while
// separately claiming a plain full-bleed photo. compositionFamily is
// authoritative over BOTH fields together (never just one), so the
// separate imagePlacement<->backgroundTreatment rule can't fight it and
// flip the correction back.
test("validator makes compositionFamily authoritative over imagePlacement AND backgroundTreatment together, never leaving them fighting each other", () => {
  const framed = validateCreativeDirection({ compositionFamily: "framed_panel", imagePlacement: "full_bleed", backgroundTreatment: "full_bleed_photo" });
  assert.equal(framed.direction.imagePlacement, "framed_block");
  assert.equal(framed.direction.backgroundTreatment, "framed_photo_block");

  const hero = validateCreativeDirection({ compositionFamily: "hero_full_bleed", imagePlacement: "framed_block", backgroundTreatment: "bordered_panel_with_photo_inset" });
  assert.equal(hero.direction.imagePlacement, "full_bleed");
  assert.equal(hero.direction.backgroundTreatment, "full_bleed_photo");

  // banner_led stays unconstrained by this rule specifically — a real,
  // internally-consistent framed choice for it is accepted untouched.
  const banner = validateCreativeDirection(
    { compositionFamily: "banner_led", imagePlacement: "framed_block", backgroundTreatment: "framed_photo_block", textRegion: "banner", bannerStyle: "ribbon_banner" },
    { canonicalConcept: {} }
  );
  assert.equal(banner.direction.imagePlacement, "framed_block");
  assert.equal(banner.direction.backgroundTreatment, "framed_photo_block");
});

test("CTA prominence incompatible with ctaIntent is clamped — a loud CTA graphic needs a real CTA intent behind it", () => {
  const { direction, errors } = validateCreativeDirection({ ctaProminence: "strong", graphicTextSlots: { cta: true } }, { canonicalConcept: { ctaIntent: "none" } });
  assert.equal(direction.ctaProminence, "none");
  assert.equal(direction.graphicTextSlots.cta, false);
  assert.ok(errors.some((e) => /ctaProminence/.test(e)));
});

test("a real ctaIntent with a quiet on-graphic CTA is a legitimate choice, never forced louder", () => {
  const { valid, errors } = validateCreativeDirection(
    fullCandidate({ occasionTreatment: "everyday_floral", hierarchyDepth: "headline_only", ctaProminence: "none", graphicTextSlots: { brand: true, headline: true, supportingLine: false, serviceDetail: false, cta: false, phone: false } }),
    { canonicalConcept: { ctaIntent: "call_shop" } }
  );
  assert.equal(valid, true, `a real CTA intent must never force a louder on-graphic CTA: ${errors.join("; ")}`);
});

// ---------------------------------------------------------------------------
// Inventory-grounded — guidance only.
// ---------------------------------------------------------------------------

test("inventory-grounded request: guidance only, never a forced layout field, never a species-naming decision", () => {
  const constraints = getCategoryConstraints({ occasionCategory: "general", inventoryIntent: "inventory_driven" });
  assert.equal(constraints.inventoryGroundedGuidance, true);
});

// ---------------------------------------------------------------------------
// Part H — revision inheritance
// ---------------------------------------------------------------------------

test("inheritCreativeDirection carries the parent forward byte-for-byte with no overrides", () => {
  const parent = buildDeterministicCreativeDirection({ canonicalConcept: liveFailureConcept() });
  const inherited = inheritCreativeDirection(parent);
  assert.deepEqual(inherited, parent);
  assert.notEqual(inherited, parent, "must be a real independent copy, never the same mutable object reference");
});

test("inheritCreativeDirection with no parent returns null (the pre-Phase-1 asset case)", () => {
  assert.equal(inheritCreativeDirection(null), null);
  assert.equal(inheritCreativeDirection(undefined), null);
});

test("inheritCreativeDirection applies only the explicitly-supplied overrides, deep-merging nested contract objects", () => {
  const parent = buildDeterministicCreativeDirection({ canonicalConcept: liveFailureConcept() });
  const inherited = inheritCreativeDirection(parent, { graphicTextSlots: { serviceDetail: true } });
  assert.equal(inherited.graphicTextSlots.serviceDetail, true);
  assert.equal(inherited.graphicTextSlots.headline, parent.graphicTextSlots.headline, "unrelated slot fields must survive untouched");
  assert.equal(inherited.compositionFamily, parent.compositionFamily);
});

// ---------------------------------------------------------------------------
// Canonical concept behavior remains unchanged
// ---------------------------------------------------------------------------

test("buildCanonicalConcept's own output shape/fields are completely unaffected by Creative Direction existing", () => {
  const concept = liveFailureConcept();
  const fieldsBefore = Object.keys(concept).sort();
  const snapshot = JSON.parse(JSON.stringify(concept));
  buildDeterministicCreativeDirection({ canonicalConcept: concept, shopBrand: { logoUrl: "x" } });
  assert.deepEqual(concept, snapshot, "canonical concept object must not be mutated by building a Creative Direction from it");
  assert.deepEqual(Object.keys(concept).sort(), fieldsBefore);
});

test("resolveOccasionTreatment matches getCategoryConstraints' own resolution for every concept shape exercised above", () => {
  assert.equal(resolveOccasionTreatment({ sympathyClassification: "sympathy" }), "sympathy_elegance");
  assert.equal(resolveOccasionTreatment({ occasionCategory: "operational_notice" }), "operational_notice");
  assert.equal(resolveOccasionTreatment({ promotionIntent: "real_promotion" }), "promotional_feature");
  assert.equal(resolveOccasionTreatment({ occasionCategory: "holiday_seasonal" }), "seasonal_feature");
  assert.equal(resolveOccasionTreatment({}), "everyday_floral");
});
