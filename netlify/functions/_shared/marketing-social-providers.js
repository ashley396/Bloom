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

import { createFacebookPagesProvider, createInstagramProvider } from "./marketing-social-adapter-meta.js";
import { createTikTokProvider } from "./marketing-social-adapter-tiktok.js";

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

/** The two env vars a real OAuth adapter for this platform would need
 * (app/client id + secret), named by a consistent convention so setting
 * up a new platform is "add these two env vars", not a one-off. Real
 * per-platform authorize/token endpoints and scopes are NOT built here —
 * every provider's OAuth details differ enough (and are untestable
 * without a real registered, approved app) that guessing them would risk
 * exactly the "claim an integration works before it does" mistake Section
 * 40 prohibits. This only ever answers "is Florisyn even configured to
 * try" — never constructs a redirect URL. */
export function platformOAuthEnvVarNames(platform) {
  const key = String(platform || "").toUpperCase();
  return { clientIdVar: `FLORISYN_SOCIAL_${key}_CLIENT_ID`, clientSecretVar: `FLORISYN_SOCIAL_${key}_CLIENT_SECRET` };
}

/** Real, honest check — true only once BOTH env vars for this platform
 * are actually set. Every platform reads false today because no OAuth
 * app has been registered for any of them yet; this flips to true the
 * moment real credentials are configured, with no code change needed. */
export function isPlatformConfigured(platform, env = process.env) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) return false;
  const { clientIdVar, clientSecretVar } = platformOAuthEnvVarNames(platform);
  return Boolean(String(env[clientIdVar] || "").trim()) && Boolean(String(env[clientSecretVar] || "").trim());
}

/**
 * Priority 4 of the "finish everything that can safely be completed
 * without Ashley" pass — the real per-platform provider registry, exactly
 * the buildConfiguredCloneProviderRegistry() pattern from
 * marketing-clone-providers.js applied to social publishing. A platform
 * only ever gets its real adapter (facebook/instagram/tiktok — see
 * marketing-social-oauth.js's OAUTH_SUPPORTED_PLATFORMS and the two
 * marketing-social-adapter-*.js files) once its real OAuth app credentials
 * are genuinely configured; everything else — including an
 * OAuth-architected platform whose env vars simply aren't set yet — still
 * resolves to notLiveSocialProvider(), never a fake success.
 *
 * A real adapter existing in this registry is NOT the same thing as a
 * given shop being able to publish through it — marketing-publishing-
 * worker.js's isConnectionUsable() gate (checked before any provider is
 * ever touched) still requires that shop to have a real, unexpired
 * `connected` row in marketing_social_connections, and the worker does
 * not yet resolve the per-call accessToken/externalAccountId/assetUrl
 * these adapters' publish() needs — see marketing-social-adapter-meta.js's
 * header for exactly what remains before a real publish can happen end to
 * end.
 */
export function buildConfiguredSocialProviderRegistry({ env = process.env } = {}) {
  const registry = {};
  for (const platform of SUPPORTED_PLATFORMS) {
    registry[platform] = isPlatformConfigured(platform, env) && REAL_ADAPTER_FACTORIES[platform] ? REAL_ADAPTER_FACTORIES[platform]() : notLiveSocialProvider(platform);
  }
  return Object.freeze(registry);
}

// The adapter modules import nothing from this file, so importing them
// here (rather than duplicating their factory functions) carries no risk
// of a circular import — same direct-import style as
// buildConfiguredCloneProviderRegistry() in marketing-clone-providers.js.
const REAL_ADAPTER_FACTORIES = {
  facebook: createFacebookPagesProvider,
  instagram: createInstagramProvider,
  tiktok: createTikTokProvider
};
