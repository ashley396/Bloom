/**
 * Florisyn Marketing Studio — Creative Direction, Phase 1
 * ("Creative Direction schema + deterministic constraints only").
 *
 * Real problem this closes: the live regression repair (commit 71e27f7)
 * removed the confirmed-wrong legacy defects (the old poster tool firing
 * first, funeral/notice filler bleeding into an ordinary creative post),
 * but what's left is still visually generic and overcrowded — a stock
 * headline, several stacked text strips over the photo, body copy over
 * the image, weak hierarchy, no request-specific creative decision. The
 * regression patch fixed what was WRONG; it never gave Marketing Studio
 * anything that actually DECIDES how a flyer should look. That decision
 * — composition, crop, text allocation, typography, ornament, branding —
 * is what "Creative Direction" names.
 *
 * CORRECTED DESIGN STANDARD (Ashley, after reviewing the first Phase 1
 * pass against her own supplied reference flyers): the target is polished,
 * visually rich, intentional florist advertising — elegant serif/script
 * typography, deliberate hierarchy, borders and flourishes, floral
 * imagery integrated into the composition, boutique-style branding,
 * intentional palettes, banners/badges/dividers/ornament where
 * appropriate, information-rich layouts when the occasion genuinely
 * calls for it. The FIRST Phase 1 pass wrongly treated "restrained" as
 * "sparse" — minimal text, minimal decoration, headline-only by default.
 * That was a real design-direction error, not just an incomplete field
 * list. This version corrects it: "restrained" means CONTROLLED and
 * INTENTIONAL, never empty. A design may legitimately be rich in ornament
 * while still passing every restraint/intentionality rule below — see
 * Part C's explicit split between `decorativeRestraint` (intentionality)
 * and `ornamentalDensity` (amount).
 *
 * Phase 1 scope, unchanged and still deliberately narrow:
 *   - define the bounded Creative Direction schema (finite enums only,
 *     no free-form fields where an enum can represent the decision);
 *   - define the hard graphicTextSlots/graphicTextLimits contract;
 *   - define deterministic, canonical-concept-aware category constraints
 *     for seven named creative families;
 *   - define ONE deterministic default-direction generator, so a valid,
 *     polished-not-sparse Creative Direction object exists even before
 *     Phase 3 lets a model choose among creative options;
 *   - define deterministic validation/clamping — never an AI call.
 *
 * Explicitly NOT Phase 1: no renderer change (public/flyer-renderer.js is
 * untouched — this object is not executed yet), no model call choosing
 * BETWEEN creative options (Phase 3), no final-rendered-artifact quality
 * inspection (Phase 4). This module produces a DIRECTION object only.
 *
 * Persistence: `asset.content.creative_direction` — the exact same
 * existing JSON column canonical_concept already lives in
 * (ai_generated_assets.content), scoped to assetType "flyer" only (the
 * only asset type this object's fields — composition/crop/typography/
 * branding placement — actually describe). No new table, no new column,
 * no migration. Revision inheritance mirrors marketing-canonical-
 * concept.js's inheritConcept: a parent's Creative Direction survives a
 * revision byte-for-byte unless a caller explicitly overrides a field —
 * Phase 1 defines no "explicit creative-direction change" detector (that
 * is Phase 3+ territory, once a model is actually choosing between
 * options), so every Phase-1-era revision simply inherits.
 *
 * Fact-safety note (corrected-architecture report, Part 4/6): every field
 * below is a finite enum, never free text — so this schema itself cannot
 * leak a present-tense inventory/availability claim ("fresh today," "in
 * stock," "we're open") the way free-form copy could. That class of
 * defect is already independently guarded where it actually lives — in
 * generated COPY, not layout — by detectUnverifiedInventoryStateClaim
 * (marketing-content-revision.js), which already runs on every caption
 * and every flyer's on-image text via evaluateMarketingOutput. This
 * module never duplicates that check or builds a second, competing
 * safe-phrase library; it only ever decides which text SLOTS exist and
 * how much room each has, never what the words say.
 */

// ---------------------------------------------------------------------------
// Part A: the Creative Direction schema — finite, explicit enums.
//
// occasionTreatment vs. compositionFamily (Ashley's own required
// distinction, never redundant):
//   - occasionTreatment answers "WHAT KIND of florist creative is this" —
//     the seven named families she supplied, chosen from the canonical
//     concept's own occasion/sympathy/promotion signals. It is the
//     primary, concept-driven selector.
//   - compositionFamily answers "WHAT STRUCTURAL SHAPE does the layout
//     take" — independent of occasion. Two posts can share
//     occasionTreatment "everyday_floral" while one uses a full-bleed
//     hero shape and another uses a framed panel — that is a real second
//     axis, not a restatement of the first. (Phase 1's deterministic
//     generator picks one structural shape per family below; Phase 3 is
//     where a model would genuinely choose between structural shapes
//     within a family.)
// `focalRegion` from the first Phase 1 pass is RETIRED here — it was
// genuinely redundant with `imagePlacement` (where the photo block sits
// in the whole composition) and `subjectPlacement` (where the subject
// sits within the photo itself); keeping all three would have been
// exactly the "two fields meaning the same thing" Ashley's correction
// explicitly ruled out.
// ---------------------------------------------------------------------------

export const CREATIVE_DIRECTION_VERSION = 2;

/** The seven named creative families — the primary, concept-driven
 * selector. elegant_editorial and boutique_floral are real, fully valid,
 * fully supported choices — Phase 1's own DETERMINISTIC default
 * generator just never picks them automatically for a generic request
 * (see resolveOccasionTreatment below); they exist now so Phase 3's
 * model-choice step has real options to choose between later. */
export const OCCASION_TREATMENTS = Object.freeze([
  "elegant_editorial",
  "boutique_floral",
  "sympathy_elegance",
  "seasonal_feature",
  "operational_notice",
  "promotional_feature",
  "everyday_floral"
]);

/** The structural composition shape — occasion-agnostic. Deliberately
 * excludes anything resembling a "split the frame in half" treatment:
 * that is exactly the shape of Ashley's own live-diagnosed regression
 * (the old forced "magazine" split), and is not being reintroduced here
 * under a new name. */
export const COMPOSITION_FAMILIES = Object.freeze([
  "hero_full_bleed", // one dominant photo, text in a defined region within it — no separate solid panel
  "layered_editorial", // a real panel/column carries the text, editorial-magazine balance between image and type
  "framed_panel", // a bordered/framed content block anchors the text, legibility-first but still decorated
  "banner_led" // a banner/ribbon element carries the headline, the photo supports it
]);

export const SUBJECT_PLACEMENTS = Object.freeze(["center", "left_third", "right_third", "lower_third", "full_bleed"]);
export const IMAGE_CROPS = Object.freeze(["tight", "medium", "wide_environmental"]);

/** Where the photo BLOCK sits within the overall composition — distinct
 * from subjectPlacement (where the subject sits within the photo). */
export const IMAGE_PLACEMENTS = Object.freeze(["full_bleed", "inset_panel", "framed_block", "corner_accent"]);
/** How much visual weight the photo carries relative to text/ornament. */
export const IMAGE_SCALES = Object.freeze(["dominant", "balanced", "supporting"]);

/** Where on-image text actually lives — Ashley's own explicit list of
 * legitimate homes for text (clean negative space, a dedicated panel, a
 * banner, a footer, a badge, a framed block, an integrated editorial
 * region), split into an upper/lower negative-space band. */
export const TEXT_REGIONS = Object.freeze([
  "negative_space_band_lower",
  "negative_space_band_upper",
  "dedicated_panel",
  "banner",
  "footer",
  "badge",
  "framed_block",
  "integrated_editorial_region"
]);

/** Typography personality — serif_script_pairing added: Ashley's own
 * reference flyers pair a serif headline with a script accent as ONE
 * coherent choice, not two separate decisions. */
export const TYPOGRAPHY_PERSONALITIES = Object.freeze(["editorial_serif", "clean_sans", "script_accent", "bold_display", "serif_script_pairing"]);

/** How dominant the headline type is. */
export const HEADLINE_SCALES = Object.freeze(["standard", "large", "oversized"]);

/** How much (if any) script typography is used, and where. */
export const SCRIPT_ACCENT_USAGES = Object.freeze(["none", "accent_word", "subhead_script", "full_script_headline"]);

/** The real text-role stack a Creative Direction commits to — replaces
 * the first pass's typographyHierarchy, which capped out at a
 * "full_stack" that was never actually defined. `headline_support_
 * service_cta` is the genuine 4-deep stack sympathy needs (headline +
 * supporting line + a service detail + CTA) — the deepest stack this
 * schema allows; nothing goes beyond it. graphicTextSlots (Part B) is
 * kept in sync with whichever value is chosen here by validation, so the
 * two can never silently disagree. */
export const HIERARCHY_DEPTHS = Object.freeze(["headline_only", "headline_plus_support", "headline_plus_cta", "headline_support_cta", "headline_support_service_cta"]);
// Ordinal weight for cross-field "is this hierarchy too deep for this
// family / too deep for this text density" checks — never exposed
// outside this module, purely an internal ordering.
const HIERARCHY_DEPTH_RANK = Object.freeze({
  headline_only: 0,
  headline_plus_support: 1,
  headline_plus_cta: 1,
  headline_support_cta: 2,
  headline_support_service_cta: 3
});

export const BRANDING_POSITIONS = Object.freeze(["top_center", "top_left", "bottom_center", "corner_watermark"]);
export const BRANDING_SCALES = Object.freeze(["subtle", "standard", "prominent"]);
export const BRAND_IDENTIFIERS = Object.freeze(["logo", "shop_name", "both"]);

/** How MUCH ornament — decoupled from `decorativeRestraint` (whether
 * that ornament is intentional). Rich is a fully legitimate, fully
 * supportable choice; it is not itself a defect. */
export const ORNAMENTAL_DENSITIES = Object.freeze(["minimal", "light", "moderate", "rich"]);

/** Whether the decoration actually present is controlled/purposeful.
 * "loose" is not a real creative choice this generator will ever make —
 * it exists so the validator has a concrete, real value to catch and
 * clamp on an untrusted/hand-built candidate (a future Phase 3 model
 * output, most likely) rather than modeling intentionality as an
 * unstructured judgment call. */
export const DECORATIVE_RESTRAINT_LEVELS = Object.freeze(["disciplined", "loose"]);

export const BORDER_STYLES = Object.freeze(["none", "hairline", "double_line", "ornamental_frame", "organic_floral_frame"]);
export const DIVIDER_STYLES = Object.freeze(["none", "simple_rule", "ornamental_flourish", "floral_sprig"]);
export const BADGE_STYLES = Object.freeze(["none", "circular_badge", "ribbon_badge", "wax_seal_style"]);
export const BANNER_STYLES = Object.freeze(["none", "ribbon_banner", "flat_banner", "torn_paper_banner"]);
export const DECORATIVE_MOTIFS = Object.freeze(["none", "floral_sprigs", "botanical_line_art", "watercolor_wash", "leaf_accents", "geometric_minimal"]);

export const TEXT_DENSITIES = Object.freeze(["sparse", "standard", "dense"]);
export const CTA_PROMINENCE_LEVELS = Object.freeze(["none", "subtle", "standard", "strong"]);

/** "gradient_band_lower" is the SAME lower-portion-only legibility band
 * flyer-templates.js/flyer-renderer.js already draw — never a new
 * full-panel color wash (see .claude/rules/marketing-studio.md's
 * explicit "no full-image or full-panel color wash/overlay of any kind"
 * rule; this enum can't represent one). framed_photo_block/bordered_
 * panel_with_photo_inset are the two non-full-bleed treatments a framed
 * or layered-editorial composition needs. */
export const BACKGROUND_TREATMENTS = Object.freeze(["full_bleed_photo", "gradient_band_lower", "flat_brand_color", "framed_photo_block", "bordered_panel_with_photo_inset"]);

export const NEGATIVE_SPACE_STRATEGIES = Object.freeze(["generous", "moderate", "minimal"]);

/** Emotional/design character. */
export const VISUAL_MOODS = Object.freeze(["bright_joyful", "warm_inviting", "quiet_respectful", "elegant_refined", "bold_celebratory", "romantic_soft", "playful_energetic"]);
/** Intended color-family behavior tied to occasion — a related but
 * genuinely distinct decision from visualMood (two posts can share a
 * mood and use different palette territory, or vice versa). */
export const PALETTE_MOODS = Object.freeze(["soft_pastel", "warm_luxury", "neutral_blush_ivory", "vibrant_seasonal", "classic_brand", "jewel_tone"]);

/** Every scalar-enum field name paired with its allowed value set — the
 * single source of truth Part G's validator walks. */
const ENUM_FIELDS = Object.freeze({
  occasionTreatment: OCCASION_TREATMENTS,
  compositionFamily: COMPOSITION_FAMILIES,
  subjectPlacement: SUBJECT_PLACEMENTS,
  imageCrop: IMAGE_CROPS,
  imagePlacement: IMAGE_PLACEMENTS,
  imageScale: IMAGE_SCALES,
  textRegion: TEXT_REGIONS,
  typographyPersonality: TYPOGRAPHY_PERSONALITIES,
  headlineScale: HEADLINE_SCALES,
  scriptAccentUsage: SCRIPT_ACCENT_USAGES,
  hierarchyDepth: HIERARCHY_DEPTHS,
  brandingPosition: BRANDING_POSITIONS,
  brandingScale: BRANDING_SCALES,
  brandIdentifier: BRAND_IDENTIFIERS,
  ornamentalDensity: ORNAMENTAL_DENSITIES,
  decorativeRestraint: DECORATIVE_RESTRAINT_LEVELS,
  borderStyle: BORDER_STYLES,
  dividerStyle: DIVIDER_STYLES,
  badgeStyle: BADGE_STYLES,
  bannerStyle: BANNER_STYLES,
  decorativeMotif: DECORATIVE_MOTIFS,
  textDensity: TEXT_DENSITIES,
  ctaProminence: CTA_PROMINENCE_LEVELS,
  backgroundTreatment: BACKGROUND_TREATMENTS,
  negativeSpaceStrategy: NEGATIVE_SPACE_STRATEGIES,
  visualMood: VISUAL_MOODS,
  paletteMood: PALETTE_MOODS
});

// Safe, polished-but-uncontroversial fallback for any field missing or
// failing validation — the everyday_floral baseline itself (see Part E),
// never the old sparse/bare shape. A clamp should never produce
// something LESS finished than the generator's own default would.
const SAFE_FIELD_DEFAULTS = Object.freeze({
  occasionTreatment: "everyday_floral",
  compositionFamily: "hero_full_bleed",
  subjectPlacement: "center",
  imageCrop: "medium",
  imagePlacement: "full_bleed",
  imageScale: "dominant",
  textRegion: "negative_space_band_lower",
  typographyPersonality: "serif_script_pairing",
  headlineScale: "large",
  scriptAccentUsage: "accent_word",
  hierarchyDepth: "headline_plus_support",
  brandingPosition: "top_center",
  brandingScale: "standard",
  brandIdentifier: "shop_name",
  ornamentalDensity: "light",
  decorativeRestraint: "disciplined",
  borderStyle: "hairline",
  dividerStyle: "floral_sprig",
  badgeStyle: "none",
  bannerStyle: "none",
  decorativeMotif: "leaf_accents",
  textDensity: "standard",
  ctaProminence: "none",
  backgroundTreatment: "full_bleed_photo",
  negativeSpaceStrategy: "moderate",
  visualMood: "warm_inviting",
  paletteMood: "classic_brand"
});

// ---------------------------------------------------------------------------
// Part B: the hard graphic-text contract.
// ---------------------------------------------------------------------------

/** Which text roles may legitimately appear ON the graphic. `brand` and
 * `headline` are effectively mandatory. `serviceDetail` is the sympathy-
 * specific fourth role (a service/delivery detail line — never invented
 * facts, only ever populated from real request/shop data upstream of
 * this module). Every other slot is opt-in, and — corrected rule — NOT
 * biased toward off by default; see Part E, where each family's own
 * hierarchyDepth decides the real starting shape. */
export const GRAPHIC_TEXT_SLOTS_DEFAULT = Object.freeze({
  brand: true,
  headline: true,
  supportingLine: false,
  serviceDetail: false,
  cta: false,
  phone: false
});

/** Hard character ceilings — never "shrink the font to fit," always "the
 * text doesn't belong on the graphic at this length." No future renderer
 * is permitted to solve overflow by shrinking text past legibility. */
export const GRAPHIC_TEXT_LIMITS_DEFAULT = Object.freeze({
  headlineMaxChars: 42,
  supportingLineMaxChars: 60,
  serviceDetailMaxChars: 70,
  ctaMaxChars: 30
});

// The real text-role stack each hierarchyDepth commits to — the
// authoritative mapping graphicTextSlots is validated against, so the
// two can never silently disagree about what's actually on the graphic.
const HIERARCHY_DEPTH_SLOTS = Object.freeze({
  headline_only: { supportingLine: false, serviceDetail: false, cta: false, phone: false },
  headline_plus_support: { supportingLine: true, serviceDetail: false, cta: false, phone: false },
  headline_plus_cta: { supportingLine: false, serviceDetail: false, cta: true },
  headline_support_cta: { supportingLine: true, serviceDetail: false, cta: true },
  headline_support_service_cta: { supportingLine: true, serviceDetail: true, cta: true }
});

// ---------------------------------------------------------------------------
// Part C: brand identifier resolution.
// ---------------------------------------------------------------------------

/**
 * Deterministic brand-identifier resolution (Phase 1 default only — see
 * this module's docstring: Phase 3 is where a model may actually choose
 * between logo/shop_name/both on creative merit). Never invents or
 * synthesizes a logo: a shop with no verified `logo_url` on file always
 * resolves to `shop_name`, full stop. An operational notice always shows
 * `shop_name` regardless of logo.
 */
export function resolveDefaultBrandIdentifier({ hasVerifiedLogo = false, occasionTreatment = null } = {}) {
  if (occasionTreatment === "operational_notice") return "shop_name";
  if (!hasVerifiedLogo) return "shop_name";
  // A logo genuinely exists, but Phase 1 has no creative-merit basis to
  // prefer it over the name — stays the same safe default until Phase 3
  // gives a model real grounds to choose otherwise. Phase 3 may
  // legitimately resolve to "logo" or "both" once it has real grounds to.
  return "shop_name";
}

/** Is `brandIdentifier` actually SUPPORTABLE — i.e. would choosing "logo"
 * or "both" require a logo that isn't actually verified on file? */
export function isBrandIdentifierSupported(brandIdentifier, { hasVerifiedLogo = false } = {}) {
  if (brandIdentifier === "logo" || brandIdentifier === "both") return hasVerifiedLogo;
  return brandIdentifier === "shop_name";
}

// ---------------------------------------------------------------------------
// occasionTreatment resolution — the primary, concept-driven selector.
// ---------------------------------------------------------------------------

/**
 * Resolves which of the seven named families this concept belongs to.
 * elegant_editorial and boutique_floral are never resolved here — they
 * are real, fully valid choices reachable by an explicit override (or,
 * later, Phase 3's model choice) but never the deterministic default for
 * an ordinary request; the deterministic default for anything not
 * sympathy/operational/promotional/seasonal is `everyday_floral`.
 */
export function resolveOccasionTreatment({ occasionCategory = null, sympathyClassification = null, promotionIntent = null } = {}) {
  if (sympathyClassification === "sympathy" || occasionCategory === "sympathy") return "sympathy_elegance";
  if (occasionCategory === "operational_notice") return "operational_notice";
  if (promotionIntent === "real_promotion") return "promotional_feature";
  if (occasionCategory === "holiday_seasonal") return "seasonal_feature";
  return "everyday_floral";
}

// ---------------------------------------------------------------------------
// Part D: category constraints — one real design vocabulary per family,
// deterministic, canonical-concept-aware. Reuses the canonical concept's
// OWN already-classified fields — never a second, independently-derived
// business-fact inference. This module only ever asks "given what the
// concept already decided, what does that mean for LAYOUT."
// ---------------------------------------------------------------------------

/**
 * Returns this concept's family constraints: `forced` fields a Creative
 * Direction MUST carry (win over any default/candidate), `forbidden`
 * enum values that must never appear on a matching field, `leaning` — the
 * DEFAULT starting point Part E's generator uses for this family (never
 * forced on a candidate, only ever the generator's own baseline), and
 * `ctaProminenceCeiling` (the loosest CTA prominence this family permits
 * — never a floor).
 */
export function getCategoryConstraints({ occasionCategory = null, sympathyClassification = null, promotionIntent = null, inventoryIntent = null, ctaIntent = null } = {}) {
  const occasionTreatment = resolveOccasionTreatment({ occasionCategory, sympathyClassification, promotionIntent });
  const hasCta = Boolean(ctaIntent) && ctaIntent !== "none";
  const isInventoryGrounded = inventoryIntent === "inventory_driven";

  const FAMILY_CONSTRAINTS = {
    everyday_floral: {
      forced: { occasionTreatment: "everyday_floral" },
      forbidden: {},
      leaning: {
        compositionFamily: "hero_full_bleed",
        imagePlacement: "full_bleed",
        imageScale: "dominant",
        backgroundTreatment: "full_bleed_photo",
        textRegion: "negative_space_band_lower",
        typographyPersonality: "serif_script_pairing",
        headlineScale: "large",
        scriptAccentUsage: "accent_word",
        hierarchyDepth: hasCta ? "headline_plus_cta" : "headline_plus_support",
        ornamentalDensity: "light",
        decorativeRestraint: "disciplined",
        borderStyle: "hairline",
        dividerStyle: "floral_sprig",
        decorativeMotif: "leaf_accents",
        brandingScale: "standard",
        textDensity: "standard",
        negativeSpaceStrategy: "moderate",
        visualMood: "warm_inviting",
        paletteMood: "classic_brand"
      },
      ctaProminenceCeiling: hasCta ? "standard" : "none"
    },

    elegant_editorial: {
      forced: { occasionTreatment: "elegant_editorial" },
      forbidden: {},
      leaning: {
        compositionFamily: "layered_editorial",
        imagePlacement: "framed_block",
        imageScale: "balanced",
        backgroundTreatment: "framed_photo_block",
        textRegion: "integrated_editorial_region",
        typographyPersonality: "serif_script_pairing",
        headlineScale: "oversized",
        scriptAccentUsage: "subhead_script",
        hierarchyDepth: hasCta ? "headline_plus_cta" : "headline_plus_support",
        ornamentalDensity: "moderate",
        decorativeRestraint: "disciplined",
        borderStyle: "double_line",
        dividerStyle: "ornamental_flourish",
        decorativeMotif: "botanical_line_art",
        brandingScale: "standard",
        textDensity: "standard",
        negativeSpaceStrategy: "generous",
        visualMood: "elegant_refined",
        paletteMood: "warm_luxury"
      },
      ctaProminenceCeiling: hasCta ? "standard" : "none"
    },

    boutique_floral: {
      forced: { occasionTreatment: "boutique_floral" },
      forbidden: {},
      leaning: {
        compositionFamily: "framed_panel",
        imagePlacement: "framed_block",
        imageScale: "balanced",
        backgroundTreatment: "bordered_panel_with_photo_inset",
        textRegion: "framed_block",
        typographyPersonality: "serif_script_pairing",
        headlineScale: "large",
        scriptAccentUsage: "subhead_script",
        hierarchyDepth: hasCta ? "headline_plus_cta" : "headline_plus_support",
        ornamentalDensity: "moderate",
        decorativeRestraint: "disciplined",
        borderStyle: "ornamental_frame",
        dividerStyle: "ornamental_flourish",
        badgeStyle: "circular_badge",
        decorativeMotif: "watercolor_wash",
        brandingScale: "prominent",
        textDensity: "standard",
        negativeSpaceStrategy: "moderate",
        visualMood: "romantic_soft",
        paletteMood: "soft_pastel"
      },
      ctaProminenceCeiling: hasCta ? "standard" : "none"
    },

    sympathy_elegance: {
      forced: {
        occasionTreatment: "sympathy_elegance",
        visualMood: "quiet_respectful",
        paletteMood: "neutral_blush_ivory",
        decorativeRestraint: "disciplined",
        bannerStyle: "none"
      },
      forbidden: {
        visualMood: ["bold_celebratory", "bright_joyful", "playful_energetic"],
        paletteMood: ["vibrant_seasonal", "jewel_tone"],
        compositionFamily: ["banner_led"],
        ornamentalDensity: ["rich"]
      },
      leaning: {
        compositionFamily: "framed_panel",
        imagePlacement: "inset_panel",
        imageScale: "balanced",
        backgroundTreatment: "bordered_panel_with_photo_inset",
        textRegion: "dedicated_panel",
        typographyPersonality: "serif_script_pairing",
        headlineScale: "standard",
        scriptAccentUsage: "accent_word",
        // Service detail + CTA only when the concept genuinely grounds
        // one (a real CTA intent) — never invented; see Part E.
        hierarchyDepth: hasCta ? "headline_support_service_cta" : "headline_plus_support",
        ornamentalDensity: "light",
        borderStyle: "organic_floral_frame",
        dividerStyle: "floral_sprig",
        badgeStyle: "none",
        decorativeMotif: "botanical_line_art",
        brandingScale: "standard",
        textDensity: "standard",
        negativeSpaceStrategy: "generous"
      },
      ctaProminenceCeiling: "subtle"
    },

    seasonal_feature: {
      forced: { occasionTreatment: "seasonal_feature" },
      forbidden: {},
      leaning: {
        compositionFamily: "hero_full_bleed",
        imagePlacement: "full_bleed",
        imageScale: "dominant",
        backgroundTreatment: "full_bleed_photo",
        textRegion: "negative_space_band_lower",
        typographyPersonality: "serif_script_pairing",
        headlineScale: "large",
        scriptAccentUsage: "accent_word",
        hierarchyDepth: "headline_plus_support",
        ornamentalDensity: "moderate",
        decorativeRestraint: "disciplined",
        dividerStyle: "floral_sprig",
        decorativeMotif: "floral_sprigs",
        brandingScale: "standard",
        textDensity: "standard",
        negativeSpaceStrategy: "moderate",
        visualMood: "playful_energetic",
        paletteMood: "vibrant_seasonal"
      },
      ctaProminenceCeiling: hasCta ? "standard" : "none"
    },

    operational_notice: {
      forced: {
        occasionTreatment: "operational_notice",
        brandIdentifier: "shop_name",
        compositionFamily: "framed_panel"
      },
      forbidden: { visualMood: ["bold_celebratory"], scriptAccentUsage: ["full_script_headline"] },
      leaning: {
        imagePlacement: "inset_panel",
        imageScale: "supporting",
        backgroundTreatment: "framed_photo_block",
        textRegion: "dedicated_panel",
        typographyPersonality: "clean_sans",
        headlineScale: "large",
        scriptAccentUsage: "none",
        // Independent-review fix: this was unconditionally
        // "headline_support_cta" regardless of whether the notice
        // actually has a real CTA — a notice with nothing to call about
        // ("we're closing early today") got an invented CTA slot forced
        // on. Gated on hasCta exactly like every other family now.
        hierarchyDepth: hasCta ? "headline_support_cta" : "headline_plus_support",
        ornamentalDensity: "light",
        decorativeRestraint: "disciplined",
        borderStyle: "hairline",
        dividerStyle: "simple_rule",
        decorativeMotif: "leaf_accents",
        brandingScale: "standard",
        textDensity: "dense",
        negativeSpaceStrategy: "minimal",
        visualMood: "warm_inviting"
      },
      // Legibility first — an operational notice may need a firm CTA
      // (call now, order now) at real prominence.
      ctaProminenceCeiling: "standard"
    },

    promotional_feature: {
      forced: { occasionTreatment: "promotional_feature" },
      forbidden: {},
      leaning: {
        compositionFamily: "banner_led",
        imagePlacement: "framed_block",
        imageScale: "balanced",
        backgroundTreatment: "framed_photo_block",
        textRegion: "banner",
        typographyPersonality: "bold_display",
        headlineScale: "oversized",
        scriptAccentUsage: "accent_word",
        // Same independent-review fix as operational_notice above: a
        // real promotion doesn't always carry an extractable CTA
        // (promotionIntent and ctaIntent are separately classified) —
        // never invent the CTA slot just because the family is
        // promotional.
        hierarchyDepth: hasCta ? "headline_support_cta" : "headline_plus_support",
        ornamentalDensity: "moderate",
        decorativeRestraint: "disciplined",
        bannerStyle: "ribbon_banner",
        badgeStyle: "ribbon_badge",
        decorativeMotif: "leaf_accents",
        brandingScale: "standard",
        textDensity: "standard",
        negativeSpaceStrategy: "moderate",
        visualMood: "bold_celebratory",
        paletteMood: "classic_brand"
      },
      // A real promotion may justify the loudest CTA this schema allows.
      // No fake offer/discount/deadline/availability is ever implied by
      // this table — that remains strictly a copy-content matter (guarded
      // by detectUnverifiedInventoryStateClaim), never something a
      // layout constraint could imply on its own.
      ctaProminenceCeiling: "strong"
    }
  };

  const chosen = FAMILY_CONSTRAINTS[occasionTreatment];
  return { ...chosen, occasionTreatment, inventoryGroundedGuidance: isInventoryGrounded };
}

// ---------------------------------------------------------------------------
// Part E: the one deterministic default-direction generator.
// ---------------------------------------------------------------------------

/**
 * Builds a complete, valid Creative Direction object from the canonical
 * concept plus verified shop brand information. Always returns a fully
 * valid object (runs it through validateCreativeDirection before
 * returning).
 *
 * Corrected baseline: for an ordinary thin-context request ("Create
 * today's Facebook post for Lilies in Bloom" — everyday_floral, no CTA
 * intent, no promotion, no operational facts) this resolves to a
 * polished florist-hero flyer — hero floral image, a strong headline, a
 * short supporting line, elegant serif/script pairing, a tasteful
 * hairline border and a small floral divider, one clear brand identifier
 * — never the old bare/sparse shape, and never the old stacked-strips/
 * paragraph-body-over-the-photo shape the live test actually produced.
 */
export function buildDeterministicCreativeDirection({ canonicalConcept = null, shopBrand = {} } = {}) {
  const concept = canonicalConcept || {};
  const occasionCategory = concept.occasionCategory || "general";
  const ctaIntent = concept.ctaIntent || "none";
  const hasCta = Boolean(ctaIntent) && ctaIntent !== "none";
  const hasVerifiedLogo = Boolean(shopBrand?.logoUrl);

  const constraints = getCategoryConstraints({
    occasionCategory,
    sympathyClassification: concept.sympathyClassification || null,
    promotionIntent: concept.promotionIntent || null,
    inventoryIntent: concept.inventoryIntent || null,
    ctaIntent
  });

  const base = {
    version: CREATIVE_DIRECTION_VERSION,
    ...SAFE_FIELD_DEFAULTS,
    brandIdentifier: resolveDefaultBrandIdentifier({ hasVerifiedLogo, occasionTreatment: constraints.occasionTreatment }),
    ctaProminence: hasCta ? "subtle" : "none",
    graphicTextSlots: {
      ...GRAPHIC_TEXT_SLOTS_DEFAULT,
      cta: ctaIntent === "call_shop" || ctaIntent === "order_now",
      phone: ctaIntent === "call_shop"
    },
    graphicTextLimits: { ...GRAPHIC_TEXT_LIMITS_DEFAULT }
  };

  // The family's own leaning is the real starting point — applied over
  // the safe baseline, then forced fields win over that.
  const withLeaning = { ...base, ...constraints.leaning };
  const withForced = { ...withLeaning, ...constraints.forced };

  // hierarchyDepth decides graphicTextSlots.cta/phone here too — but
  // independent-review fix: gated on hasCta explicitly, not just on
  // which depth string a family happened to lean toward. Every family's
  // own leaning above is already hasCta-conditioned, so this should
  // never actually fire with hasCta false; kept as an explicit,
  // self-documenting guard against a future family definition
  // reintroducing the same invented-CTA bug (a hardcoded CTA-bearing
  // depth with no hasCta gate).
  if (hasCta && (withForced.hierarchyDepth === "headline_plus_cta" || withForced.hierarchyDepth === "headline_support_cta" || withForced.hierarchyDepth === "headline_support_service_cta")) {
    withForced.graphicTextSlots = { ...withForced.graphicTextSlots, cta: true, phone: ctaIntent === "call_shop" };
  }

  const { direction } = validateCreativeDirection(withForced, {
    canonicalConcept: concept,
    hasVerifiedLogo
  });
  return direction;
}

// ---------------------------------------------------------------------------
// Part G: deterministic validation / clamping. No AI call, ever.
// ---------------------------------------------------------------------------

function clampEnum(value, allowed, fallback, errors, fieldName) {
  if (typeof value === "string" && allowed.includes(value)) return value;
  errors.push(`${fieldName}: "${value}" is not a recognized value — reset to "${fallback}".`);
  return fallback;
}

/**
 * Validates and normalizes a candidate Creative Direction object. Never
 * throws, never returns a partial/invalid object — always returns
 * `{ direction, valid, errors }`. `valid` reports whether the INPUT
 * already satisfied every rule (false whenever any clamp fired);
 * `errors` names exactly what was wrong, for observability.
 */
export function validateCreativeDirection(candidate, { canonicalConcept = null, hasVerifiedLogo = false } = {}) {
  const errors = [];
  const src = candidate && typeof candidate === "object" ? candidate : {};
  const out = { version: CREATIVE_DIRECTION_VERSION };

  for (const [field, allowed] of Object.entries(ENUM_FIELDS)) {
    out[field] = clampEnum(src[field], allowed, SAFE_FIELD_DEFAULTS[field], errors, field);
  }

  // graphicTextSlots: unknown keys dropped, every known key coerced to a
  // real boolean, defaulting to the safe (headline/brand-only) shape.
  const rawSlots = src.graphicTextSlots && typeof src.graphicTextSlots === "object" ? src.graphicTextSlots : {};
  out.graphicTextSlots = {
    brand: Boolean(rawSlots.brand ?? GRAPHIC_TEXT_SLOTS_DEFAULT.brand),
    headline: Boolean(rawSlots.headline ?? GRAPHIC_TEXT_SLOTS_DEFAULT.headline),
    supportingLine: Boolean(rawSlots.supportingLine ?? GRAPHIC_TEXT_SLOTS_DEFAULT.supportingLine),
    serviceDetail: Boolean(rawSlots.serviceDetail ?? GRAPHIC_TEXT_SLOTS_DEFAULT.serviceDetail),
    cta: Boolean(rawSlots.cta ?? GRAPHIC_TEXT_SLOTS_DEFAULT.cta),
    phone: Boolean(rawSlots.phone ?? GRAPHIC_TEXT_SLOTS_DEFAULT.phone)
  };

  if (!out.graphicTextSlots.headline) {
    errors.push("graphicTextSlots.headline was disabled — headline is mandatory, re-enabled.");
    out.graphicTextSlots.headline = true;
  }
  if (!out.graphicTextSlots.brand) {
    errors.push("graphicTextSlots.brand was disabled — branding may never be omitted, re-enabled.");
    out.graphicTextSlots.brand = true;
  }
  if (out.graphicTextSlots.phone && !out.graphicTextSlots.cta) {
    errors.push("graphicTextSlots.phone was enabled without graphicTextSlots.cta — a bare phone number needs a CTA context, disabled.");
    out.graphicTextSlots.phone = false;
  }
  if (out.graphicTextSlots.serviceDetail && !out.graphicTextSlots.supportingLine) {
    errors.push("graphicTextSlots.serviceDetail was enabled without graphicTextSlots.supportingLine — a service detail needs a supporting line above it, disabled.");
    out.graphicTextSlots.serviceDetail = false;
  }

  // hierarchyDepth is authoritative over the slot shape: whatever depth
  // survived enum clamping above, graphicTextSlots is brought into sync
  // with it — the two can never silently disagree about what's on the
  // graphic. This directly replaces the first pass's blanket
  // "sparse means turn everything off" bias with a real, named contract.
  const requiredSlots = HIERARCHY_DEPTH_SLOTS[out.hierarchyDepth];
  for (const [key, required] of Object.entries(requiredSlots)) {
    if (Boolean(out.graphicTextSlots[key]) !== Boolean(required)) {
      errors.push(`graphicTextSlots.${key} did not match hierarchyDepth "${out.hierarchyDepth}" — synchronized.`);
      out.graphicTextSlots[key] = required;
    }
  }
  // A phone slot is only ever meaningful when the concept's own CTA
  // intent actually calls for a phone call — hierarchyDepth alone (a
  // pure text-shape decision) never turns it on by itself.
  const ctaIntentForPhone = (canonicalConcept || {}).ctaIntent || null;
  if (out.graphicTextSlots.phone && ctaIntentForPhone !== "call_shop") {
    errors.push('graphicTextSlots.phone was enabled without a "call_shop" ctaIntent behind it — disabled.');
    out.graphicTextSlots.phone = false;
  }

  // graphicTextLimits: numeric, positive, bounded to the documented
  // ceilings.
  const rawLimits = src.graphicTextLimits && typeof src.graphicTextLimits === "object" ? src.graphicTextLimits : {};
  out.graphicTextLimits = {};
  for (const [key, ceiling] of Object.entries(GRAPHIC_TEXT_LIMITS_DEFAULT)) {
    const v = rawLimits[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= ceiling) {
      out.graphicTextLimits[key] = v;
    } else {
      if (v !== undefined) errors.push(`graphicTextLimits.${key}: ${v} is out of bounds (1–${ceiling}) — reset to ${ceiling}.`);
      out.graphicTextLimits[key] = ceiling;
    }
  }

  // textDensity vs. hierarchyDepth: a real bounds check, not a full
  // derivation — a family may legitimately choose "standard" or "dense"
  // at almost any depth (an operational notice's supporting line alone
  // can carry a lot of real factual text), but the two extremes are
  // always a genuine contradiction.
  const depthRank = HIERARCHY_DEPTH_RANK[out.hierarchyDepth] ?? 0;
  if (depthRank >= 3 && out.textDensity === "sparse") {
    errors.push(`textDensity "sparse" is incompatible with the full 4-role hierarchy ("${out.hierarchyDepth}") — raised to "standard".`);
    out.textDensity = "standard";
  }
  if (depthRank === 0 && out.textDensity === "dense") {
    errors.push('textDensity "dense" is incompatible with a headline-only hierarchy — lowered to "sparse".');
    out.textDensity = "sparse";
  }

  const concept = canonicalConcept || {};
  const occasionCategory = concept.occasionCategory || null;
  const conceptOccasionTreatment = resolveOccasionTreatment({
    occasionCategory,
    sympathyClassification: concept.sympathyClassification || null,
    promotionIntent: concept.promotionIntent || null
  });
  const isSympathy = conceptOccasionTreatment === "sympathy_elegance";
  const isOperationalNotice = conceptOccasionTreatment === "operational_notice";
  const isPromotional = conceptOccasionTreatment === "promotional_feature";
  const ctaIntent = concept.ctaIntent || null;

  // occasionTreatment itself: a candidate may only ever claim
  // sympathy_elegance/operational_notice/promotional_feature when the
  // concept actually says so — elegant_editorial/boutique_floral/
  // seasonal_feature/everyday_floral remain free creative choices within
  // a non-forced concept, never clamped away from each other.
  if ((isSympathy || isOperationalNotice || isPromotional) && out.occasionTreatment !== conceptOccasionTreatment) {
    errors.push(`occasionTreatment "${out.occasionTreatment}" contradicts the concept's own classification ("${conceptOccasionTreatment}") — corrected.`);
    out.occasionTreatment = conceptOccasionTreatment;
  }
  if (!isSympathy && !isOperationalNotice && !isPromotional && ["sympathy_elegance", "operational_notice", "promotional_feature"].includes(out.occasionTreatment)) {
    errors.push(`occasionTreatment "${out.occasionTreatment}" requires a concept classification this request doesn't have — reset to "everyday_floral".`);
    out.occasionTreatment = "everyday_floral";
  }

  // Brand identifier vs. verified logo — never promise a logo Florisyn
  // has no real asset for.
  if (!isBrandIdentifierSupported(out.brandIdentifier, { hasVerifiedLogo })) {
    errors.push(`brandIdentifier "${out.brandIdentifier}" requires a verified logo this shop doesn't have on file — reset to "shop_name".`);
    out.brandIdentifier = "shop_name";
  }

  // Operational notice constraints.
  if (isOperationalNotice) {
    if (out.brandIdentifier !== "shop_name" && out.brandIdentifier !== "both") {
      errors.push('An operational notice must show the shop name explicitly — brandIdentifier reset to "shop_name".');
      out.brandIdentifier = "shop_name";
    }
    if (out.compositionFamily !== "framed_panel") {
      errors.push(`An operational notice must use the framed_panel composition, not "${out.compositionFamily}".`);
      out.compositionFamily = "framed_panel";
    }
    if (out.scriptAccentUsage === "full_script_headline") {
      errors.push("A legibility-critical operational notice cannot use a full script headline — reset to a small accent.");
      out.scriptAccentUsage = "accent_word";
    }
  }

  // Sympathy constraints — no celebratory visual treatment, ever.
  if (isSympathy) {
    if (["bold_celebratory", "bright_joyful", "playful_energetic"].includes(out.visualMood)) {
      errors.push(`A sympathy request had visualMood "${out.visualMood}" — reset to "quiet_respectful".`);
      out.visualMood = "quiet_respectful";
    }
    if (["vibrant_seasonal", "jewel_tone"].includes(out.paletteMood)) {
      errors.push(`A sympathy request had paletteMood "${out.paletteMood}" — reset to "neutral_blush_ivory".`);
      out.paletteMood = "neutral_blush_ivory";
    }
    if (out.compositionFamily === "banner_led" || out.bannerStyle !== "none") {
      errors.push("A sympathy request had a banner treatment — banners read as festive, removed.");
      if (out.compositionFamily === "banner_led") out.compositionFamily = "framed_panel";
      out.bannerStyle = "none";
    }
    if (out.ornamentalDensity === "rich") {
      errors.push('A sympathy request had ornamentalDensity "rich" — clamped to "light".');
      out.ornamentalDensity = "light";
    }
    if (out.ctaProminence !== "none" && out.ctaProminence !== "subtle") {
      errors.push(`A sympathy request had ctaProminence "${out.ctaProminence}" — clamped to "subtle".`);
      out.ctaProminence = "subtle";
    }
  }

  // Excessive hierarchy for a simple everyday post — the 4-role stack is
  // reserved for sympathy/operational/promotional, where a service
  // detail or offer line genuinely earns its place.
  if (out.occasionTreatment === "everyday_floral" && out.hierarchyDepth === "headline_support_service_cta") {
    errors.push("everyday_floral had the full 4-role hierarchy — that depth is reserved for sympathy/operational/promotional; lowered.");
    out.hierarchyDepth = ctaIntent && ctaIntent !== "none" ? "headline_plus_cta" : "headline_plus_support";
    for (const [key, required] of Object.entries(HIERARCHY_DEPTH_SLOTS[out.hierarchyDepth])) out.graphicTextSlots[key] = required;
  }

  // Rich ornament + loose (unintentional) restraint is the one real
  // "amount vs. intentionality" contradiction: a design may be as rich
  // as a family allows AS LONG AS it's disciplined. Normalizes toward
  // discipline rather than reducing richness — Phase 1's own generator
  // never produces "loose" in the first place; this only ever catches an
  // untrusted candidate.
  if (out.ornamentalDensity === "rich" && out.decorativeRestraint === "loose") {
    errors.push('ornamentalDensity "rich" paired with decorativeRestraint "loose" reads as clutter, not richness — restraint corrected to "disciplined".');
    out.decorativeRestraint = "disciplined";
  }

  // Banner/badge styles selected when the corresponding region is not
  // actually in use — a decorative style with nowhere to live.
  if (out.bannerStyle !== "none" && out.textRegion !== "banner" && out.compositionFamily !== "banner_led") {
    errors.push(`bannerStyle "${out.bannerStyle}" was selected but no banner region/composition is in use — reset to "none".`);
    out.bannerStyle = "none";
  }
  if (out.badgeStyle !== "none" && out.textRegion !== "badge" && out.occasionTreatment !== "promotional_feature" && out.occasionTreatment !== "boutique_floral") {
    errors.push(`badgeStyle "${out.badgeStyle}" was selected but no badge region/family is in use — reset to "none".`);
    out.badgeStyle = "none";
  }

  // Independent-review fix: compositionFamily (the structural shape) was
  // never cross-checked against imagePlacement/backgroundTreatment at
  // all — a candidate could claim a framed/paneled structural shape
  // while separately claiming a plain full-bleed photo, an internally
  // contradictory description of the same layout.
  //
  // compositionFamily is treated as AUTHORITATIVE over both
  // imagePlacement and backgroundTreatment together (not just
  // imagePlacement alone) — correcting only one of the two here would
  // just have the imagePlacement/backgroundTreatment mutual-consistency
  // check below immediately flip it back, fighting this rule instead of
  // resolving it. banner_led is deliberately left unconstrained — a
  // banner can carry the headline over either a full-bleed photo or a
  // framed one, so it has no single required placement (unlike the
  // other three families, whose own names/definitions in Part A commit
  // to one or the other).
  const FRAMED_COMPOSITIONS = ["framed_panel", "layered_editorial"];
  const FULL_BLEED_COMPOSITIONS = ["hero_full_bleed"];
  if (FRAMED_COMPOSITIONS.includes(out.compositionFamily)) {
    if (out.imagePlacement === "full_bleed") {
      errors.push(`compositionFamily "${out.compositionFamily}" requires a framed/paneled photo treatment, not imagePlacement "full_bleed" — corrected to "framed_block".`);
      out.imagePlacement = "framed_block";
    }
    if (out.backgroundTreatment === "full_bleed_photo") {
      errors.push(`compositionFamily "${out.compositionFamily}" requires a framed/paneled photo treatment, not backgroundTreatment "full_bleed_photo" — corrected to "framed_photo_block".`);
      out.backgroundTreatment = "framed_photo_block";
    }
  }
  if (FULL_BLEED_COMPOSITIONS.includes(out.compositionFamily)) {
    if (out.imagePlacement !== "full_bleed") {
      errors.push(`compositionFamily "${out.compositionFamily}" requires a full-bleed photo, not imagePlacement "${out.imagePlacement}" — corrected to "full_bleed".`);
      out.imagePlacement = "full_bleed";
    }
    if (["framed_photo_block", "bordered_panel_with_photo_inset"].includes(out.backgroundTreatment)) {
      errors.push(`compositionFamily "${out.compositionFamily}" requires a full-bleed photo, not backgroundTreatment "${out.backgroundTreatment}" — corrected to "full_bleed_photo".`);
      out.backgroundTreatment = "full_bleed_photo";
    }
  }

  // Image placement vs. background treatment — mutually exclusive
  // descriptions of the same photo must agree. Runs AFTER the
  // compositionFamily reconciliation above, so for a framed/full-bleed
  // composition the two fields already agree and neither branch below
  // fires; this only ever still catches a contradiction compositionFamily
  // itself has no opinion on (e.g. banner_led with mismatched placement/
  // background).
  if (out.backgroundTreatment === "full_bleed_photo" && out.imagePlacement !== "full_bleed") {
    errors.push(`backgroundTreatment "full_bleed_photo" contradicts imagePlacement "${out.imagePlacement}" — imagePlacement corrected to "full_bleed".`);
    out.imagePlacement = "full_bleed";
  }
  if (["framed_photo_block", "bordered_panel_with_photo_inset"].includes(out.backgroundTreatment) && out.imagePlacement === "full_bleed") {
    errors.push(`backgroundTreatment "${out.backgroundTreatment}" contradicts imagePlacement "full_bleed" — imagePlacement corrected to "framed_block".`);
    out.imagePlacement = "framed_block";
  }
  // Image placement vs. text region — a full-bleed photo leaves no room
  // for a separate solid panel/framed-block/editorial-column region.
  if (out.imagePlacement === "full_bleed" && ["dedicated_panel", "framed_block", "integrated_editorial_region"].includes(out.textRegion)) {
    errors.push(`imagePlacement "full_bleed" contradicts textRegion "${out.textRegion}" — textRegion corrected to "negative_space_band_lower".`);
    out.textRegion = "negative_space_band_lower";
  }

  // No real CTA intent → no CTA anywhere: prominence, the CTA/phone
  // slots, AND a CTA-bearing hierarchy depth are all invented emphasis
  // for something that isn't there. Independent-review fix: the
  // original version of this rule only triggered on `ctaProminence !==
  // "none"` — but a family's own hierarchyDepth could (and, for
  // operational_notice/promotional_feature, actually did) force
  // graphicTextSlots.cta = true while ctaProminence stayed "none",
  // slipping an invented CTA slot past this guard entirely. This is now
  // the single authoritative "no real CTA intent" check — it fires on
  // EITHER symptom, not just prominence. The reverse (a real CTA intent
  // but a quiet/no on-graphic CTA) is a legitimate restrained creative
  // choice and is never forced the other way.
  if ((!ctaIntent || ctaIntent === "none") && (out.ctaProminence !== "none" || out.graphicTextSlots.cta || out.graphicTextSlots.phone)) {
    errors.push(`An invented CTA (ctaProminence "${out.ctaProminence}", graphicTextSlots.cta ${out.graphicTextSlots.cta}) was set with no real ctaIntent behind it — removed.`);
    out.ctaProminence = "none";
    if (["headline_plus_cta", "headline_support_cta", "headline_support_service_cta"].includes(out.hierarchyDepth)) {
      out.hierarchyDepth = "headline_plus_support";
    }
    // Re-sync every slot to the (possibly just-demoted) hierarchyDepth's
    // real required shape — not just cta/phone — so a demotion out of
    // headline_support_service_cta also correctly clears serviceDetail.
    for (const [key, required] of Object.entries(HIERARCHY_DEPTH_SLOTS[out.hierarchyDepth])) out.graphicTextSlots[key] = required;
  }
  // Promotional CTA prominence without real promotion intent — "strong"
  // is reserved for a real promotion; anything else is capped.
  if (out.ctaProminence === "strong" && concept.promotionIntent !== "real_promotion") {
    errors.push('ctaProminence "strong" requires a real promotionIntent — capped to "standard".');
    out.ctaProminence = "standard";
  }

  return { direction: out, valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Part H: revision inheritance — mirrors inheritConcept exactly.
// ---------------------------------------------------------------------------

/**
 * A revision's starting Creative Direction: the parent's object,
 * byte-for-byte, with only explicitly-supplied `overrides` applied.
 * Phase 1 defines no detector for an "explicit creative-direction change
 * request" (that's Phase 3+) — every Phase-1-era revision calls this
 * with NO overrides, so the whole object survives unchanged. Returns
 * `null` when there is no parent to inherit from (a pre-Phase-1 asset) —
 * callers fall back to buildDeterministicCreativeDirection for that
 * case, the same "backfill a concept-less legacy asset" pattern
 * buildRevisedConcept already uses for canonical_concept.
 */
export function inheritCreativeDirection(parentDirection, overrides = {}) {
  if (!parentDirection || typeof parentDirection !== "object") return null;
  const next = { ...parentDirection, ...overrides, version: CREATIVE_DIRECTION_VERSION };
  if (overrides.graphicTextSlots) next.graphicTextSlots = { ...parentDirection.graphicTextSlots, ...overrides.graphicTextSlots };
  if (overrides.graphicTextLimits) next.graphicTextLimits = { ...parentDirection.graphicTextLimits, ...overrides.graphicTextLimits };
  return next;
}
