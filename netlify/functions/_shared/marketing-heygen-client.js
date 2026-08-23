/**
 * HeyGen API client — real HTTP integration (Stage G activation).
 *
 * Endpoint shapes below were verified against HeyGen's own current
 * documentation (docs.heygen.com) on 2026-08-23, NOT reconstructed from
 * training-data memory alone — HeyGen's API has churned (v1 → v2 → v3)
 * and getting this wrong would mean silently claiming an integration
 * works when it doesn't (exactly what Section 40 forbids). Confidence
 * varies by endpoint — see the per-function notes:
 *
 *   HIGH confidence (directly confirmed): createVideo (POST /v3/videos),
 *   getVideoStatus (GET /v3/video/status).
 *
 *   LOWER confidence (endpoint family confirmed to exist and documented
 *   at the URLs cited in comments, but exact request/response field names
 *   were not independently verified against a live call — HeyGen's Photo
 *   Avatar Group flow is multi-step and newer): createPhotoAvatarGroup,
 *   trainPhotoAvatarGroup. Test against a real account before relying on
 *   these for anything beyond a first smoke test.
 *
 * Every function here returns { ok, ... } and never throws for an
 * expected failure (missing config, HTTP error, malformed response) —
 * same contract as ai-image-engine.js's generateImage(), so a failed
 * HeyGen call never takes down the rest of a job.
 */

const HEYGEN_API_BASE = "https://api.heygen.com";

export function heygenConfigured(env = process.env) {
  return Boolean(String(env.HEYGEN_API_KEY || "").trim());
}

function authHeaders(apiKey) {
  return { "x-api-key": apiKey, "Content-Type": "application/json" };
}

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Creates an avatar video. Audio-driven mode: pass audioUrl (a real,
 * publicly-fetchable URL — HeyGen fetches it server-side) to lip-sync the
 * avatar to already-synthesized speech (the ElevenLabs → HeyGen
 * composition this adapter is built for), OR pass voiceId + script to let
 * HeyGen synthesize its own voice instead. Exactly one audio source is
 * required by HeyGen's API — never both.
 */
export async function createHeygenVideo({ apiKey, avatarId, audioUrl, voiceId, script, title, aspectRatio = "9:16" } = {}) {
  if (!apiKey) return { ok: false, error: "HeyGen API key is required." };
  if (!avatarId) return { ok: false, error: "avatarId is required." };
  if (!audioUrl && !(voiceId && script)) {
    return { ok: false, error: "Provide either audioUrl, or both voiceId and script." };
  }

  const body = {
    avatar_id: avatarId,
    title: title || "Florisyn marketing video",
    aspect_ratio: aspectRatio
  };
  if (audioUrl) body.audio_url = audioUrl;
  else {
    body.voice_id = voiceId;
    body.script = script;
  }

  let response;
  try {
    response = await fetch(`${HEYGEN_API_BASE}/v3/videos`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify(body)
    });
  } catch (error) {
    return { ok: false, error: `HeyGen video request failed: ${String(error?.message || error).slice(0, 200)}` };
  }

  const payload = await parseJsonSafely(response);
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || `HeyGen returned ${response.status}`;
    return { ok: false, error: detail };
  }
  const videoId = payload?.data?.video_id || payload?.video_id;
  if (!videoId) return { ok: false, error: "HeyGen response carried no video_id." };
  return { ok: true, videoId, provider: "heygen" };
}

const HEYGEN_TERMINAL_STATUSES = new Set(["completed", "failed"]);

/** Polls a video's render status. HeyGen renders asynchronously — a
 * caller should poll this on a real interval, never assume completion
 * right after createHeygenVideo(). */
export async function getHeygenVideoStatus({ apiKey, videoId } = {}) {
  if (!apiKey) return { ok: false, error: "HeyGen API key is required." };
  if (!videoId) return { ok: false, error: "videoId is required." };

  let response;
  try {
    response = await fetch(`${HEYGEN_API_BASE}/v3/video/status?video_id=${encodeURIComponent(videoId)}`, {
      method: "GET",
      headers: authHeaders(apiKey)
    });
  } catch (error) {
    return { ok: false, error: `HeyGen status request failed: ${String(error?.message || error).slice(0, 200)}` };
  }

  const payload = await parseJsonSafely(response);
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || `HeyGen returned ${response.status}`;
    return { ok: false, error: detail };
  }
  const status = payload?.data?.status || payload?.status || "unknown";
  return {
    ok: true,
    status,
    terminal: HEYGEN_TERMINAL_STATUSES.has(status),
    videoUrl: payload?.data?.video_url || payload?.video_url || null,
    error: payload?.data?.error || null
  };
}

/**
 * LOWER CONFIDENCE — see file header. Creates the Photo Avatar Group that
 * a "digital twin" avatar is trained from. HeyGen documents this as a
 * multi-step flow (create group → upload/generate photos → train); this
 * function covers the first step only. Verify field names against
 * https://docs.heygen.com/reference/create-photo-avatar-group before
 * relying on this beyond a first manual smoke test.
 */
export async function createHeygenPhotoAvatarGroup({ apiKey, name, photoUrls } = {}) {
  if (!apiKey) return { ok: false, error: "HeyGen API key is required." };
  if (!name) return { ok: false, error: "name is required." };
  if (!Array.isArray(photoUrls) || photoUrls.length === 0) {
    return { ok: false, error: "At least one reference photoUrl is required." };
  }

  let response;
  try {
    response = await fetch(`${HEYGEN_API_BASE}/v2/photo_avatar/avatar_group/create`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({ name, image_urls: photoUrls })
    });
  } catch (error) {
    return { ok: false, error: `HeyGen photo avatar group request failed: ${String(error?.message || error).slice(0, 200)}` };
  }

  const payload = await parseJsonSafely(response);
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || `HeyGen returned ${response.status}`;
    return { ok: false, error: detail };
  }
  const groupId = payload?.data?.group_id || payload?.group_id;
  if (!groupId) return { ok: false, error: "HeyGen response carried no group_id." };
  return { ok: true, groupId, provider: "heygen" };
}

/** LOWER CONFIDENCE — see file header. Starts training on a previously
 * created photo avatar group. Training is asynchronous; HeyGen does not
 * document a dedicated training-status poll separate from the group's own
 * detail endpoint, so callers should treat a successful response here as
 * "training started," not "avatar ready." */
export async function trainHeygenPhotoAvatarGroup({ apiKey, groupId } = {}) {
  if (!apiKey) return { ok: false, error: "HeyGen API key is required." };
  if (!groupId) return { ok: false, error: "groupId is required." };

  let response;
  try {
    response = await fetch(`${HEYGEN_API_BASE}/v2/photo_avatar/train`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({ group_id: groupId })
    });
  } catch (error) {
    return { ok: false, error: `HeyGen training request failed: ${String(error?.message || error).slice(0, 200)}` };
  }

  const payload = await parseJsonSafely(response);
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || `HeyGen returned ${response.status}`;
    return { ok: false, error: detail };
  }
  return { ok: true, groupId, provider: "heygen" };
}
