/**
 * Reel/video RENDERING provider-independent adapter interface (Priority 3
 * of the "as far as technically possible" pass). Same fail-closed registry
 * pattern as marketing-clone-providers.js / marketing-social-providers.js —
 * every video-rendering provider (Runway, Kling, Pika, Creatify, Captions,
 * an ffmpeg-based render worker, ...) plugs in behind this exact interface
 * so adding one is a new adapter object, never a business-logic change.
 *
 * NO real video-rendering provider is configured anywhere today — this
 * module's entire live-execution surface throws a clearly-labeled
 * VIDEO_RENDER_NOT_LIVE error, exactly like every other not-live adapter in
 * this codebase. What IS real here: `planVideoRender()`, a pure function
 * that turns a request (source image(s)/video, motion, transitions, text
 * overlays, captions, branding, audio reference, duration, aspect ratio,
 * resolution) into a complete, structured render plan — real enough to
 * persist, review, and hand to a provider the moment one is connected,
 * never a fake finished video.
 */

export const VIDEO_RENDER_NOT_LIVE = "video_render_provider_not_live";

function notLive(method) {
  const err = new Error(`Video rendering provider connection required — ${method}() has no live provider configured yet.`);
  err.code = VIDEO_RENDER_NOT_LIVE;
  err.statusCode = 501;
  return err;
}

import { ASPECT_RATIO_CANVAS } from "./creative-ai/platform-media-specs.js";

export const MOTION_STYLES = Object.freeze(["pan", "zoom_in", "zoom_out", "push_in", "pull_out", "parallax", "gentle_sway", "static"]);
export const TRANSITION_STYLES = Object.freeze(["cut", "cross_dissolve", "fade_to_black", "fade_to_white", "slide"]);
// Video only ever plans against the 4 real social-video aspect ratios —
// re-exported here (not redefined) from the one shared canvas table.
export const VIDEO_ASPECT_RATIOS = Object.freeze({
  "9:16": ASPECT_RATIO_CANVAS["9:16"],
  "1:1": ASPECT_RATIO_CANVAS["1:1"],
  "4:5": ASPECT_RATIO_CANVAS["4:5"],
  "16:9": ASPECT_RATIO_CANVAS["16:9"]
});

/**
 * @typedef {Object} VideoRenderProvider
 * Conceptual interface every video-rendering adapter implements.
 */

/** The default adapter: every capability, none of them live. */
export const notLiveVideoRenderProvider = Object.freeze({
  name: "not_live",
  async renderVideo(_plan) {
    throw notLive("renderVideo");
  },
  async getRenderStatus(_jobId) {
    throw notLive("getRenderStatus");
  },
  async cancelRender(_jobId) {
    throw notLive("cancelRender");
  },
  async estimateCost(_plan) {
    throw notLive("estimateCost");
  }
});

/** Same "only real config -> in the registry" pattern as every other
 * provider registry in this codebase. Currently always returns {} — no
 * video-rendering provider integration has been written yet (unlike AI
 * Clone/HeyGen, there is no adapter file to configure even if credentials
 * existed). Structured this way so wiring one in later is additive. */
export function buildConfiguredVideoRenderProviderRegistry({ env = process.env } = {}) {
  return {};
}

export function selectVideoRenderProvider(_criteria = {}, providers = {}) {
  const configured = Object.values(providers).filter(Boolean);
  if (configured.length === 0) return notLiveVideoRenderProvider;
  return configured[0];
}

function clampDuration(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return 15;
  return Math.min(60, Math.max(3, Math.round(n)));
}

function normalizeAspectRatio(ratio) {
  return VIDEO_ASPECT_RATIOS[ratio] ? ratio : "9:16";
}

/**
 * Turns a creative request into a complete, structured render plan. This
 * is the real, buildable-today piece of "Reel/video rendering" — every
 * field a real provider call would eventually need, computed and
 * validated now, so the ONLY missing piece once a provider is connected
 * is the actual encode. Never claims a video was produced; the caller is
 * responsible for persisting this as a `video_render_plan` asset with
 * status reflecting that it's a plan, not a finished render.
 */
export function planVideoRender({
  sourceImageUrls = [],
  sourceVideoUrl = null,
  backgroundUrl = null,
  motion = "gentle_sway",
  transitions = "cross_dissolve",
  textOverlays = [],
  captions = null,
  logoOverlayUrl = null,
  audioReference = null,
  durationSeconds = 15,
  aspectRatio = "9:16",
  resolutionTier = "standard"
} = {}) {
  const validSources = (Array.isArray(sourceImageUrls) ? sourceImageUrls : []).filter(Boolean);
  if (!validSources.length && !sourceVideoUrl) {
    return { ok: false, error: "A video render plan needs at least one source image or a source video." };
  }
  const motionStyle = MOTION_STYLES.includes(motion) ? motion : "gentle_sway";
  const transitionStyle = TRANSITION_STYLES.includes(transitions) ? transitions : "cross_dissolve";
  const ratio = normalizeAspectRatio(aspectRatio);
  const canvas = VIDEO_ASPECT_RATIOS[ratio];
  const duration = clampDuration(durationSeconds);

  // Distribute the total duration evenly across source images so the plan
  // is a real, timed shot list — not a vague "make a video from these".
  const shots = validSources.length
    ? validSources.map((url, i) => ({
        shotIndex: i,
        sourceImageUrl: url,
        startSeconds: Number(((duration / validSources.length) * i).toFixed(2)),
        durationSeconds: Number((duration / validSources.length).toFixed(2)),
        motion: motionStyle,
        transitionOut: i < validSources.length - 1 ? transitionStyle : "fade_to_black"
      }))
    : [{ shotIndex: 0, sourceVideoUrl, startSeconds: 0, durationSeconds: duration, motion: "static", transitionOut: "fade_to_black" }];

  return {
    ok: true,
    plan: {
      status: "plan_only",
      shots,
      backgroundUrl: backgroundUrl || null,
      textOverlays: (Array.isArray(textOverlays) ? textOverlays : []).slice(0, 6).map((t) => ({
        text: String(t.text || "").slice(0, 120),
        atSeconds: Number(t.atSeconds) || 0,
        position: t.position === "top" || t.position === "bottom" ? t.position : "center"
      })),
      captions: captions ? { text: String(captions).slice(0, 2000), burnedIn: true } : null,
      logoOverlayUrl: logoOverlayUrl || null,
      audioReference: audioReference || null,
      durationSeconds: duration,
      aspectRatio: ratio,
      canvas,
      resolutionTier: resolutionTier === "premium" ? "premium" : "standard",
      // What a provider would need — real enough to hand off the moment
      // renderVideo() is more than a not-live stub.
      providerRequirements: {
        sourceAssetsRequired: validSources.length || (sourceVideoUrl ? 1 : 0),
        estimatedProviderCostBasis: `${duration} seconds at the configured video_${resolutionTier === "premium" ? "premium" : "standard"}_second rate`
      }
    }
  };
}
