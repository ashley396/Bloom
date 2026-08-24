import test from "node:test";
import assert from "node:assert/strict";
import { createFacebookPagesProvider, createInstagramProvider } from "../netlify/functions/_shared/marketing-social-adapter-meta.js";

function mockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("facebook publish: requires accessToken and externalAccountId before ever attempting a request", async () => {
  const provider = createFacebookPagesProvider();
  let called = false;
  const restore = mockFetch(async () => {
    called = true;
    throw new Error("should not be called");
  });
  await assert.rejects(() => provider.publish({}), /access token/);
  restore();
  assert.equal(called, false);
});

test("facebook publish: an image posts to /{page-id}/photos with url+caption+access_token", async () => {
  const provider = createFacebookPagesProvider();
  let capturedUrl;
  const restore = mockFetch(async (url) => {
    capturedUrl = new URL(String(url));
    return { ok: true, json: async () => ({ id: "photo-1", post_id: "page-1_post-1" }) };
  });
  const result = await provider.publish({ accessToken: "tok", externalAccountId: "page-1", assetUrl: "https://example.com/bouquet.jpg", caption: "Fresh today!" });
  restore();
  assert.equal(result.externalPostId, "page-1_post-1");
  assert.match(capturedUrl.pathname, /\/page-1\/photos$/);
  assert.equal(capturedUrl.searchParams.get("url"), "https://example.com/bouquet.jpg");
  assert.equal(capturedUrl.searchParams.get("caption"), "Fresh today!");
  assert.equal(capturedUrl.searchParams.get("access_token"), "tok");
});

test("facebook publish: no image — posts text to /{page-id}/feed instead", async () => {
  const provider = createFacebookPagesProvider();
  let capturedUrl;
  const restore = mockFetch(async (url) => {
    capturedUrl = new URL(String(url));
    return { ok: true, json: async () => ({ id: "page-1_post-2" }) };
  });
  const result = await provider.publish({ accessToken: "tok", externalAccountId: "page-1", caption: "Wedding season is here." });
  restore();
  assert.equal(result.externalPostId, "page-1_post-2");
  assert.match(capturedUrl.pathname, /\/page-1\/feed$/);
  assert.equal(capturedUrl.searchParams.get("message"), "Wedding season is here.");
});

test("facebook publish: neither image nor caption is refused before any request", async () => {
  const provider = createFacebookPagesProvider();
  let called = false;
  const restore = mockFetch(async () => {
    called = true;
    return { ok: true, json: async () => ({}) };
  });
  await assert.rejects(() => provider.publish({ accessToken: "tok", externalAccountId: "page-1" }), /nothing to publish/);
  restore();
  assert.equal(called, false);
});

test("facebook publish: an expired/invalid token is classified distinctly (social_token_invalid), not a generic error", async () => {
  const provider = createFacebookPagesProvider();
  const restore = mockFetch(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "Error validating access token", code: 190 } }) }));
  await assert.rejects(
    () => provider.publish({ accessToken: "expired", externalAccountId: "page-1", caption: "hi" }),
    (err) => err.code === "social_token_invalid"
  );
  restore();
});

test("instagram publish: requires an assetUrl — no text-only post type", async () => {
  const provider = createInstagramProvider();
  await assert.rejects(() => provider.publish({ accessToken: "tok", externalAccountId: "ig-1" }), /image_url is required/);
});

test("instagram publish: creates a media container, polls until FINISHED, then publishes", async () => {
  const provider = createInstagramProvider();
  const calls = [];
  const restore = mockFetch(async (url) => {
    const u = new URL(String(url));
    calls.push(u.pathname + u.search);
    if (u.pathname.endsWith("/media") && !u.pathname.endsWith("/media_publish")) {
      return { ok: true, json: async () => ({ id: "container-1" }) };
    }
    if (u.pathname.endsWith("/container-1")) {
      return { ok: true, json: async () => ({ status_code: "FINISHED" }) };
    }
    if (u.pathname.endsWith("/media_publish")) {
      return { ok: true, json: async () => ({ id: "ig-post-1" }) };
    }
    throw new Error(`unexpected request: ${u.pathname}`);
  });
  const result = await provider.publish({ accessToken: "tok", externalAccountId: "ig-1", assetUrl: "https://example.com/bouquet.jpg", caption: "Order today", pollIntervalMs: 1 });
  restore();
  assert.equal(result.externalPostId, "ig-post-1");
  assert.ok(calls.some((c) => c.includes("/ig-1/media?")));
  assert.ok(calls.some((c) => c.includes("/container-1") && c.includes("fields=status_code")));
  assert.ok(calls.some((c) => c.includes("/ig-1/media_publish")));
});

test("instagram publish: a container that reports ERROR fails immediately, never publishes", async () => {
  const provider = createInstagramProvider();
  let publishCalled = false;
  const restore = mockFetch(async (url) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/media_publish")) {
      publishCalled = true;
      return { ok: true, json: async () => ({ id: "should-not-happen" }) };
    }
    if (u.pathname.endsWith("/media")) return { ok: true, json: async () => ({ id: "container-1" }) };
    return { ok: true, json: async () => ({ status_code: "ERROR" }) };
  });
  await assert.rejects(
    () => provider.publish({ accessToken: "tok", externalAccountId: "ig-1", assetUrl: "https://example.com/bouquet.jpg", pollIntervalMs: 1 }),
    /failed to process/
  );
  restore();
  assert.equal(publishCalled, false);
});

test("instagram publish: never finishing processing times out honestly instead of hanging or fabricating success", async () => {
  const provider = createInstagramProvider();
  const restore = mockFetch(async (url) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/media")) return { ok: true, json: async () => ({ id: "container-1" }) };
    return { ok: true, json: async () => ({ status_code: "IN_PROGRESS" }) };
  });
  await assert.rejects(
    () => provider.publish({ accessToken: "tok", externalAccountId: "ig-1", assetUrl: "https://example.com/bouquet.jpg", pollIntervalMs: 1, pollMaxAttempts: 3 }),
    (err) => err.code === "social_provider_timeout"
  );
  restore();
});

test("every unimplemented SocialProvider method throws a clear, labeled error rather than doing nothing silently", async () => {
  const facebook = createFacebookPagesProvider();
  const instagram = createInstagramProvider();
  for (const provider of [facebook, instagram]) {
    for (const method of ["connect", "refreshToken", "validateMedia", "schedule", "getStatus", "disconnect"]) {
      await assert.rejects(() => provider[method](), Error, `${provider.platform}.${method} should throw`);
    }
  }
});
