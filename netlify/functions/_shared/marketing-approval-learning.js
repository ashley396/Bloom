/**
 * Florisyn Marketing Studio — approval-time learning evidence (Batch 5,
 * "Repair recent-content diversity + brand-memory learning", Part
 * H/I/J/L).
 *
 * Real problem this closes: approve_content's own learning-signal write
 * (marketing-studio.js) fed Brand Brain / My Style ONLY a generation's own
 * self-reported `brand_traits_used`/`visual_traits_used` — and
 * generateSocialPost already grounds those through traitsGroundedInSummary
 * (only a trait that was already IN the summary handed to the model can
 * ever be reported "used"), which means a genuinely NEW inferred
 * preference could never be born through that path at all: nothing is
 * ever in the summary the very first time, so the very field meant to
 * grow evidence for a new trait can only ever echo traits that already
 * cleared PROMOTE_THRESHOLD. Approve_content had no OTHER source of
 * learning evidence, so real repeated florist behavior (a consistently
 * short caption, a consistently photography-first choice) never
 * accumulated toward anything.
 *
 * Part I's fix: two distinct concepts.
 *   - traits_applied — the existing, already-grounded brand_traits_used/
 *     visual_traits_used (marketing-studio.js still reads these directly
 *     off the asset; this module doesn't touch that half at all).
 *   - approval_observations — NEW, built here, entirely from
 *     deterministic, structural artifact properties (canonical_concept's
 *     creativeFamily, a real caption's real length) — never from a
 *     model's own free-form self-report, so a model can never invent its
 *     own learning evidence out of thin air (Part J).
 *
 * Deliberately small and literal, per Part J's own "do not learn" list:
 * no flower names, no scene details, no promotions, no temporary facts —
 * every observation here is a plain structural fact about the artifact
 * itself (how long the caption is, whether the post carried on-image
 * design), reusing the EXISTING BRAND_CATEGORIES/STYLE_CATEGORIES
 * taxonomies (marketing-brand-brain.js / ai-style-memory.js) — never a
 * third preference system (Part K).
 */

import { deriveCreativeFamily } from "./marketing-canonical-concept.js";

const SHORT_CAPTION_CHARS = 280; // roughly a single-tweet length — a real, structural, deterministic threshold, not a guess at "feels short"
const LONG_CAPTION_CHARS = 600;

/**
 * Builds this one approved (or rejected) asset's own deterministic
 * learning observations — never the model's self-report, always a plain
 * structural read of the artifact that was actually shown to the
 * florist.
 *
 * @param {object} asset - a row from ai_generated_assets (asset_type,
 *   content).
 * @returns {{brandObservations: object[], visualObservations: object[]}}
 *   each entry shaped {category, text, polarity} — the same shape
 *   recordBrandSignal/recordApprovalSignal already accept.
 */
export function deriveApprovalObservations(asset) {
  const brandObservations = [];
  const visualObservations = [];
  const content = asset?.content || {};
  const captionText = String(content.body || content.caption || "").trim();

  // Part J: "prefers shorter captions" / "detailed storytelling" — a
  // plain character count of the REAL persisted caption, never a model's
  // own opinion of its own writing.
  if (captionText) {
    if (captionText.length <= SHORT_CAPTION_CHARS) {
      brandObservations.push({ category: "content_density", text: "concise captions", polarity: "positive" });
    } else if (captionText.length >= LONG_CAPTION_CHARS) {
      brandObservations.push({ category: "content_density", text: "detailed storytelling", polarity: "positive" });
    }
  }

  // Part J: "prefers minimal text overlays" / "prefers photography-first
  // posts" / "prefers certain creative families" — creativeFamily is a
  // Batch 4 structural classification (never free model text); reused
  // here exactly as persisted, with the same deterministic fallback for
  // an older asset that predates canonical_concept.
  const creativeFamily = content.canonical_concept?.creativeFamily ?? deriveCreativeFamily({ assetType: asset?.asset_type || null });
  if (creativeFamily === "plain_photo_post") {
    visualObservations.push({ category: "product_photo_style", text: "photography-first, minimal on-image text", polarity: "positive" });
  } else if (creativeFamily === "designed_flyer") {
    visualObservations.push({ category: "flyer_style", text: "fully designed flyer with on-image text", polarity: "positive" });
  }

  return { brandObservations, visualObservations };
}

/**
 * Part L: one artifact must not count the same trait multiple times just
 * because it showed up in more than one source (a model's self-report AND
 * a deterministic observation naming the same thing, or the same
 * observation derived from two different assets in the same approval
 * event). Dedupes by (category, normalized text, polarity) — the exact
 * identity findTraitIndex()/recordBrandSignal() already use — keeping the
 * FIRST occurrence, so this one approval event increments each real
 * distinct trait's evidence_count by at most 1.
 */
export function dedupeTraits(traits = []) {
  const seen = new Set();
  const result = [];
  for (const t of traits) {
    if (!t || !t.category || !t.text) continue;
    const key = `${t.category}|${String(t.text).trim().toLowerCase()}|${t.polarity === "negative" ? "negative" : "positive"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(t);
  }
  return result;
}
