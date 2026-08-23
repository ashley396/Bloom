import test from "node:test";
import assert from "node:assert/strict";
import {
  heygenConfigured,
  createHeygenVideo,
  getHeygenVideoStatus,
  createHeygenPhotoAvatarGroup,
  trainHeygenPhotoAvatarGroup
} from "../netlify/functions/_shared/marketing-heygen-client.js";

function mockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("heygenConfigured: true only once HEYGEN_API_KEY is actually set", () => {
  assert.equal(heygenConfigured({}), false);
  assert.equal(heygenConfigured({ HEYGEN_API_KEY: "" }), false);
  assert.equal(heygenConfigured({ HEYGEN_API_KEY: "real-key" }), true);
});

test("createHeygenVideo: rejects with a clear error when apiKey is missing, never attempts the call", async () => {
  let called = false;
  const restore = mockFetch(async () => {
    called = true;
    throw new Error("should not be called");
  });
  const result = await createHeygenVideo({ avatarId: "a1", voiceId: "v1", script: "hi" });
  restore();
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("createHeygenVideo: requires either audioUrl or (voiceId + script) — never sends an ambiguous request", async () => {
  const result = await createHeygenVideo({ apiKey: "k", avatarId: "a1" });
  assert.equal(result.ok, false);
  assert.match(result.error, /audioUrl|voiceId/);
});

test("createHeygenVideo: posts to /v3/videos with the audio-driven body when audioUrl is given", async () => {
  let capturedUrl, capturedBody, capturedHeaders;
  const restore = mockFetch(async (url, init) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(init.body);
    capturedHeaders = init.headers;
    return { ok: true, json: async () => ({ data: { video_id: "vid-123" } }) };
  });
  const result = await createHeygenVideo({ apiKey: "real-key", avatarId: "avatar-1", audioUrl: "https://example.com/audio.mp3", title: "Test" });
  restore();

  assert.equal(result.ok, true);
  assert.equal(result.videoId, "vid-123");
  assert.equal(capturedUrl, "https://api.heygen.com/v3/videos");
  assert.equal(capturedHeaders["x-api-key"], "real-key");
  assert.equal(capturedBody.avatar_id, "avatar-1");
  assert.equal(capturedBody.audio_url, "https://example.com/audio.mp3");
  assert.equal(capturedBody.voice_id, undefined, "must not send voice_id when audio-driven");
});

test("createHeygenVideo: a non-ok HTTP response surfaces the real provider error message, never a generic one", async () => {
  const restore = mockFetch(async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { message: "Invalid API key" } })
  }));
  const result = await createHeygenVideo({ apiKey: "bad-key", avatarId: "a1", audioUrl: "https://example.com/a.mp3" });
  restore();
  assert.equal(result.ok, false);
  assert.equal(result.error, "Invalid API key");
});

test("createHeygenVideo: a response missing video_id fails rather than returning a fake success", async () => {
  const restore = mockFetch(async () => ({ ok: true, json: async () => ({ data: {} }) }));
  const result = await createHeygenVideo({ apiKey: "k", avatarId: "a1", audioUrl: "https://example.com/a.mp3" });
  restore();
  assert.equal(result.ok, false);
});

test("getHeygenVideoStatus: reports terminal=true only for completed/failed, never for a still-rendering status", async () => {
  const restore = mockFetch(async (url) => {
    assert.match(String(url), /\/v3\/video\/status\?video_id=vid-123/);
    return { ok: true, json: async () => ({ data: { status: "processing" } }) };
  });
  const result = await getHeygenVideoStatus({ apiKey: "k", videoId: "vid-123" });
  restore();
  assert.equal(result.ok, true);
  assert.equal(result.status, "processing");
  assert.equal(result.terminal, false);
});

test("getHeygenVideoStatus: completed is terminal and carries the real video URL", async () => {
  const restore = mockFetch(async () => ({
    ok: true,
    json: async () => ({ data: { status: "completed", video_url: "https://cdn.heygen.com/x.mp4" } })
  }));
  const result = await getHeygenVideoStatus({ apiKey: "k", videoId: "vid-1" });
  restore();
  assert.equal(result.terminal, true);
  assert.equal(result.videoUrl, "https://cdn.heygen.com/x.mp4");
});

test("createHeygenPhotoAvatarGroup: requires at least one reference photo URL", async () => {
  const result = await createHeygenPhotoAvatarGroup({ apiKey: "k", name: "Ashley" });
  assert.equal(result.ok, false);
});

test("createHeygenPhotoAvatarGroup: posts real photo URLs and returns the real group_id", async () => {
  let capturedBody;
  const restore = mockFetch(async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ data: { group_id: "group-1" } }) };
  });
  const result = await createHeygenPhotoAvatarGroup({ apiKey: "k", name: "Ashley", photoUrls: ["https://example.com/1.jpg"] });
  restore();
  assert.equal(result.ok, true);
  assert.equal(result.groupId, "group-1");
  assert.deepEqual(capturedBody.image_urls, ["https://example.com/1.jpg"]);
});

test("trainHeygenPhotoAvatarGroup: requires a groupId and posts it to the training endpoint", async () => {
  const missing = await trainHeygenPhotoAvatarGroup({ apiKey: "k" });
  assert.equal(missing.ok, false);

  let capturedUrl, capturedBody;
  const restore = mockFetch(async (url, init) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({}) };
  });
  const result = await trainHeygenPhotoAvatarGroup({ apiKey: "k", groupId: "group-1" });
  restore();
  assert.equal(result.ok, true);
  assert.match(capturedUrl, /\/v2\/photo_avatar\/train$/);
  assert.equal(capturedBody.group_id, "group-1");
});

test("createHeygenVideo: a network-level fetch failure returns { ok:false } rather than throwing", async () => {
  const restore = mockFetch(async () => {
    throw new Error("network down");
  });
  const result = await createHeygenVideo({ apiKey: "k", avatarId: "a1", audioUrl: "https://example.com/a.mp3" });
  restore();
  assert.equal(result.ok, false);
  assert.match(result.error, /network down/);
});
