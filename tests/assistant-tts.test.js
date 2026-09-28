import test from "node:test";
import assert from "node:assert/strict";
import { handler as realHandler, createAssistantTtsHandler } from "../netlify/functions/assistant-tts.js";

// Every existing behavior below is exercised as a signed-in florist: the
// seam stubs only the session gate (a resolved florist context), never
// the provider path.
const florist = { shopId: "shop-1", user: { id: "user-1" }, role: "owner" };
const handler = createAssistantTtsHandler({ authenticate: async () => florist });

function mockFetch(fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  return () => {
    globalThis.fetch = original;
  };
}

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
});
test.afterEach(() => {
  process.env = { ...savedEnv };
});

function event(body, method = "POST") {
  return { httpMethod: method, headers: {}, body: JSON.stringify(body) };
}

test("no ELEVENLABS_API_KEY configured: falls back honestly, never attempts a network call", async () => {
  delete process.env.ELEVENLABS_API_KEY;
  let fetchCalled = false;
  const restore = mockFetch(async () => {
    fetchCalled = true;
    throw new Error("should not be called");
  });
  const res = await handler(event({ persona: "Lily", text: "Hello" }));
  restore();
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).fallback, true);
  assert.equal(fetchCalled, false);
});

test("no text to speak: 400, never attempts a network call", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  process.env.ELEVENLABS_VOICE_LILY = "voice-lily";
  const res = await handler(event({ persona: "Lily", text: "   " }));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).fallback, true);
});

test("no voice configured for the persona: 503, names the exact env var to set", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  delete process.env.ELEVENLABS_VOICE_DAISY;
  delete process.env.ELEVENLABS_VOICE_DEFAULT;
  const res = await handler(event({ persona: "Daisy", text: "Hello" }));
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 503);
  assert.match(body.error, /ELEVENLABS_VOICE_DAISY/);
});

test("success: synthesizes real audio through VoiceEngine and returns it base64-encoded", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  process.env.ELEVENLABS_VOICE_ROSE = "voice-rose";
  let capturedUrl, capturedBody;
  const restore = mockFetch(async (url, init) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(init.body);
    return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
  });
  const res = await handler(event({ persona: "Rose", text: "Let's plan your week." }));
  restore();

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.persona, "Rose");
  assert.equal(body.provider, "elevenlabs");
  assert.equal(Buffer.from(body.audioBase64, "base64").length, 4);
  assert.equal(capturedUrl, "https://api.elevenlabs.io/v1/text-to-speech/voice-rose");
  // The assistant persona voice tuning must still be applied — this is
  // exactly the behavior VoiceEngine's optional voiceSettings passthrough
  // exists to preserve.
  assert.deepEqual(capturedBody.voice_settings, { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true });
});

test("provider auth failure (401): falls back with a 502, detail never leaked to the client", async () => {
  process.env.ELEVENLABS_API_KEY = "bad-key";
  process.env.ELEVENLABS_VOICE_BUD = "voice-bud";
  const restore = mockFetch(async () => ({
    ok: false,
    status: 401,
    json: async () => ({ detail: { message: "Invalid API key" } })
  }));
  const res = await handler(event({ persona: "Bud", text: "Fix queue update." }));
  restore();
  assert.equal(res.statusCode, 502);
  const body = JSON.parse(res.body);
  assert.equal(body.fallback, true);
  assert.doesNotMatch(body.error, /Invalid API key/);
});

test("provider failure (non-401): falls back with a 503", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  process.env.ELEVENLABS_VOICE_LILY = "voice-lily";
  const restore = mockFetch(async () => ({ ok: false, status: 500, json: async () => ({ message: "Server error" }) }));
  const res = await handler(event({ persona: "Lily", text: "Hello" }));
  restore();
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).fallback, true);
});

test("network-level failure: falls back with a 503, same as any other non-401 failure", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  process.env.ELEVENLABS_VOICE_LILY = "voice-lily";
  const restore = mockFetch(async () => {
    throw new Error("network down");
  });
  const res = await handler(event({ persona: "Lily", text: "Hello" }));
  restore();
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).fallback, true);
});

test("no florist session: 401 with fallback:true, and the provider is never called", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  process.env.ELEVENLABS_VOICE_LILY = "voice-lily";
  let fetchCalled = false;
  const restore = mockFetch(async () => {
    fetchCalled = true;
    throw new Error("should not be called");
  });
  const unauthenticated = createAssistantTtsHandler({
    authenticate: async () => {
      throw Object.assign(new Error("Missing bearer token."), { statusCode: 401 });
    }
  });
  const res = await unauthenticated(event({ persona: "Lily", text: "Hello" }));
  restore();
  assert.equal(res.statusCode, 401);
  const body = JSON.parse(res.body);
  assert.equal(body.fallback, true);
  assert.equal(fetchCalled, false);
});

test("a session check that fails for an operator reason (not the caller) keeps its own status, never masquerades as 'sign in'", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  process.env.ELEVENLABS_VOICE_LILY = "voice-lily";
  let fetchCalled = false;
  const restore = mockFetch(async () => {
    fetchCalled = true;
    throw new Error("should not be called");
  });
  const misconfigured = createAssistantTtsHandler({
    authenticate: async () => {
      throw Object.assign(new Error("SUPABASE_URL is not configured in Netlify"), { statusCode: 503 });
    }
  });
  const res = await misconfigured(event({ persona: "Lily", text: "Hello" }));
  restore();
  assert.equal(res.statusCode, 503);
  const body = JSON.parse(res.body);
  assert.equal(body.fallback, true);
  assert.doesNotMatch(body.error, /sign in/i);
  assert.doesNotMatch(body.error, /SUPABASE_URL/);
  assert.equal(fetchCalled, false);
});

test("the exported production handler really gates on the shared session check (no Authorization header → 401, no provider call)", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  process.env.ELEVENLABS_VOICE_LILY = "voice-lily";
  let fetchCalled = false;
  const restore = mockFetch(async () => {
    fetchCalled = true;
    throw new Error("should not be called");
  });
  const res = await realHandler(event({ persona: "Lily", text: "Hello" }));
  restore();
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).fallback, true);
  assert.equal(fetchCalled, false);
});

test("per-IP rate limit exceeded: 429 with fallback:true, before the session check or any provider call", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  process.env.ELEVENLABS_VOICE_LILY = "voice-lily";
  let authCalls = 0;
  let fetchCalled = false;
  const restore = mockFetch(async () => {
    fetchCalled = true;
    throw new Error("should not be called");
  });
  const limited = createAssistantTtsHandler({
    authenticate: async () => {
      authCalls += 1;
      return florist;
    },
    checkRateLimit: () => ({ allowed: false, retryAfterMs: 1000 })
  });
  const res = await limited(event({ persona: "Lily", text: "Hello" }));
  restore();
  assert.equal(res.statusCode, 429);
  assert.equal(JSON.parse(res.body).fallback, true);
  assert.equal(authCalls, 0);
  assert.equal(fetchCalled, false);
});

test("the browser caller sends the florist session token, so a signed-in florist keeps cloud voice", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../public/assistant-voice.js", import.meta.url), "utf8");
  const call = src.slice(src.indexOf("async function tryCloudSpeak"), src.indexOf("/.netlify/functions/assistant-tts") + 400);
  assert.match(call, /localStorage\.getItem\("bloom_session"\)/);
  assert.match(call, /headers\.Authorization = `Bearer \$\{session\.accessToken\}`/);
  assert.match(call, /headers,\s*\r?\n\s*body:/);
});

test("OPTIONS preflight and non-POST methods are handled before any provider call", async () => {
  const preflightRes = await handler(event({}, "OPTIONS"));
  assert.equal(preflightRes.statusCode, 204);

  const wrongMethodRes = await handler(event({}, "GET"));
  assert.equal(wrongMethodRes.statusCode, 405);
});
