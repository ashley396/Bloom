/**
 * Personal Brand Studio — platform-variant planning (Section 10 of the
 * directive).
 *
 * "Generate platform-specific variants rather than blindly duplicating
 * copy": this module decides WHICH destinations an approved founder
 * concept should become and what content KIND each needs (image/video/
 * carousel), reusing the existing SUPPORTED_PLATFORMS/PLATFORM_TO_DESTINATIONS
 * mapping (marketing-social-providers.js, platform-media-specs.js) rather
 * than inventing a parallel platform model. It does not write copy itself
 * — that's generate_content, already built and tested (Stage D) — this is
 * the planning layer that decides what generate_content should be asked
 * to produce for each destination, and whether that destination is even a
 * sane fit for this mode (Google Business Profile doesn't take a Reel;
 * Pinterest wants a still Pin, not a carousel).
 */

import { SUPPORTED_PLATFORMS } from "../marketing-social-providers.js";
import { PLATFORM_TO_DESTINATIONS, getDestinationSpec } from "./platform-media-specs.js";
import { getPersonalBrandMode } from "./personal-brand-modes.js";

const VIDEO_DESTINATIONS = new Set(["instagram_reels", "tiktok", "youtube_long", "youtube_shorts"]);

function contentKindFor(destination) {
  return VIDEO_DESTINATIONS.has(destination) ? "video" : "image";
}

/**
 * Plans which destinations a founder concept should target, and what kind
 * of asset each destination needs. Pure — no generation, no DB access.
 * Throws on an unknown platform (never silently drops a florist-requested
 * platform) or an unknown mode.
 */
export function planPersonalBrandPlatformVariants({ mode, targetPlatforms } = {}) {
  getPersonalBrandMode(mode); // validates mode, throws on unknown
  if (!Array.isArray(targetPlatforms) || targetPlatforms.length === 0) {
    throw new Error("planPersonalBrandPlatformVariants requires at least one targetPlatform.");
  }
  const plan = [];
  for (const platform of targetPlatforms) {
    if (!SUPPORTED_PLATFORMS.includes(platform)) {
      throw new Error(`planPersonalBrandPlatformVariants: unknown platform "${platform}".`);
    }
    const destinations = PLATFORM_TO_DESTINATIONS[platform] || [];
    plan.push({
      platform,
      destinations: destinations.map((destination) => ({
        destination,
        contentKind: contentKindFor(destination),
        spec: getDestinationSpec(destination)
      }))
    });
  }
  return plan;
}

/** A mode's own suggested platforms (personal-brand-modes.js), filtered
 * down to whatever the caller actually asked for — "make me a founder
 * portrait" defaults sensibly without requiring the florist to name every
 * platform by hand, while an explicit target_platform from
 * classifyPersonalBrandCommand() always wins. */
export function resolveTargetPlatforms({ mode, explicitPlatform, requestedPlatforms }) {
  if (explicitPlatform) return [explicitPlatform];
  if (Array.isArray(requestedPlatforms) && requestedPlatforms.length) return requestedPlatforms;
  return [...getPersonalBrandMode(mode).suggestedPlatforms];
}
