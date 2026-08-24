import test from "node:test";
import assert from "node:assert/strict";
import {
  AVATAR_NOT_LIVE,
  notLiveAvatarProvider,
  heygenAvatarConfigured,
  createHeygenAvatarProvider,
  buildConfiguredAvatarProviderRegistry,
  selectAvatarProvider
} from "../netlify/functions/_shared/creative-ai/avatar-engine.js";

function mockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("notLiveAvatarProvider: every method fails closed with a typed AVATAR_NOT_LIVE error", async () => {
  await assert.rejects(() => notLiveAvatarProvider.createProfile({}), (err) => err.code === AVATAR_NOT_LIVE);
  await assert.rejects(() => notLiveAvatarProvider.generateVideo({}), (err) => err.code === AVATAR_NOT_LIVE);
  await assert.rejects(() => notLiveAvatarProvider.getJobStatus("x"), (err) => err.code === AVATAR_NOT_LIVE);
  await assert.rejects(() => notLiveAvatarProvider.cancelJob("x"), (err) => err.code === AVATAR_NOT_LIVE);
});

test("selectAvatarProvider: returns notLiveAvatarProvider when the registry is empty", () => {
  assert.equal(selectAvatarProvider({}, {}), notLiveAvatarProvider);
});

test("selectAvatarProvider: returns the real provider once one is registered", () => {
  const fake = { name: "fake" };
  assert.equal(selectAvatarProvider({}, { heygen: fake }), fake);
});

test("buildConfiguredAvatarProviderRegistry: empty until HEYGEN_API_KEY is actually set", () => {
  assert.deepEqual(buildConfiguredAvatarProviderRegistry({ env: {} }), {});
  const registry = buildConfiguredAvatarProviderRegistry({ env: { HEYGEN_API_KEY: "real-key" } });
  assert.equal(Object.keys(registry).length, 1);
  assert.equal(registry.heygen.name, "heygen");
});

test("heygenAvatarConfigured: mirrors the underlying client's real credential check", () => {
  assert.equal(heygenAvatarConfigured({}), false);
  assert.equal(heygenAvatarConfigured({ HEYGEN_API_KEY: "k" }), true);
});

test("createHeygenAvatarProvider.createProfile: bundles create-group then train, in order, and reports 'training' not 'ready'", async () => {
  const calls = [];
  const restore = mockFetch(async (url, init) => {
    calls.push(String(url));
    if (String(url).includes("avatar_group/create")) return { ok: true, json: async () => ({ data: { group_id: "group-1" } }) };
    if (String(url).includes("/train")) {
      assert.equal(JSON.parse(init.body).group_id, "group-1");
      return { ok: true, json: async () => ({}) };
    }
    throw new Error(`unexpected call: ${url}`);
  });
  const provider = createHeygenAvatarProvider({ env: { HEYGEN_API_KEY: "k" } });
  const result = await provider.createProfile({ personName: "Ashley", referencePhotoUrls: ["https://example.com/1.jpg"] });
  restore();

  assert.equal(result.ok, true);
  assert.equal(result.groupId, "group-1");
  assert.equal(result.status, "training");
  assert.equal(calls.length, 2, "must call both create and train, in order");
});

test("createHeygenAvatarProvider.createProfile: a failure at the create-group step never reaches train", async () => {
  let trainCalled = false;
  const restore = mockFetch(async (url) => {
    if (String(url).includes("avatar_group/create")) return { ok: false, status: 400, json: async () => ({ error: { message: "Bad photo" } }) };
    trainCalled = true;
    return { ok: true, json: async () => ({}) };
  });
  const provider = createHeygenAvatarProvider({ env: { HEYGEN_API_KEY: "k" } });
  const result = await provider.createProfile({ personName: "Ashley", referencePhotoUrls: ["https://example.com/1.jpg"] });
  restore();
  assert.equal(result.ok, false);
  assert.equal(trainCalled, false);
});

test("createHeygenAvatarProvider.generateVideo: delegates to the real /v3/videos endpoint", async () => {
  const restore = mockFetch(async (url, init) => {
    assert.equal(String(url), "https://api.heygen.com/v3/videos");
    assert.equal(JSON.parse(init.body).audio_url, "https://example.com/audio.mp3");
    return { ok: true, json: async () => ({ data: { video_id: "vid-1" } }) };
  });
  const provider = createHeygenAvatarProvider({ env: { HEYGEN_API_KEY: "k" } });
  const result = await provider.generateVideo({ avatarId: "avatar-1", audioUrl: "https://example.com/audio.mp3" });
  restore();
  assert.equal(result.ok, true);
  assert.equal(result.videoId, "vid-1");
});

test("createHeygenAvatarProvider.getJobStatus: delegates to the real status-poll endpoint", async () => {
  const restore = mockFetch(async (url) => {
    assert.match(String(url), /video_id=vid-1/);
    return { ok: true, json: async () => ({ data: { status: "completed", video_url: "https://cdn.heygen.com/x.mp4" } }) };
  });
  const provider = createHeygenAvatarProvider({ env: { HEYGEN_API_KEY: "k" } });
  const result = await provider.getJobStatus("vid-1");
  restore();
  assert.equal(result.status, "completed");
  assert.equal(result.terminal, true);
  assert.equal(result.videoUrl, "https://cdn.heygen.com/x.mp4");
});

test("createHeygenAvatarProvider.cancelJob: honestly reports unsupported rather than pretending to cancel — never throws, matches the client contract", async () => {
  const provider = createHeygenAvatarProvider({ env: { HEYGEN_API_KEY: "k" } });
  const result = await provider.cancelJob("vid-1");
  assert.equal(result.ok, false);
  assert.match(result.error, /does not support canceling/);
});
