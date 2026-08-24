import test from "node:test";
import assert from "node:assert/strict";
import { createTikTokProvider } from "../netlify/functions/_shared/marketing-social-adapter-tiktok.js";

function mockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("publish: requires accessToken and assetUrl before ever attempting a request", async () => {
  const provider = createTikTokProvider();
  let called = false;
  const restore = mockFetch(async () => {
    called = true;
    throw new Error("should not be called");
  });
  await assert.rejects(() => provider.publish({}), /access token/);
  await assert.rejects(() => provider.publish({ accessToken: "tok" }), /assetUrl is required/);
  restore();
  assert.equal(called, false);
});

test("publish: inits with PULL_FROM_URL + SELF_ONLY default privacy, then polls until PUBLISH_COMPLETE", async () => {
  const provider = createTikTokProvider();
  const calls = [];
  const restore = mockFetch(async (url, init) => {
    calls.push({ path: new URL(String(url)).pathname, body: JSON.parse(init.body), headers: init.headers });
    if (calls.length === 1) {
      return { ok: true, json: async () => ({ data: { publish_id: "pub-1" } }) };
    }
    return { ok: true, json: async () => ({ data: { status: "PUBLISH_COMPLETE" } }) };
  });
  const result = await provider.publish({ accessToken: "tok", assetUrl: "https://example.com/reel.mp4", caption: "Fresh cuts today", pollIntervalMs: 1 });
  restore();

  assert.equal(result.externalPostId, "pub-1");
  assert.equal(calls[0].path, "/v2/post/publish/video/init/");
  assert.equal(calls[0].body.source_info.source, "PULL_FROM_URL");
  assert.equal(calls[0].body.source_info.video_url, "https://example.com/reel.mp4");
  assert.equal(calls[0].body.post_info.title, "Fresh cuts today");
  assert.equal(calls[0].body.post_info.privacy_level, "SELF_ONLY");
  assert.equal(calls[0].headers.Authorization, "Bearer tok");
  assert.equal(calls[1].path, "/v2/post/publish/status/fetch/");
  assert.equal(calls[1].body.publish_id, "pub-1");
});

test("publish: a FAILED status stops polling and surfaces the real fail_reason", async () => {
  const provider = createTikTokProvider();
  let attempts = 0;
  const restore = mockFetch(async (url) => {
    attempts++;
    if (new URL(String(url)).pathname.endsWith("/init/")) return { ok: true, json: async () => ({ data: { publish_id: "pub-1" } }) };
    return { ok: true, json: async () => ({ data: { status: "FAILED", fail_reason: "video too long" } }) };
  });
  await assert.rejects(
    () => provider.publish({ accessToken: "tok", assetUrl: "https://example.com/reel.mp4", pollIntervalMs: 1 }),
    /video too long/
  );
  restore();
  assert.equal(attempts, 2, "must stop polling immediately on a terminal failure, not keep retrying");
});

test("publish: never completing times out honestly rather than hanging or fabricating success", async () => {
  const provider = createTikTokProvider();
  const restore = mockFetch(async (url) => {
    if (new URL(String(url)).pathname.endsWith("/init/")) return { ok: true, json: async () => ({ data: { publish_id: "pub-1" } }) };
    return { ok: true, json: async () => ({ data: { status: "PROCESSING_UPLOAD" } }) };
  });
  await assert.rejects(
    () => provider.publish({ accessToken: "tok", assetUrl: "https://example.com/reel.mp4", pollIntervalMs: 1, pollMaxAttempts: 3 }),
    (err) => err.code === "social_provider_timeout"
  );
  restore();
});

test("publish: an invalid/expired access token is classified distinctly (social_token_invalid)", async () => {
  const provider = createTikTokProvider();
  const restore = mockFetch(async () => ({ ok: false, status: 401, json: async () => ({ error: { code: "access_token_invalid", message: "The access token is invalid or has expired." } }) }));
  await assert.rejects(
    () => provider.publish({ accessToken: "expired", assetUrl: "https://example.com/reel.mp4" }),
    (err) => err.code === "social_token_invalid"
  );
  restore();
});

test("every unimplemented SocialProvider method throws a clear, labeled error rather than doing nothing silently", async () => {
  const provider = createTikTokProvider();
  for (const method of ["connect", "refreshToken", "validateMedia", "schedule", "getStatus", "fetchAnalytics", "disconnect"]) {
    await assert.rejects(() => provider[method](), Error, `tiktok.${method} should throw`);
  }
});
