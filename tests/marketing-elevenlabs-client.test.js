import test from "node:test";
import assert from "node:assert/strict";
import {
  elevenLabsConfigured,
  cloneElevenLabsVoice,
  synthesizeElevenLabsSpeech,
  deleteElevenLabsVoice
} from "../netlify/functions/_shared/marketing-elevenlabs-client.js";

function mockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("elevenLabsConfigured: true only once ELEVENLABS_API_KEY is actually set", () => {
  assert.equal(elevenLabsConfigured({}), false);
  assert.equal(elevenLabsConfigured({ ELEVENLABS_API_KEY: "" }), false);
  assert.equal(elevenLabsConfigured({ ELEVENLABS_API_KEY: "real-key" }), true);
});

test("cloneElevenLabsVoice: requires at least one real reference audio file", async () => {
  const result = await cloneElevenLabsVoice({ apiKey: "k", name: "Ashley", audioFiles: [] });
  assert.equal(result.ok, false);
});

test("cloneElevenLabsVoice: posts a multipart form with xi-api-key and returns the real voice_id", async () => {
  let capturedHeaders, capturedForm;
  const restore = mockFetch(async (url, init) => {
    assert.equal(String(url), "https://api.elevenlabs.io/v1/voices/add");
    capturedHeaders = init.headers;
    capturedForm = init.body;
    return { ok: true, json: async () => ({ voice_id: "voice-abc" }) };
  });
  const result = await cloneElevenLabsVoice({
    apiKey: "real-key",
    name: "Ashley",
    audioFiles: [{ blob: new Blob([Buffer.from([1, 2, 3])]), filename: "sample.mp3" }]
  });
  restore();

  assert.equal(result.ok, true);
  assert.equal(result.voiceId, "voice-abc");
  assert.equal(capturedHeaders["xi-api-key"], "real-key");
  assert.ok(capturedForm instanceof FormData, "must send a real multipart form, not JSON");
  assert.equal(capturedForm.get("name"), "Ashley");
});

test("cloneElevenLabsVoice: a non-ok response surfaces the real provider error", async () => {
  const restore = mockFetch(async () => ({
    ok: false,
    status: 422,
    json: async () => ({ detail: { message: "Voice name already exists" } })
  }));
  const result = await cloneElevenLabsVoice({ apiKey: "k", name: "Ashley", audioFiles: [{ blob: new Blob(["x"]), filename: "a.mp3" }] });
  restore();
  assert.equal(result.ok, false);
  assert.equal(result.error, "Voice name already exists");
});

test("synthesizeElevenLabsSpeech: requires non-empty text", async () => {
  const result = await synthesizeElevenLabsSpeech({ apiKey: "k", voiceId: "v1", text: "" });
  assert.equal(result.ok, false);
});

test("synthesizeElevenLabsSpeech: posts to /v1/text-to-speech/{voice_id} and returns real audio bytes", async () => {
  let capturedUrl, capturedBody;
  const fakeAudio = new Uint8Array([1, 2, 3, 4]).buffer;
  const restore = mockFetch(async (url, init) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(init.body);
    return { ok: true, arrayBuffer: async () => fakeAudio };
  });
  const result = await synthesizeElevenLabsSpeech({ apiKey: "k", voiceId: "voice-abc", text: "Hello from Florisyn" });
  restore();

  assert.equal(result.ok, true);
  assert.equal(capturedUrl, "https://api.elevenlabs.io/v1/text-to-speech/voice-abc");
  assert.equal(capturedBody.text, "Hello from Florisyn");
  assert.ok(Buffer.isBuffer(result.audioBuffer));
  assert.equal(result.audioBuffer.length, 4);
});

test("synthesizeElevenLabsSpeech: empty audio bytes are treated as a failure, never a silent empty success", async () => {
  const restore = mockFetch(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }));
  const result = await synthesizeElevenLabsSpeech({ apiKey: "k", voiceId: "v1", text: "hi" });
  restore();
  assert.equal(result.ok, false);
});

test("deleteElevenLabsVoice: DELETEs the real voice_id endpoint", async () => {
  let capturedUrl, capturedMethod;
  const restore = mockFetch(async (url, init) => {
    capturedUrl = String(url);
    capturedMethod = init.method;
    return { ok: true, json: async () => ({}) };
  });
  const result = await deleteElevenLabsVoice({ apiKey: "k", voiceId: "voice-abc" });
  restore();
  assert.equal(result.ok, true);
  assert.equal(capturedUrl, "https://api.elevenlabs.io/v1/voices/voice-abc");
  assert.equal(capturedMethod, "DELETE");
});
