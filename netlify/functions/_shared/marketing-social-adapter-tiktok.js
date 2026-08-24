/**
 * Real TikTok publishing adapter (Content Posting API, Direct Post flow) —
 * Priority 5 of the "finish everything that can safely be completed
 * without Ashley" pass. Implements the SocialProvider interface
 * (marketing-social-providers.js).
 *
 * Endpoint shapes verified via live search against TikTok's own current
 * developer documentation during this pass:
 *
 *   HIGH confidence (endpoint + flow directly confirmed): POST
 *   /v2/post/publish/video/init/ (source_info.source="PULL_FROM_URL" +
 *   video_url, post_info.title/privacy_level) returns a publish_id; poll
 *   POST /v2/post/publish/status/fetch/ with that publish_id until
 *   status is a terminal state.
 *
 *   LOWER confidence (not independently verified against a live call):
 *   the exact terminal status string(s) TikTok returns beyond
 *   "PUBLISH_COMPLETE" (this adapter also treats "FAILED" as terminal-
 *   failure; any other value keeps polling until the attempt budget is
 *   spent, then reports a timeout rather than guessing at an unlisted
 *   status).
 *
 * publish() takes a single context object — accessToken (the shop's
 * decrypted, already-issued user access token) and assetUrl (a real,
 * public HTTPS URL to the video — TikTok's server pulls it directly, per
 * PULL_FROM_URL). TikTok's Direct Post targets the connected creator's
 * own account directly; there is no separate externalAccountId the way
 * Facebook Pages/Instagram Business accounts need one.
 */

const TIKTOK_API_BASE = "https://open.tiktokapis.com";
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 40; // ~2 minutes

function providerError(message, { code = "social_provider_error", statusCode = 502 } = {}) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function tiktokRequest(path, { accessToken, body }) {
  let response;
  try {
    response = await fetch(`${TIKTOK_API_BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw providerError(`TikTok API request failed: ${String(error?.message || error).slice(0, 200)}`);
  }
  const payload = await parseJsonSafely(response);
  const errorCode = payload?.error?.code;
  if (!response.ok || (errorCode && errorCode !== "ok")) {
    const detail = payload?.error?.message || `TikTok returned ${response.status}`;
    if (response.status === 401 || errorCode === "access_token_invalid") {
      throw providerError(`TikTok rejected the stored access token: ${detail}`, { code: "social_token_invalid", statusCode: 401 });
    }
    throw providerError(detail);
  }
  return payload?.data || payload;
}

const TERMINAL_FAILURE_STATUSES = new Set(["FAILED"]);

export function createTikTokProvider() {
  return Object.freeze({
    platform: "tiktok",

    async publish(ctx = {}) {
      const { accessToken, assetUrl, caption } = ctx;
      const pollIntervalMs = ctx.pollIntervalMs ?? POLL_INTERVAL_MS;
      const pollMaxAttempts = ctx.pollMaxAttempts ?? POLL_MAX_ATTEMPTS;
      if (!accessToken) throw providerError("tiktok: no access token available for this connection — reconnect the platform.", { statusCode: 401 });
      if (!assetUrl) throw providerError("tiktok: a video assetUrl is required — TikTok's Direct Post flow has no text-only or image post type here.", { statusCode: 400 });

      const init = await tiktokRequest("/v2/post/publish/video/init/", {
        accessToken,
        body: {
          post_info: {
            title: caption || "",
            privacy_level: "SELF_ONLY", // safest default until a real, tested account confirms broader privacy levels behave as documented — never default to public without that verification.
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false
          },
          source_info: { source: "PULL_FROM_URL", video_url: assetUrl }
        }
      });
      const publishId = init?.publish_id;
      if (!publishId) throw providerError("tiktok: publish init returned no publish_id.");

      let status = null;
      for (let attempt = 0; attempt < pollMaxAttempts; attempt++) {
        const statusResult = await tiktokRequest("/v2/post/publish/status/fetch/", { accessToken, body: { publish_id: publishId } });
        status = statusResult?.status;
        if (status === "PUBLISH_COMPLETE") break;
        if (TERMINAL_FAILURE_STATUSES.has(status)) {
          throw providerError(`tiktok: publish failed (${status}): ${statusResult?.fail_reason || "no reason given"}.`);
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      if (status !== "PUBLISH_COMPLETE") {
        throw providerError("tiktok: publish did not complete in time — try checking status again shortly.", { code: "social_provider_timeout", statusCode: 504 });
      }
      return { externalPostId: publishId, raw: { publish_id: publishId, status } };
    },

    async connect() {
      throw providerError("tiktok: connect() happens through the real OAuth flow (marketing-social-oauth.js), not this adapter.", { statusCode: 501 });
    },
    async refreshToken() {
      throw providerError("tiktok: token refresh uses refreshTikTokToken (marketing-social-oauth.js), not this adapter.", { statusCode: 501 });
    },
    async validateMedia() {
      throw providerError("tiktok: validateMedia() is not built yet.", { statusCode: 501 });
    },
    async schedule() {
      throw providerError("tiktok: native provider-side scheduling is not built yet — Florisyn's own publishing queue (marketing-publishing-worker.js) is the scheduling mechanism.", { statusCode: 501 });
    },
    async getStatus() {
      throw providerError("tiktok: getStatus() is not built yet.", { statusCode: 501 });
    },
    async fetchAnalytics() {
      throw providerError("tiktok: fetchAnalytics() is not built yet — TikTok's analytics endpoint has not been verified against real documentation in this pass.", { statusCode: 501 });
    },
    async disconnect() {
      throw providerError("tiktok: disconnect() happens through marketing-studio.js's disconnect_platform action, not this adapter.", { statusCode: 501 });
    }
  });
}
