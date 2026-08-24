/**
 * Real Facebook Pages + Instagram publishing adapters — Priority 5 of the
 * "finish everything that can safely be completed without Ashley" pass.
 * Implements the SocialProvider interface (marketing-social-providers.js)
 * for the two platforms that share Meta's Graph API.
 *
 * Endpoint shapes below were verified against Meta's own current
 * developer documentation via live search during this pass (not
 * reconstructed from training-data memory alone):
 *
 *   HIGH confidence (endpoint + parameters directly confirmed):
 *   POST /{page-id}/photos (url, caption/message, access_token) for an
 *   image post; POST /{page-id}/feed (message, access_token) for a
 *   text-only post.
 *
 *   LOWER confidence (endpoint family confirmed, exact field/response
 *   shape not independently verified against a live call — Meta's video
 *   upload flow is multi-step and newer than the simple photo/feed
 *   calls): publishing a video post is NOT implemented here — asset_type
 *   'video' throws a clear "not yet built" error rather than guessing at
 *   Meta's resumable video upload protocol.
 *
 *   Instagram: HIGH confidence two-step container flow — POST
 *   /{ig-user-id}/media (image_url, caption) returns a creation_id; poll
 *   GET /{creation-id}?fields=status_code until FINISHED; POST
 *   /{ig-user-id}/media_publish?creation_id=... to publish.
 *
 * publish() takes a single object (not the bare `variant` row) carrying
 * the extra per-call context a real publish needs — accessToken (the
 * shop's decrypted, already-issued token), externalAccountId (the target
 * Facebook Page ID / Instagram Business Account ID — NOT the connecting
 * user's own id), and assetUrl (a real, public HTTPS URL to the image).
 * None of these are resolved by marketing-publishing-worker.js yet — see
 * that file's header for the remaining connective step.
 */

const GRAPH_API_VERSION = "v22.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 30; // ~1 minute

function providerError(message, { code = "social_provider_error", statusCode = 502 } = {}) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function requireContext({ accessToken, externalAccountId }, platform) {
  if (!accessToken) throw providerError(`${platform}: no access token available for this connection — reconnect the platform.`, { statusCode: 401 });
  if (!externalAccountId) throw providerError(`${platform}: no target account id is stored for this connection — reconnect the platform.`, { statusCode: 400 });
}

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function graphRequest(path, { method = "GET", params = {}, accessToken } = {}) {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (accessToken) url.searchParams.set("access_token", accessToken);

  let response;
  try {
    response = await fetch(url.toString(), { method });
  } catch (error) {
    throw providerError(`Meta Graph API request failed: ${String(error?.message || error).slice(0, 200)}`);
  }
  const payload = await parseJsonSafely(response);
  if (!response.ok) {
    const detail = payload?.error?.message || `Meta returned ${response.status}`;
    const code = payload?.error?.code;
    // OAuth errors (expired/invalid token) get a distinct, retryable-by-
    // reconnect classification rather than a generic provider error.
    if (response.status === 401 || code === 190) {
      throw providerError(`Meta rejected the stored access token: ${detail}`, { code: "social_token_invalid", statusCode: 401 });
    }
    throw providerError(detail);
  }
  return payload;
}

/** Real Facebook Pages adapter. Only publish() does real work today —
 * every other SocialProvider method still throws "not built yet" rather
 * than a guessed implementation. */
export function createFacebookPagesProvider() {
  return Object.freeze({
    platform: "facebook",

    async publish(ctx = {}) {
      requireContext(ctx, "facebook");
      const { accessToken, externalAccountId, assetUrl, caption } = ctx;
      let result;
      if (assetUrl) {
        result = await graphRequest(`/${externalAccountId}/photos`, {
          method: "POST",
          accessToken,
          params: { url: assetUrl, caption: caption || "" }
        });
        return { externalPostId: result.post_id || result.id, raw: result };
      }
      if (!caption) throw providerError("facebook: nothing to publish — no image and no caption text.", { statusCode: 400 });
      result = await graphRequest(`/${externalAccountId}/feed`, { method: "POST", accessToken, params: { message: caption } });
      return { externalPostId: result.id, raw: result };
    },

    async fetchAnalytics(ctx = {}) {
      requireContext(ctx, "facebook");
      const { accessToken, externalPostId } = ctx;
      if (!externalPostId) throw providerError("facebook: externalPostId is required.", { statusCode: 400 });
      const result = await graphRequest(`/${externalPostId}`, { accessToken, params: { fields: "likes.summary(true),comments.summary(true),shares" } });
      return {
        likes: result.likes?.summary?.total_count ?? null,
        comments: result.comments?.summary?.total_count ?? null,
        shares: result.shares?.count ?? null,
        raw: result
      };
    },

    async connect() {
      throw providerError("facebook: connect() happens through the real OAuth flow (marketing-social-oauth.js), not this adapter.", { statusCode: 501 });
    },
    async refreshToken() {
      throw providerError("facebook: token refresh uses exchangeLongLivedFacebookToken (marketing-social-oauth.js), not this adapter.", { statusCode: 501 });
    },
    async validateMedia() {
      throw providerError("facebook: validateMedia() is not built yet.", { statusCode: 501 });
    },
    async schedule() {
      throw providerError("facebook: native provider-side scheduling is not built yet — Florisyn's own publishing queue (marketing-publishing-worker.js) is the scheduling mechanism.", { statusCode: 501 });
    },
    async getStatus() {
      throw providerError("facebook: getStatus() is not built yet.", { statusCode: 501 });
    },
    async disconnect() {
      throw providerError("facebook: disconnect() happens through marketing-studio.js's disconnect_platform action, not this adapter.", { statusCode: 501 });
    }
  });
}

/** Real Instagram adapter — two-step container publish. */
export function createInstagramProvider() {
  return Object.freeze({
    platform: "instagram",

    async publish(ctx = {}) {
      requireContext(ctx, "instagram");
      const { accessToken, externalAccountId, assetUrl, caption } = ctx;
      if (!assetUrl) throw providerError("instagram: an image_url is required — Instagram has no text-only post type.", { statusCode: 400 });

      const pollIntervalMs = ctx.pollIntervalMs ?? POLL_INTERVAL_MS;
      const pollMaxAttempts = ctx.pollMaxAttempts ?? POLL_MAX_ATTEMPTS;
      const container = await graphRequest(`/${externalAccountId}/media`, {
        method: "POST",
        accessToken,
        params: { image_url: assetUrl, caption: caption || "" }
      });
      const creationId = container.id;
      if (!creationId) throw providerError("instagram: media container creation returned no id.");

      let status = null;
      for (let attempt = 0; attempt < pollMaxAttempts; attempt++) {
        const statusResult = await graphRequest(`/${creationId}`, { accessToken, params: { fields: "status_code" } });
        status = statusResult.status_code;
        if (status === "FINISHED") break;
        if (status === "ERROR" || status === "EXPIRED") {
          throw providerError(`instagram: media container failed to process (${status}).`);
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      if (status !== "FINISHED") {
        throw providerError("instagram: media container did not finish processing in time — try again shortly.", { code: "social_provider_timeout", statusCode: 504 });
      }

      const published = await graphRequest(`/${externalAccountId}/media_publish`, {
        method: "POST",
        accessToken,
        params: { creation_id: creationId }
      });
      return { externalPostId: published.id, raw: published };
    },

    async fetchAnalytics(ctx = {}) {
      requireContext(ctx, "instagram");
      const { accessToken, externalPostId } = ctx;
      if (!externalPostId) throw providerError("instagram: externalPostId is required.", { statusCode: 400 });
      const result = await graphRequest(`/${externalPostId}/insights`, { accessToken, params: { metric: "impressions,reach,likes,comments,saved" } });
      return { raw: result };
    },

    async connect() {
      throw providerError("instagram: connect() happens through the real OAuth flow (marketing-social-oauth.js), not this adapter.", { statusCode: 501 });
    },
    async refreshToken() {
      throw providerError("instagram: token refresh uses exchangeLongLivedFacebookToken (marketing-social-oauth.js), not this adapter.", { statusCode: 501 });
    },
    async validateMedia() {
      throw providerError("instagram: validateMedia() is not built yet.", { statusCode: 501 });
    },
    async schedule() {
      throw providerError("instagram: native provider-side scheduling is not built yet — Florisyn's own publishing queue (marketing-publishing-worker.js) is the scheduling mechanism.", { statusCode: 501 });
    },
    async getStatus() {
      throw providerError("instagram: getStatus() is not built yet.", { statusCode: 501 });
    },
    async disconnect() {
      throw providerError("instagram: disconnect() happens through marketing-studio.js's disconnect_platform action, not this adapter.", { statusCode: 501 });
    }
  });
}
