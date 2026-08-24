import test from "node:test";
import assert from "node:assert/strict";
import {
  VOICE_NOT_LIVE,
  notLiveVoiceProvider,
  elevenLabsVoiceConfigured,
  createElevenLabsVoiceProvider,
  buildConfiguredVoiceProviderRegistry,
  selectVoiceProvider
} from "../netlify/functions/_shared/creative-ai/voice-engine.js";

function mockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("notLiveVoiceProvider: every method fails closed with a typed VOICE_NOT_LIVE error", async () => {
  await assert.rejects(() => notLiveVoiceProvider.synthesize({}), (err) => err.code === VOICE_NOT_LIVE);
  await assert.rejects(() => notLiveVoiceProvider.clone({}), (err) => err.code === VOICE_NOT_LIVE);
  await assert.rejects(() => notLiveVoiceProvider.delete({}), (err) => err.code === VOICE_NOT_LIVE);
});

test("selectVoiceProvider: returns notLiveVoiceProvider when the registry is empty, never crashes or fakes success", () => {
  assert.equal(selectVoiceProvider({}, {}), notLiveVoiceProvider);
});

test("selectVoiceProvider: returns the real provider once one is registered", () => {
  const fake = { name: "fake" };
  assert.equal(selectVoiceProvider({}, { elevenlabs: fake }), fake);
});

test("buildConfiguredVoiceProviderRegistry: empty until ELEVENLABS_API_KEY is actually set", () => {
  assert.deepEqual(buildConfiguredVoiceProviderRegistry({ env: {} }), {});
  assert.deepEqual(Object.keys(buildConfiguredVoiceProviderRegistry({ env: { ELEVENLABS_API_KEY: "" } })), []);
  const registry = buildConfiguredVoiceProviderRegistry({ env: { ELEVENLABS_API_KEY: "real-key" } });
  assert.equal(Object.keys(registry).length, 1);
  assert.equal(registry.elevenlabs.name, "elevenlabs");
});

test("elevenLabsVoiceConfigured: mirrors the underlying client's real credential check", () => {
  assert.equal(elevenLabsVoiceConfigured({}), false);
  assert.equal(elevenLabsVoiceConfigured({ ELEVENLABS_API_KEY: "k" }), true);
});

test("createElevenLabsVoiceProvider.synthesize: delegates to the real ElevenLabs HTTP client, passing voiceSettings through only when given", async () => {
  let capturedBody;
  const restore = mockFetch(async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  });
  const provider = createElevenLabsVoiceProvider({ env: { ELEVENLABS_API_KEY: "k" } });
  const result = await provider.synthesize({ voiceId: "v1", text: "hello", voiceSettings: { stability: 0.5 } });
  restore();

  assert.equal(result.ok, true);
  assert.ok(Buffer.isBuffer(result.audioBuffer));
  assert.deepEqual(capturedBody.voice_settings, { stability: 0.5 });
});

test("createElevenLabsVoiceProvider.synthesize: omits voice_settings entirely when not given — Marketing Studio's clone path must keep ElevenLabs' own defaults applying", async () => {
  let capturedBody;
  const restore = mockFetch(async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer };
  });
  const provider = createElevenLabsVoiceProvider({ env: { ELEVENLABS_API_KEY: "k" } });
  await provider.synthesize({ voiceId: "v1", text: "hello" });
  restore();

  assert.equal("voice_settings" in capturedBody, false);
});

test("createElevenLabsVoiceProvider.clone: delegates to the real voice-cloning endpoint", async () => {
  const restore = mockFetch(async (url) => {
    assert.equal(String(url), "https://api.elevenlabs.io/v1/voices/add");
    return { ok: true, json: async () => ({ voice_id: "voice-abc" }) };
  });
  const provider = createElevenLabsVoiceProvider({ env: { ELEVENLABS_API_KEY: "k" } });
  const result = await provider.clone({ name: "Ashley", audioFiles: [{ blob: new Blob([Buffer.from([1])]), filename: "a.mp3" }] });
  restore();
  assert.equal(result.ok, true);
  assert.equal(result.voiceId, "voice-abc");
});

test("createElevenLabsVoiceProvider.delete: delegates to the real delete endpoint", async () => {
  let capturedUrl, capturedMethod;
  const restore = mockFetch(async (url, init) => {
    capturedUrl = String(url);
    capturedMethod = init.method;
    return { ok: true, json: async () => ({}) };
  });
  const provider = createElevenLabsVoiceProvider({ env: { ELEVENLABS_API_KEY: "k" } });
  const result = await provider.delete({ voiceId: "voice-abc" });
  restore();
  assert.equal(result.ok, true);
  assert.equal(capturedUrl, "https://api.elevenlabs.io/v1/voices/voice-abc");
  assert.equal(capturedMethod, "DELETE");
});

test("createElevenLabsVoiceProvider: a failed response carries the real HTTP status through, never fabricated", async () => {
  const restore = mockFetch(async () => ({
    ok: false,
    status: 401,
    json: async () => ({ detail: { message: "Invalid API key" } })
  }));
  const provider = createElevenLabsVoiceProvider({ env: { ELEVENLABS_API_KEY: "bad-key" } });
  const result = await provider.synthesize({ voiceId: "v1", text: "hi" });
  restore();
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 401);
  assert.equal(result.error, "Invalid API key");
});
