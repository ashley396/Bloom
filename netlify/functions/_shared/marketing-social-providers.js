/**
 * Social-publishing provider-independent adapter interface — Section 20 of
 * the build directive. Every required network (Facebook, Instagram,
 * TikTok, LinkedIn, Pinterest, Google Business Profile, YouTube) plugs in
 * behind this exact interface so the publishing queue (Stage E) and
 * Marketing Studio UI never talk to a platform SDK directly.
 *
 * NOT LIVE — PROVIDER CONNECTION REQUIRED. No platform OAuth app has been
 * created or approved yet (every network in scope gates production
 * publishing behind a real review process — see Stage A research). Every
 * method throws a clearly-labeled "not live" error instead of a fake
 * success. Tokens are never handled here directly in a way that could
 * reach browser code — a real adapter reads/writes
 * marketing_social_connection_secrets via the service-role client only,
 * inside server code, never returning token material in any response.
 */

export const SOCIAL_NOT_LIVE = "social_provider_not_live";

export const SUPPORTED_PLATFORMS = Object.freeze([
  "facebook",
  "instagram",
  "tiktok",
  "linkedin",
  "pinterest",
  "google_business",
  "youtube"
]);

function notLive(platform, method) {
  const err = new Error(
    `${platform}: publishing connection required — ${method}() has no live, approved provider configured yet.`
  );
  err.code = SOCIAL_NOT_LIVE;
  err.statusCode = 501;
  err.platform = platform;
  return err;
}

/**
 * @typedef {Object} SocialProvider
 * Conceptual interface every platform adapter implements. `platform` on
 * the returned instance names which of SUPPORTED_PLATFORMS it serves.
 */

/** Builds a not-live adapter for one platform — every capability defined,
 * none of them working, until that platform's real app clears review. */
export function notLiveSocialProvider(platform) {
  const name = SUPPORTED_PLATFORMS.includes(platform) ? platform : "unknown";
  return Object.freeze({
    platform: name,
    async connect(_params) {
      throw notLive(name, "connect");
    },
    async refreshToken(_connectionId) {
      throw notLive(name, "refreshToken");
    },
    async validateMedia(_asset) {
      throw notLive(name, "validateMedia");
    },
    async publish(_variant) {
      throw notLive(name, "publish");
    },
    async schedule(_variant, _when) {
      throw notLive(name, "schedule");
    },
    async getStatus(_externalPostId) {
      throw notLive(name, "getStatus");
    },
    async fetchAnalytics(_externalPostId) {
      throw notLive(name, "fetchAnalytics");
    },
    async disconnect(_connectionId) {
      throw notLive(name, "disconnect");
    }
  });
}

/** One not-live adapter per required platform — the full registry Stage E
 * replaces platform-by-platform as each app clears its provider's review
 * process, never all at once and never faked in the meantime. */
export function buildSocialProviderRegistry() {
  const registry = {};
  for (const platform of SUPPORTED_PLATFORMS) {
    registry[platform] = notLiveSocialProvider(platform);
  }
  return Object.freeze(registry);
}

/** True labeling helper for the UI — every connection card should call
 * this rather than infer liveness from connection status alone, since a
 * "connected" row in dev/test data must never be presented as capable of
 * a real publish. */
export function isPlatformLive(_platform) {
  // No platform has a real, approved, credentialed adapter yet — flips to
  // per-platform real checks (env credential presence + health check) as
  // each is wired in Stage E.
  return false;
}
