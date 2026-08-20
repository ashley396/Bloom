/**
 * Florisyn AI Core — video rendering provider abstraction.
 *
 * No video-rendering provider is connected yet (deferred by explicit
 * decision — see the AI-OS Phase 1 report). This file exists so that
 * decision can be made later as its own focused choice, without touching
 * Lily, the orchestrator, or Marketing Command Center: any real provider
 * (Runway, Pika, Sora-style API, etc.) just needs to implement this same
 * `renderVideo(job)` shape and get registered below. Nothing else in the
 * AI-OS talks to a provider directly — it only ever calls
 * `getVideoProvider()`.
 */

/**
 * Contract every future video provider must satisfy:
 *   name: string — human label shown in the UI/audit trail.
 *   isConfigured(env): boolean — are credentials present.
 *   renderVideo({ concept, script, scenes, captions, shopId, jobId }):
 *     Promise<{ ok: true, url, durationSeconds, provider, model } |
 *              { ok: false, error }>
 */
export function createNullVideoProvider() {
  return {
    name: "none",
    isConfigured: () => false,
    async renderVideo() {
      return {
        ok: false,
        error: "Final AI video rendering is not connected yet. The script, storyboard, and captions are ready — rendering will work as soon as a video provider is chosen and connected."
      };
    }
  };
}

/** Single point of truth for "which video provider is active." Returns the
 * null provider today; swapping this to a real implementation is the only
 * change needed once a provider is chosen. */
export function getVideoProvider(env = process.env) {
  // Placeholder for a future real provider, selected by env var, e.g.:
  //   if (env.VIDEO_PROVIDER === "runway" && runwayProvider.isConfigured(env)) return runwayProvider;
  return createNullVideoProvider();
}
