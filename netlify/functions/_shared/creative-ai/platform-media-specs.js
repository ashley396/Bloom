/**
 * Per-destination technical media specs — research date 2026-08, sourced
 * from platform help-center pages plus cross-checked aggregator guides
 * (see docs/production/FLORISYN_CREATIVE_AI_MASTER_PLAN.md and the
 * capability matrix for the full source list). Where a figure could not
 * be independently confirmed, the value is `null` and `unverified: true`
 * is set — media-output-planner.js must never silently invent a number
 * here to fill a gap.
 *
 * Destinations are modeled more finely than marketing-social-
 * providers.js's 7-value `platform` publish-target enum on purpose — a
 * single "instagram" publish target still needs different derived assets
 * for feed vs. Reels, and "youtube" needs different specs for a long-form
 * upload vs. a Short. `PLATFORM_TO_DESTINATIONS` maps the coarse publish
 * enum to the finer destination keys used for planning.
 */

export const DESTINATION_SPECS = Object.freeze({
  facebook_feed: {
    aspectRatios: ["16:9", "1:1", "4:5"],
    recommendedResolution: "1920x1080",
    maxDurationSeconds: 240 * 60,
    maxFileSizeBytes: 10 * 1024 * 1024 * 1024,
    codecs: ["h264"],
    captionSupport: "burned_in_or_separate",
    unverified: false,
    note: "Facebook's own limits are unusually permissive; practical creative length should stay far below the ceiling."
  },
  instagram_feed: {
    aspectRatios: ["1:1", "4:5"],
    recommendedResolution: "1080x1350",
    maxDurationSeconds: null,
    maxFileSizeBytes: null,
    codecs: ["h264"],
    captionSupport: "burned_in_or_separate",
    unverified: true,
    note: "Feed-video-specific duration/file-size ceiling was not independently confirmed this pass — Reels is the primary short-form Instagram destination and is fully specified below."
  },
  instagram_reels: {
    aspectRatios: ["9:16"],
    recommendedResolution: "1080x1920",
    maxDurationSeconds: 180,
    maxFileSizeBytes: 4 * 1024 * 1024 * 1024,
    codecs: ["h264"],
    captionSupport: "burned_in_or_separate",
    unverified: false
  },
  tiktok: {
    aspectRatios: ["9:16"],
    recommendedResolution: "1080x1920",
    maxDurationSeconds: 600,
    maxFileSizeBytes: 4 * 1024 * 1024 * 1024,
    codecs: ["h264"],
    captionSupport: "burned_in_or_separate",
    unverified: false
  },
  linkedin: {
    aspectRatios: ["1:1", "4:5"],
    recommendedResolution: "1080x1080",
    maxDurationSeconds: 900,
    maxFileSizeBytes: 5 * 1024 * 1024 * 1024,
    codecs: ["h264"],
    captionSupport: "burned_in_or_separate",
    unverified: false
  },
  pinterest: {
    aspectRatios: ["9:16", "2:3"],
    recommendedResolution: "1000x1500",
    maxDurationSeconds: null,
    maxFileSizeBytes: null,
    codecs: ["h264"],
    captionSupport: "unverified",
    unverified: true,
    note: "Exact Pinterest video-pin duration/file-size ceiling was not independently confirmed this pass."
  },
  google_business: {
    aspectRatios: ["16:9"],
    recommendedResolution: "1280x720",
    maxDurationSeconds: 30,
    maxFileSizeBytes: 75 * 1024 * 1024,
    codecs: ["h264"],
    captionSupport: "unverified",
    unverified: false,
    note: "720p landscape is the confirmed recommended format; vertical (9:16) acceptance is reported as 'gaining traction' but not confirmed as an official spec."
  },
  youtube_long: {
    aspectRatios: ["16:9"],
    recommendedResolution: "1920x1080",
    maxDurationSeconds: null,
    maxFileSizeBytes: null,
    codecs: ["h264"],
    captionSupport: "separate_track_preferred",
    unverified: true,
    note: "Standard long-form YouTube limits are large/tier-dependent and weren't the focus of this pass — YouTube Shorts is the relevant short-form destination for Digital Ashley content and is fully specified below."
  },
  youtube_shorts: {
    aspectRatios: ["9:16"],
    recommendedResolution: "1080x1920",
    maxDurationSeconds: 180,
    maxFileSizeBytes: null,
    codecs: ["h264"],
    captionSupport: "burned_in_or_separate",
    unverified: true,
    note: "Duration ceiling confirmed via cross-platform aggregator consensus; exact file-size ceiling not independently confirmed."
  }
});

/** Coarse publish-platform (marketing-social-providers.js's
 * SUPPORTED_PLATFORMS) → the finer destination(s) that platform can need
 * derived assets for. Most platforms map 1:1; instagram and youtube each
 * map to two distinct destinations with different specs. */
export const PLATFORM_TO_DESTINATIONS = Object.freeze({
  facebook: ["facebook_feed"],
  instagram: ["instagram_feed", "instagram_reels"],
  tiktok: ["tiktok"],
  linkedin: ["linkedin"],
  pinterest: ["pinterest"],
  google_business: ["google_business"],
  youtube: ["youtube_long", "youtube_shorts"]
});

export function getDestinationSpec(destination) {
  const spec = DESTINATION_SPECS[destination];
  if (!spec) throw new Error(`getDestinationSpec: unknown destination "${destination}".`);
  return spec;
}

/**
 * Canonical pixel dimensions per aspect ratio — one shared table so the
 * real image-transform executor (media-transform-executor.js) and the
 * video-render planner (marketing-video-render-engine.js) never carry two
 * independently-drifting copies of the same four numbers.
 */
export const ASPECT_RATIO_CANVAS = Object.freeze({
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "16:9": { width: 1920, height: 1080 },
  "2:3": { width: 1000, height: 1500 }
});

export function aspectRatioToRatioValue(aspectRatio) {
  const canvas = ASPECT_RATIO_CANVAS[aspectRatio];
  if (!canvas) return null;
  return canvas.width / canvas.height;
}
