import test from "node:test";
import assert from "node:assert/strict";
import {
  heygenElevenLabsConfigured,
  createHeygenElevenLabsCloneProvider,
  PROVIDER_NAME
} from "../netlify/functions/_shared/marketing-clone-provider-heygen-elevenlabs.js";

const ENV = { HEYGEN_API_KEY: "heygen-key", ELEVENLABS_API_KEY: "elevenlabs-key" };

function mockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("heygenElevenLabsConfigured: requires BOTH vendor keys, never activates from just one", () => {
  assert.equal(heygenElevenLabsConfigured({}), false);
  assert.equal(heygenElevenLabsConfigured({ HEYGEN_API_KEY: "k" }), false);
  assert.equal(heygenElevenLabsConfigured({ ELEVENLABS_API_KEY: "k" }), false);
  assert.equal(heygenElevenLabsConfigured(ENV), true);
});

test("PROVIDER_NAME is a stable, real identifier used as the registry key", () => {
  assert.equal(PROVIDER_NAME, "heygen_elevenlabs");
});

test("createAvatarProfile: orchestrates create-group then train, and returns a real training status", async () => {
  const calls = [];
  const restore = mockFetch(async (url, init) => {
    calls.push(String(url));
    if (String(url).includes("avatar_group/create")) return { ok: true, json: async () => ({ data: { group_id: "group-1" } }) };
    if (String(url).includes("/train")) {
      assert.equal(JSON.parse(init.body).group_id, "group-1", "must train the exact group it just created");
      return { ok: true, json: async () => ({}) };
    }
    throw new Error(`unexpected call: ${url}`);
  });
  const provider = createHeygenElevenLabsCloneProvider({ env: ENV });
  const result = await provider.createAvatarProfile({ personName: "Ashley", referencePhotoUrls: ["https://example.com/1.jpg"] });
  restore();

  assert.equal(result.providerProfileId, "group-1");
  assert.equal(result.status, "training");
  assert.equal(calls.length, 2, "must call both create and train, in order");
});

test("createAvatarProfile: a failure at the create-group step never reaches the train step", async () => {
  let trainCalled = false;
  const restore = mockFetch(async (url) => {
    if (String(url).includes("avatar_group/create")) return { ok: false, status: 400, json: async () => ({ error: { message: "Bad photo" } }) };
    trainCalled = true;
    return { ok: true, json: async () => ({}) };
  });
  const provider = createHeygenElevenLabsCloneProvider({ env: ENV });
  await assert.rejects(() => provider.createAvatarProfile({ personName: "Ashley", referencePhotoUrls: ["https://example.com/1.jpg"] }));
  restore();
  assert.equal(trainCalled, false);
});

test("createVoiceProfile: returns 'ready' immediately — ElevenLabs voice cloning has no separate training wait", async () => {
  const restore = mockFetch(async () => ({ ok: true, json: async () => ({ voice_id: "voice-abc" }) }));
  const provider = createHeygenElevenLabsCloneProvider({ env: ENV });
  const result = await provider.createVoiceProfile({
    personName: "Ashley",
    referenceAudioFiles: [{ blob: new Blob([Buffer.from([1])]), filename: "a.mp3" }]
  });
  restore();
  assert.equal(result.providerProfileId, "voice-abc");
  assert.equal(result.status, "ready");
});

test("generateVoice: returns real synthesized audio bytes", async () => {
  const restore = mockFetch(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer }));
  const provider = createHeygenElevenLabsCloneProvider({ env: ENV });
  const result = await provider.generateVoice({ voiceProfileId: "voice-abc", text: "Hello" });
  restore();
  assert.ok(Buffer.isBuffer(result.audioBuffer));
  assert.equal(result.audioBuffer.length, 3);
});

test("generateVideo: without an uploadAudio dependency, fails clearly rather than silently skipping the audio step", async () => {
  const provider = createHeygenElevenLabsCloneProvider({ env: ENV }); // no uploadAudio
  await assert.rejects(
    () => provider.generateVideo({ avatarProfileId: "group-1", voiceProfileId: "voice-abc", script: "Hi there" }),
    /uploadAudio/
  );
});

test("generateVideo: orchestrates synthesize -> upload -> create-video, passing the uploaded URL through", async () => {
  let uploadedBuffer, uploadedFilename;
  const uploadAudio = async (buffer, filename) => {
    uploadedBuffer = buffer;
    uploadedFilename = filename;
    return { ok: true, url: "https://florisyn.example/audio/clone-1.mp3" };
  };
  const restore = mockFetch(async (url, init) => {
    if (String(url).includes("text-to-speech")) return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    if (String(url).includes("/v3/videos")) {
      const body = JSON.parse(init.body);
      assert.equal(body.audio_url, "https://florisyn.example/audio/clone-1.mp3", "must pass the real uploaded URL to HeyGen");
      return { ok: true, json: async () => ({ data: { video_id: "vid-1" } }) };
    }
    throw new Error(`unexpected call: ${url}`);
  });
  const provider = createHeygenElevenLabsCloneProvider({ env: ENV, uploadAudio });
  const result = await provider.generateVideo({ avatarProfileId: "avatar-1", voiceProfileId: "voice-abc", script: "Hello there", title: "Test" });
  restore();

  assert.equal(result.jobId, "vid-1");
  assert.equal(result.status, "rendering");
  assert.ok(Buffer.isBuffer(uploadedBuffer));
  assert.match(uploadedFilename, /\.mp3$/);
});

test("generateVideo: an upload failure surfaces clearly rather than proceeding to call HeyGen with a broken URL", async () => {
  const uploadAudio = async () => ({ ok: false, error: "storage quota exceeded" });
  let heygenCalled = false;
  const restore = mockFetch(async (url) => {
    if (String(url).includes("text-to-speech")) return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer };
    heygenCalled = true;
    return { ok: true, json: async () => ({ data: { video_id: "vid-1" } }) };
  });
  const provider = createHeygenElevenLabsCloneProvider({ env: ENV, uploadAudio });
  await assert.rejects(
    () => provider.generateVideo({ avatarProfileId: "a1", voiceProfileId: "v1", script: "hi" }),
    /storage quota exceeded/
  );
  restore();
  assert.equal(heygenCalled, false, "must never call HeyGen with a failed/missing audio URL");
});

test("preview: with no avatarProfileId, previews voice-only (no HeyGen call at all)", async () => {
  let heygenCalled = false;
  const restore = mockFetch(async (url) => {
    if (String(url).includes("text-to-speech")) return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer };
    heygenCalled = true;
    return { ok: true, json: async () => ({}) };
  });
  const provider = createHeygenElevenLabsCloneProvider({ env: ENV });
  const result = await provider.preview({ voiceProfileId: "voice-abc", script: "A short preview line." });
  restore();
  assert.ok(Buffer.isBuffer(result.audioBuffer));
  assert.equal(heygenCalled, false);
});

test("preview: rejects a blank script rather than calling any provider", async () => {
  const provider = createHeygenElevenLabsCloneProvider({ env: ENV });
  await assert.rejects(() => provider.preview({ voiceProfileId: "voice-abc", script: "   " }));
});

test("estimateCost: delegates to the real shared cost config, never invents its own numbers", async () => {
  const provider = createHeygenElevenLabsCloneProvider({ env: ENV });
  const result = await provider.estimateCost({ purpose: "avatar_video", unitType: "second", units: 10 });
  assert.equal(typeof result.estimatedCostCents, "number");
  assert.ok(result.estimatedCostCents > 0);
});

test("estimateCost: an unrecognized purpose rejects rather than returning a fabricated cost", async () => {
  const provider = createHeygenElevenLabsCloneProvider({ env: ENV });
  await assert.rejects(() => provider.estimateCost({ purpose: "not_a_real_purpose", unitType: "second", units: 1 }));
});

test("getJobStatus: polls the real HeyGen video status endpoint", async () => {
  const restore = mockFetch(async (url) => {
    assert.match(String(url), /video_id=vid-1/);
    return { ok: true, json: async () => ({ data: { status: "completed", video_url: "https://cdn.heygen.com/x.mp4" } }) };
  });
  const provider = createHeygenElevenLabsCloneProvider({ env: ENV });
  const result = await provider.getJobStatus("vid-1");
  restore();
  assert.equal(result.status, "completed");
  assert.equal(result.terminal, true);
  assert.equal(result.resultUrl, "https://cdn.heygen.com/x.mp4");
});

test("cancelJob: honestly rejects rather than pretending HeyGen supports cancellation", async () => {
  const provider = createHeygenElevenLabsCloneProvider({ env: ENV });
  await assert.rejects(() => provider.cancelJob("vid-1"), /does not support canceling/);
});

test("deleteProfile: kind='voice' calls the real ElevenLabs delete endpoint", async () => {
  let capturedUrl;
  const restore = mockFetch(async (url) => {
    capturedUrl = String(url);
    return { ok: true, json: async () => ({}) };
  });
  const provider = createHeygenElevenLabsCloneProvider({ env: ENV });
  const result = await provider.deleteProfile({ profileId: "voice-abc", kind: "voice" });
  restore();
  assert.equal(result.deleted, true);
  assert.match(capturedUrl, /\/v1\/voices\/voice-abc$/);
});

test("deleteProfile: kind='avatar' honestly rejects rather than pretending avatar deletion is implemented", async () => {
  const provider = createHeygenElevenLabsCloneProvider({ env: ENV });
  await assert.rejects(() => provider.deleteProfile({ profileId: "group-1", kind: "avatar" }));
});

test("deleteProfile: an unrecognized kind rejects rather than guessing which vendor to call", async () => {
  const provider = createHeygenElevenLabsCloneProvider({ env: ENV });
  await assert.rejects(() => provider.deleteProfile({ profileId: "x" }));
});
