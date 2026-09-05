/**
 * Premium Creative Director (Batch 5.1, "Premium Creative quality
 * upgrade").
 *
 * Real problem this closes: a real staging acceptance test (Ashley's
 * Homecoming request) proved the OpenAI-bound image prompt
 * (buildBackgroundPromptFromBrief in marketing-premium-creative-
 * orchestrator.js) reads only 4 of the ~25 fields the existing, already
 * well-designed marketing-creative-direction.js system computes
 * (visualMood, paletteMood, compositionFamily, imageScale) — every other
 * field (textRegion, hierarchyDepth, ctaProminence, brandingPosition/
 * scale, subjectPlacement, imageCrop, imagePlacement, backgroundTreatment,
 * negativeSpaceStrategy, occasionTreatment, typographyPersonality,
 * ornament/border/divider/badge/banner/motif) is computed but never
 * communicated to the image model at all. The result: a generic,
 * template-shaped image regardless of occasion, objective, or hierarchy —
 * not because the creative-direction system is wrong, but because almost
 * none of its decisions ever reach OpenAI.
 *
 * This module is the missing translation layer — and ONLY that. It does
 * not decide layout (marketing-creative-direction.js's enums/validator
 * remain the one authority for that) and it does not decide facts
 * (marketing-openai-creative-brief.js's factsAllowed/deterministicText
 * split remains the one authority for that). It takes the two already-
 * computed, already-validated objects — canonicalConcept and
 * creativeDirection — and turns their enum decisions into real
 * advertising-photography English an image model can act on.
 *
 * Pure and deterministic by construction:
 *   - no network call, no randomness, no read from any store;
 *   - every sentence comes from a FIXED phrase dictionary keyed by a
 *     known enum value — an unrecognized/garbage value for any field
 *     safely falls back to a generic, still-polished phrase or is
 *     omitted entirely; the raw field value itself is NEVER interpolated
 *     into the output. This is what makes the "no raw business-fact
 *     leakage" requirement structural rather than a matter of care: this
 *     module never receives factSafeCopyPlan or verifiedShopBrandData at
 *     all, so there is no fact for it to leak in the first place, and a
 *     future caller who (by mistake) passed a canonicalConcept/
 *     creativeDirection field containing attacker- or user-controlled
 *     text still cannot get that raw text echoed into the prompt —
 *     everything is dictionary-mapped, nothing is interpolated verbatim
 *     except the module's own fixed vocabulary.
 *   - typographyPersonality is translated ONLY into compositional
 *     negative-space guidance ("leave clean space suited to elegant
 *     serif type") — never into an instruction to render literal
 *     letterforms; the standing rule ("never ask an image-generation
 *     model to render literal words, numbers, or signage" —
 *     .claude/rules/marketing-studio.md) is preserved untouched by every
 *     sentence this module produces.
 */

import {
  COMPOSITION_FAMILIES,
  SUBJECT_PLACEMENTS,
  IMAGE_CROPS,
  IMAGE_PLACEMENTS,
  IMAGE_SCALES,
  TEXT_REGIONS,
  TYPOGRAPHY_PERSONALITIES,
  HEADLINE_SCALES,
  BRANDING_POSITIONS,
  BRANDING_SCALES,
  ORNAMENTAL_DENSITIES,
  BORDER_STYLES,
  DIVIDER_STYLES,
  BADGE_STYLES,
  BANNER_STYLES,
  DECORATIVE_MOTIFS,
  CTA_PROMINENCE_LEVELS,
  BACKGROUND_TREATMENTS,
  NEGATIVE_SPACE_STRATEGIES,
  VISUAL_MOODS,
  PALETTE_MOODS,
  OCCASION_TREATMENTS
} from "./marketing-creative-direction.js";

export const CREATIVE_DIRECTOR_VERSION = 1;

// ---------------------------------------------------------------------------
// Fixed phrase dictionaries — one entry per real enum value. Every
// dictionary below is tested (tests/marketing-creative-director.test.js)
// for 1:1 coverage against the real enum arrays imported above, so a
// future addition to marketing-creative-direction.js's own enums is
// caught here rather than silently falling back to a generic phrase
// forever.
// ---------------------------------------------------------------------------

const OCCASION_TREATMENT_FRAMING = Object.freeze({
  elegant_editorial: "This is an elegant editorial florist advertisement — think a high-end magazine floral feature, refined and considered.",
  boutique_floral: "This is an intimate boutique florist advertisement — think an artisanal, hand-crafted flower-shop feature.",
  sympathy_elegance: "This is a quiet, respectful sympathy tribute design — hushed and dignified, never celebratory, never festive.",
  seasonal_feature: "This is an energetic seasonal campaign feature — celebratory and tied to the season, never generic.",
  operational_notice: "This is a clean, legibility-first operational notice design — restrained and clear, never festive or decorative.",
  promotional_feature: "This is a bold, confident promotional advertisement — attention-grabbing, not shy.",
  everyday_floral: "This is a polished, professional everyday florist advertisement.",
  // Batch 6 ("Premium Creative quality architecture"): the one family
  // this framing sentence must actively discourage advertisement-style
  // composition for — the photography itself is the whole point.
  photo_forward_social: "This is a relaxed, photo-forward lifestyle social post — the photography itself is the entire message, not a backdrop for an advertisement."
});

const COMPOSITION_FAMILY_PHRASES = Object.freeze({
  hero_full_bleed: "a single dominant, full-bleed hero photograph",
  layered_editorial: "a layered editorial composition that balances the photograph against open type space, magazine-style",
  framed_panel: "a bordered, framed photographic panel that anchors the layout",
  banner_led: "a photograph supporting a bold, banner-led headline treatment"
});

const SUBJECT_PLACEMENT_PHRASES = Object.freeze({
  center: "the subject placed centrally",
  left_third: "the subject placed in the left third of the frame, deliberately off-center",
  right_third: "the subject placed in the right third of the frame, deliberately off-center",
  lower_third: "the subject placed in the lower third of the frame",
  full_bleed: "the subject filling the frame edge-to-edge"
});

const IMAGE_CROP_PHRASES = Object.freeze({
  tight: "a tight, close-up crop",
  medium: "a medium crop with genuine room to breathe",
  wide_environmental: "a wide, environmental crop that shows real surroundings"
});

const IMAGE_PLACEMENT_PHRASES = Object.freeze({
  full_bleed: "the photograph filling the entire frame",
  inset_panel: "the photograph presented as an inset panel within the layout",
  framed_block: "the photograph presented within a clearly framed block",
  corner_accent: "the photograph used as a smaller corner accent rather than the whole frame"
});

const IMAGE_SCALE_PHRASES = Object.freeze({
  dominant: "the photograph carrying the dominant visual weight of the composition",
  balanced: "the photograph sharing visual weight evenly with the surrounding design",
  supporting: "the photograph playing a supporting role to the surrounding design"
});

const VISUAL_MOOD_PHRASES = Object.freeze({
  bright_joyful: "bright, joyful, high-key natural light",
  warm_inviting: "warm, inviting, golden-hour natural light",
  quiet_respectful: "soft, quiet, muted, respectful natural light",
  elegant_refined: "elegant, refined, studio-quality lighting",
  bold_celebratory: "bold, celebratory, higher-contrast lighting",
  romantic_soft: "romantic, soft-focus, diffused natural light",
  playful_energetic: "playful, energetic, vibrant natural light"
});

const PALETTE_MOOD_PHRASES = Object.freeze({
  soft_pastel: "a soft pastel color palette",
  warm_luxury: "a warm, luxury color palette — deep golds, creams, rich greens",
  neutral_blush_ivory: "a neutral, blush-and-ivory color palette",
  vibrant_seasonal: "a vibrant, seasonal color palette",
  classic_brand: "a classic, timeless color palette",
  jewel_tone: "a rich, jewel-tone color palette"
});

// The single most important dictionary in this module: this is the
// concrete translation of "leave room for text" that the old 4-field
// prompt never expressed at all — the direct fix for "flowers around a
// blank area" reading as an accident rather than an intentional
// composition.
const TEXT_REGION_PHRASES = Object.freeze({
  negative_space_band_lower: "a deliberately clean, softly out-of-focus band across the lower portion of the frame",
  negative_space_band_upper: "a deliberately clean, softly out-of-focus band across the upper portion of the frame",
  dedicated_panel: "a distinct, uncluttered panel set apart from the photograph itself",
  banner: "a clear horizontal band suited to a banner treatment",
  footer: "a clean, quiet footer strip along the bottom edge",
  badge: "a small, clean, uncluttered zone suited to a badge",
  framed_block: "a bordered block with genuinely empty interior space",
  integrated_editorial_region: "an editorial column of open space integrated into the composition"
});

const NEGATIVE_SPACE_STRATEGY_PHRASES = Object.freeze({
  generous: "generous",
  moderate: "a moderate amount of",
  minimal: "a small, tightly-controlled amount of"
});

const CTA_PROMINENCE_PHRASES = Object.freeze({
  strong: "large enough to support a bold, prominent call-to-action",
  standard: "sized for a clear, readable call-to-action",
  subtle: "sized for a quiet, understated call-to-action",
  none: null
});

const HEADLINE_SCALE_PHRASES = Object.freeze({
  standard: null,
  large: "with generous room for a large headline",
  oversized: "with substantial room for an oversized, dominant headline"
});

const TYPOGRAPHY_PERSONALITY_PHRASES = Object.freeze({
  // Deliberately compositional only — never an instruction to render
  // literal letterforms. See this file's own header note.
  editorial_serif: "The reserved space should feel suited to elegant serif type — clean, refined negative space, never cluttered.",
  clean_sans: "The reserved space should feel suited to clean, modern type — simple and uncluttered.",
  script_accent: "The reserved space should feel suited to a flowing script accent — graceful, airy negative space.",
  bold_display: "The reserved space should feel suited to bold display type — strong, confident negative space.",
  serif_script_pairing: "The reserved space should feel suited to a refined serif-and-script pairing — elegant, airy negative space."
});

const BRANDING_POSITION_PHRASES = Object.freeze({
  top_center: "at the top center of the frame",
  top_left: "in the top left of the frame",
  bottom_center: "at the bottom center of the frame",
  corner_watermark: "in a quiet corner, watermark-scale"
});

const BRANDING_SCALE_PHRASES = Object.freeze({
  subtle: "a very small, discreet zone",
  standard: "a small, uncluttered zone",
  prominent: "a clearly visible but tasteful zone"
});

const ORNAMENTAL_DENSITY_PHRASES = Object.freeze({
  minimal: "minimal",
  light: "light",
  moderate: "moderate",
  rich: "rich, generously layered"
});

const DECORATIVE_MOTIF_PHRASES = Object.freeze({
  none: null,
  floral_sprigs: "delicate floral sprig details",
  botanical_line_art: "fine botanical line-art details",
  watercolor_wash: "a soft watercolor-wash texture",
  leaf_accents: "subtle leaf accents",
  geometric_minimal: "clean, minimal geometric accents"
});

const BORDER_STYLE_PHRASES = Object.freeze({
  none: null,
  hairline: "a fine hairline edge",
  double_line: "a refined double-line border",
  ornamental_frame: "an ornamental decorative frame",
  organic_floral_frame: "an organic, hand-drawn floral framing"
});

// Deliberately not exhaustively phrased — divider/badge/banner styles are
// renderer-level (post-photo) decorative details the image model has no
// need to reproduce; they exist here only for the enum-coverage test, not
// because every value earns a distinct sentence in the photo prompt.
const DIVIDER_STYLE_NOTED = Object.freeze(new Set(DIVIDER_STYLES));
const BADGE_STYLE_NOTED = Object.freeze(new Set(BADGE_STYLES));
const BANNER_STYLE_NOTED = Object.freeze(new Set(BANNER_STYLES));

const BACKGROUND_TREATMENT_PHRASES = Object.freeze({
  full_bleed_photo: null,
  gradient_band_lower: "a soft gradient fade in the lower band",
  flat_brand_color: "a flat, considered background color field",
  framed_photo_block: "the photograph presented within a defined block",
  bordered_panel_with_photo_inset: "a bordered panel with the photograph inset"
});

// The generic-template failure modes Ashley's own review named verbatim —
// avoidance language only, never a positive instruction (never tell the
// model TO do any of these). A centered decorative flower border is only
// flagged when the composition is NOT itself a framed/paneled family,
// where a border is the intended, appropriate treatment.
const BASE_AVOIDANCE_ITEMS = Object.freeze([
  "a generic AI-template look",
  "flowers arranged as a decorative border around an empty blank center",
  "greeting-card symmetry",
  "a clip-art appearance",
  "a flat or static composition"
]);
const FRAMED_COMPOSITIONS = Object.freeze(["framed_panel", "layered_editorial"]);

const MARKETING_ACTION_PHRASES = Object.freeze({
  order_now: "placing an order promptly",
  call_shop: "calling the shop",
  visit_shop: "visiting the shop in person",
  learn_more: "learning more",
  contact_general: "getting in touch",
  none: null
});

/** Looks up a dictionary value, returning null for anything not a real,
 * mapped key — NEVER falls back to interpolating the raw input value
 * itself. This is the one structural guarantee this whole module rests
 * on: an unrecognized or attacker-controlled string can influence WHICH
 * fixed sentence is chosen (or that none is), never appear verbatim. */
function lookup(dict, key) {
  if (typeof key !== "string") return null;
  return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : null;
}

function occasionFramingSentence(occasionTreatment) {
  return lookup(OCCASION_TREATMENT_FRAMING, occasionTreatment);
}

function compositionSentence(cd) {
  const parts = [
    lookup(COMPOSITION_FAMILY_PHRASES, cd.compositionFamily),
    lookup(IMAGE_PLACEMENT_PHRASES, cd.imagePlacement),
    lookup(SUBJECT_PLACEMENT_PHRASES, cd.subjectPlacement),
    lookup(IMAGE_CROP_PHRASES, cd.imageCrop),
    lookup(IMAGE_SCALE_PHRASES, cd.imageScale)
  ].filter(Boolean);
  if (!parts.length) return null;
  return `Compose with ${parts.join(", ")}.`;
}

function lightingMoodSentence(cd) {
  const mood = lookup(VISUAL_MOOD_PHRASES, cd.visualMood);
  const palette = lookup(PALETTE_MOOD_PHRASES, cd.paletteMood);
  if (!mood && !palette) return null;
  const bits = [mood, palette].filter(Boolean).join(", using ");
  return `Lighting and color: ${bits}.`;
}

/** The single most load-bearing sentence in the whole module — this is
 * what turns "flowers around a blank area" (an accident) into "an
 * intentional negative-space reservation matching exactly where
 * Florisyn's own deterministic renderer (public/flyer-renderer.js) will
 * place real typography" (a decision). Combines textRegion (WHERE),
 * negativeSpaceStrategy (HOW MUCH), headlineScale/ctaProminence (how
 * much visual room that space needs to support), and typography
 * personality (the compositional — never literal-text — feel of that
 * space). */
function negativeSpaceSentence(cd) {
  const region = lookup(TEXT_REGION_PHRASES, cd.textRegion);
  if (!region) return null;
  const amount = lookup(NEGATIVE_SPACE_STRATEGY_PHRASES, cd.negativeSpaceStrategy) || "clean";
  const ctaNote = lookup(CTA_PROMINENCE_PHRASES, cd.ctaProminence);
  const headlineNote = lookup(HEADLINE_SCALE_PHRASES, cd.headlineScale);
  const sizingNotes = [headlineNote, ctaNote].filter(Boolean).join(", and ");
  const typographyNote = lookup(TYPOGRAPHY_PERSONALITY_PHRASES, cd.typographyPersonality);
  const sentences = [
    `Leave ${amount} genuinely empty negative space — specifically ${region} — completely free of decorative clutter, reserved for typography that will be added afterward${sizingNotes ? `, ${sizingNotes}` : ""}.`,
    typographyNote
  ].filter(Boolean);
  return sentences.join(" ");
}

function brandZoneSentence(cd) {
  // Batch 6, Part 4: a creative mode that legitimately has NO on-image
  // brand mark (photo_forward_social) must never still get a reserved
  // brand zone described in the prompt — graphicTextSlots.brand is the
  // real, authoritative signal (creativeDirection.brandingPosition itself
  // stays at its schema default even when brand is disabled, since
  // nothing clears it — checking the actual slot, not just the position
  // field, is what makes this correct).
  if (cd.graphicTextSlots && cd.graphicTextSlots.brand === false) return null;
  const position = lookup(BRANDING_POSITION_PHRASES, cd.brandingPosition);
  if (!position) return null;
  const scale = lookup(BRANDING_SCALE_PHRASES, cd.brandingScale) || "a small, uncluttered zone";
  return `Reserve ${scale} ${position} for a brand mark to be added afterward — leave it visually quiet, never busy.`;
}

/** Batch 6, Part 3/4: when a creative mode has genuinely suppressed BOTH
 * the headline and brand slots (photo_forward_social today; any future
 * family that does the same), reinforce that the photography alone
 * should carry the whole composition — otherwise an image model given
 * only mood/composition language, with no explicit "don't add text"
 * framing beyond the standing literal-text rule, can still default to
 * leaving obvious empty space "for" text that was never coming. */
function photoForwardReinforcementSentence(cd) {
  const slots = cd.graphicTextSlots;
  if (!slots || slots.headline !== false || slots.brand !== false) return null;
  return "No on-image text or branding is needed at all here — let the photography fill the frame naturally, without composing empty space as if text will be added later.";
}

const AUDIENCE_PHRASES = Object.freeze({
  students: "an audience of students",
  parents: "an audience of parents",
  students_and_parents: "an audience of both students and their parents",
  brides: "a bride planning her wedding",
  wedding_clients: "wedding clients",
  corporate_offices: "a corporate/office audience",
  business_clients: "business clients",
  romantic_partners: "someone shopping for a romantic partner",
  self_purchase: "someone treating themselves",
  gift_buyers: "someone choosing a gift for someone else",
  existing_customers: "the shop's own existing, returning customers",
  // funeral_families is deliberately handled entirely by the sympathy
  // occasion framing above — a second, redundant audience sentence would
  // only risk sounding less careful, not more.
  funeral_families: null,
  general_local_customers: null,
  unknown_general: null
});

/** Batch 6, Part 2: the one place audience actually reaches downstream
 * creative reasoning, per the audit's own explicit requirement — never a
 * literal fact, purely a compositional/tonal cue built from the fixed
 * phrase dictionary above (same non-leak guarantee as every other
 * sentence in this module). Omitted entirely for the generic/unknown
 * fallback values, where saying nothing is more honest than inventing a
 * cue nothing in the request actually supports. */
function audienceSentence(audience) {
  const phrase = lookup(AUDIENCE_PHRASES, audience);
  if (!phrase) return null;
  return `This is intended for ${phrase} — let the composition's mood and framing feel genuinely relevant to them.`;
}

function decorativeSentence(cd) {
  const density = lookup(ORNAMENTAL_DENSITY_PHRASES, cd.ornamentalDensity);
  const motif = lookup(DECORATIVE_MOTIF_PHRASES, cd.decorativeMotif);
  const border = lookup(BORDER_STYLE_PHRASES, cd.borderStyle);
  const background = lookup(BACKGROUND_TREATMENT_PHRASES, cd.backgroundTreatment);
  const detailParts = [motif, border, background].filter(Boolean);
  if (!density && !detailParts.length) return null;
  const densityPhrase = density ? `${density} decorative detail` : "considered decorative detail";
  const detail = detailParts.length ? ` (${detailParts.join("; ")})` : "";
  return `Decorative styling: ${densityPhrase}${detail} — never overwhelming the photograph itself.`;
}

function marketingActionSentence({ objective, ctaIntent } = {}) {
  const action = lookup(MARKETING_ACTION_PHRASES, ctaIntent);
  if (!action) return null;
  return `Compose with the customer's next action in mind — the image should visually invite ${action}, not merely display flowers.`;
}

/** Batch 5.3 hook: canonicalConcept.occasionCategory === "event_reminder"
 * (a named school-dance-style event, per marketing-canonical-concept.js's
 * new keyword rule) gets an explicit urgency/purpose framing distinct
 * from an ordinary, no-deadline post — WITHOUT ever naming the literal
 * event, date, or any other protected fact (this module never receives
 * them). factRequirements.includes("event_date") is used only as a
 * boolean signal (a real deadline was detected upstream), never as a
 * source of the date's actual value. */
function eventReminderSentence({ occasionCategory, factRequirements } = {}) {
  if (occasionCategory !== "event_reminder") return null;
  const hasDeadline = Array.isArray(factRequirements) && factRequirements.includes("event_date");
  return hasDeadline
    ? "This is a time-sensitive event reminder with a real deadline behind it — let the composition convey gentle urgency and forward momentum, visually distinct from a routine, no-deadline post."
    : "This is an event-specific reminder post — let the composition feel purposeful and occasion-specific, visually distinct from a routine, no-deadline post.";
}

function avoidanceSentence(cd) {
  const items = [...BASE_AVOIDANCE_ITEMS];
  if (!FRAMED_COMPOSITIONS.includes(cd.compositionFamily)) {
    items.push("a centered decorative flower border");
  }
  return `Avoid: ${items.join(", ")}.`;
}

/**
 * Builds the rich, occasion-aware advertising-photography direction text
 * an OpenAI image prompt should carry, plus the standing avoidance list.
 * Never throws; fails closed with `{ ok:false, error }` only when the two
 * required inputs aren't real objects at all (mirrors buildOpenAiCreative
 * Brief's own "refuse to guess" discipline) — any individual field inside
 * either object that's missing or unrecognized is handled per-sentence
 * (omitted or safely generic), never a hard failure.
 *
 * @param {object} params
 * @param {object} params.canonicalConcept - buildCanonicalConcept()'s own
 *   output. Only objective/ctaIntent/occasionCategory/factRequirements are
 *   read — never requestText or any free-form field.
 * @param {object} params.creativeDirection - buildDeterministicCreative
 *   Direction()'s own output. Only its enum fields are read.
 * @returns {{ ok:true, version:number, directionText:string,
 *   avoidanceText:string, occasionTreatment:string|null } | { ok:false, error:string }}
 */
export function buildCreativeDirectorDirection({ canonicalConcept = null, creativeDirection = null } = {}) {
  if (!canonicalConcept || typeof canonicalConcept !== "object") {
    return { ok: false, error: "buildCreativeDirectorDirection requires a real canonicalConcept — refusing to guess one." };
  }
  if (!creativeDirection || typeof creativeDirection !== "object") {
    return { ok: false, error: "buildCreativeDirectorDirection requires a real creativeDirection — refusing to guess one." };
  }

  const sentences = [
    occasionFramingSentence(creativeDirection.occasionTreatment),
    compositionSentence(creativeDirection),
    lightingMoodSentence(creativeDirection),
    negativeSpaceSentence(creativeDirection),
    brandZoneSentence(creativeDirection),
    decorativeSentence(creativeDirection),
    marketingActionSentence({ objective: canonicalConcept.objective, ctaIntent: canonicalConcept.ctaIntent }),
    eventReminderSentence({ occasionCategory: canonicalConcept.occasionCategory, factRequirements: canonicalConcept.factRequirements }),
    audienceSentence(canonicalConcept.audience),
    photoForwardReinforcementSentence(creativeDirection)
  ].filter(Boolean);

  return {
    ok: true,
    version: CREATIVE_DIRECTOR_VERSION,
    directionText: sentences.join(" "),
    avoidanceText: avoidanceSentence(creativeDirection),
    occasionTreatment: creativeDirection.occasionTreatment ?? null
  };
}

// Exported purely for the enum-coverage regression test (tests/marketing-
// creative-director.test.js) — asserts every real enum value this module
// is supposed to translate actually has a dictionary entry, so a future
// addition to marketing-creative-direction.js's own enums is caught here
// rather than silently degrading to a generic fallback forever.
export const _internalsForTesting = Object.freeze({
  OCCASION_TREATMENT_FRAMING,
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
  BANNER_STYLE_NOTED,
  ENUM_REFERENCE: Object.freeze({
    OCCASION_TREATMENTS,
    COMPOSITION_FAMILIES,
    SUBJECT_PLACEMENTS,
    IMAGE_CROPS,
    IMAGE_PLACEMENTS,
    IMAGE_SCALES,
    TEXT_REGIONS,
    NEGATIVE_SPACE_STRATEGIES,
    CTA_PROMINENCE_LEVELS,
    HEADLINE_SCALES,
    TYPOGRAPHY_PERSONALITIES,
    BRANDING_POSITIONS,
    BRANDING_SCALES,
    ORNAMENTAL_DENSITIES,
    DECORATIVE_MOTIFS,
    BORDER_STYLES,
    BACKGROUND_TREATMENTS,
    DIVIDER_STYLES,
    BADGE_STYLES,
    BANNER_STYLES,
    VISUAL_MOODS,
    PALETTE_MOODS
  })
});
