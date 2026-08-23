/**
 * Media output planner — the "generate expensively once → transform
 * cheaply → distribute many times" layer. Pure, deterministic, and
 * PLANNING ONLY: it decides what derived versions a master asset needs
 * for a set of target platforms, and never re-invokes an avatar/voice/
 * video provider to get them.
 *
 * NOT LIVE — PROVIDER CONFIGURATION REQUIRED for the actual transform
 * *execution* step: this environment (Netlify Functions) has no media-
 * processing capability today (no ffmpeg binary, no transcoding service
 * connected) — that is a separate, not-yet-approved provider/infra
 * decision (a worker with ffmpeg, or a third-party API like Mux/
 * Cloudinary — either is a new paid provider relationship, out of scope
 * for this pass per the "DO NOT YET" list). This module produces the
 * transformation PLAN — what needs to happen and why — so that decision
 * can be made against a concrete, real spec instead of a guess, and so
 * the plan itself is fully testable today without any such infra.
 *
 * "Safe crop" here means a deterministic center-crop to the target aspect
 * ratio — always available, no AI model needed. "Intelligent reframing"
 * (subject-aware, e.g. keeping a face centered through a pan) is a real,
 * separate capability Florisyn does not have; it is represented as a
 * named-but-unimplemented strategy so a future implementation has a
 * stable slot to fill, per "do not invent platform capabilities."
 */

import { PLATFORM_TO_DESTINATIONS, getDestinationSpec } from "./platform-media-specs.js";

export const REFRAME_STRATEGIES = Object.freeze({
  CENTER_CROP: "center_crop", // implemented (deterministic, no model)
  AI_REFRAME: "ai_reframe" // NOT IMPLEMENTED — named slot only
});

/**
 * Maps this planner's transformation.type vocabulary onto the
 * ai_generated_assets.transformation_type CHECK constraint vocabulary
 * (see supabase/migrations/20260824000000_..._media.sql) — the enum a
 * future execution engine would write when it actually persists a derived
 * asset row with parent_asset_id set. Kept as an explicit table (not
 * assumed identical) so the two vocabularies can evolve independently
 * without silently drifting apart.
 *
 * "trim_required" intentionally maps to null: this planner never trims
 * automatically (see planDerivedAssets), so it never produces a derived
 * asset row for that entry — only a warning for human review. A future
 * trim implementation would need its own transformation_type ('trim'
 * already exists in the DB enum, unused until then).
 */
export const PLANNER_TO_ASSET_TRANSFORMATION_TYPE = Object.freeze({
  reframe: "reframe",
  add_captions: "caption_burn",
  generate_thumbnail: "thumbnail",
  trim_required: null
});

export function toAssetTransformationType(plannerTransformationType) {
  if (!Object.prototype.hasOwnProperty.call(PLANNER_TO_ASSET_TRANSFORMATION_TYPE, plannerTransformationType)) {
    throw new Error(`toAssetTransformationType: unknown planner transformation type "${plannerTransformationType}".`);
  }
  return PLANNER_TO_ASSET_TRANSFORMATION_TYPE[plannerTransformationType];
}

function aspectRatioMatches(masterAspectRatio, allowedAspectRatios) {
  return allowedAspectRatios.includes(masterAspectRatio);
}

/**
 * @param {object} params
 * @param {object} params.masterAsset - { assetType: 'video'|'image', aspectRatio: '9:16'|'1:1'|'4:5'|'16:9'|..., durationSeconds?, hasBurnedInCaptions? }
 * @param {string[]} params.targetPlatforms - coarse platform keys (marketing-social-providers.js's SUPPORTED_PLATFORMS values)
 * @returns {{ derivedAssets: Array, overallWarnings: string[] }}
 */
export function planDerivedAssets({ masterAsset, targetPlatforms = [] } = {}) {
  if (!masterAsset || !masterAsset.assetType) {
    throw new Error("planDerivedAssets requires masterAsset.assetType.");
  }
  if (!Array.isArray(targetPlatforms) || targetPlatforms.length === 0) {
    throw new Error("planDerivedAssets requires at least one targetPlatform.");
  }

  const derivedAssets = [];
  const overallWarnings = [];

  for (const platform of targetPlatforms) {
    const destinations = PLATFORM_TO_DESTINATIONS[platform];
    if (!destinations) {
      overallWarnings.push(`Unknown platform "${platform}" — no destination mapping, skipped.`);
      continue;
    }

    for (const destination of destinations) {
      const spec = getDestinationSpec(destination);
      const transformations = [];
      const warnings = [];

      if (spec.unverified) {
        warnings.push(`Spec for "${destination}" includes unverified figures — confirm against the platform's current API/policy before relying on this plan for a real publish.`);
      }

      const needsReframe = !aspectRatioMatches(masterAsset.aspectRatio, spec.aspectRatios);
      if (needsReframe) {
        transformations.push({
          type: "reframe",
          from: masterAsset.aspectRatio,
          to: spec.aspectRatios[0],
          strategy: REFRAME_STRATEGIES.CENTER_CROP,
          note: "Deterministic center-crop — always available. Subject-aware (ai_reframe) is not implemented."
        });
      }

      if (masterAsset.assetType === "video") {
        if (spec.maxDurationSeconds != null && masterAsset.durationSeconds > spec.maxDurationSeconds) {
          transformations.push({
            type: "trim_required",
            fromSeconds: masterAsset.durationSeconds,
            maxSeconds: spec.maxDurationSeconds
          });
          warnings.push(`Master exceeds ${destination}'s ${spec.maxDurationSeconds}s limit by ${masterAsset.durationSeconds - spec.maxDurationSeconds}s — automatic trimming is not implemented (cutting content requires knowing where a safe cut point is, which this planner cannot determine); flag for human review.`);
        }
        if (!masterAsset.hasBurnedInCaptions && spec.captionSupport !== "unverified") {
          transformations.push({
            type: "add_captions",
            method: spec.captionSupport,
            note: "Caption generation (transcription) is not implemented in this pass — this only identifies the need."
          });
        }
        transformations.push({ type: "generate_thumbnail" });
      }

      derivedAssets.push({
        destination,
        platform,
        spec,
        transformations,
        needsTransformation: transformations.length > 0,
        platformSafe: transformations.every((t) => t.type !== "trim_required") && !spec.unverified,
        warnings
      });
    }
  }

  return { derivedAssets, overallWarnings };
}
