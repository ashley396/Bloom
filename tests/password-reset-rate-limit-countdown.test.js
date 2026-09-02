import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveProviderRetryAfterSeconds,
  mapAuthProviderFailure,
  FALLBACK_RATE_LIMIT_RETRY_SECONDS
} from "../netlify/functions/_shared/auth-email.js";
import { handler } from "../netlify/functions/auth-forgot-password.js";

/**
 * Password-reset rate-limit countdown: the forgot-password endpoint must
 * always hand the client a real retry_after_seconds when it returns
 * auth_rate_limited, sourced from (in order): Florisyn's own local
 * limiter's actual remaining window; a trustworthy Supabase-provided
 * Retry-After (header or body); or, only when neither exists, a
 * conservative, clearly-labeled fallback. This is scoped to the recover
 * flow only — login/signup/resend/reset keep their existing response
 * shape untouched.
 */

function fakeEvent({ ip, body }) {
  return {
    httpMethod: "POST",
    headers: { "x-forwarded-for": ip, origin: "https://florisyn-staging.netlify.app" },
    body: JSON.stringify(body)
  };
}

function fakeSupabaseEnv() {
  const original = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY };
  process.env.SUPABASE_URL = "https://example-project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  return () => {
    if (original.SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = original.SUPABASE_URL;
    if (original.SUPABASE_ANON_KEY === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = original.SUPABASE_ANON_KEY;
  };
}

function mockFetchOnce(responseFactory) {
  const original = global.fetch;
  global.fetch = async () => responseFactory();
  return () => {
    global.fetch = original;
  };
}

test("local rate limit: 429 includes a real retry_after_seconds derived from the actual remaining window", async () => {
  const ip = "203.0.113.10";
  let last;
  for (let i = 0; i < 11; i++) {
    last = await handler(fakeEvent({ ip, body: { email: "florist@example.invalid" } }));
  }
  assert.equal(last.statusCode, 429);
  const parsed = JSON.parse(last.body);
  assert.equal(parsed.code, "auth_rate_limited");
  assert.equal(typeof parsed.retry_after_seconds, "number");
  // The local limiter's window is 60s — the remaining time can never exceed it.
  assert.ok(parsed.retry_after_seconds >= 1 && parsed.retry_after_seconds <= 60, `expected 1-60, got ${parsed.retry_after_seconds}`);
});

test("local rate limit response never reveals whether the email exists (anti-enumeration preserved)", async () => {
  const ip = "203.0.113.11";
  let last;
  for (let i = 0; i < 11; i++) {
    last = await handler(fakeEvent({ ip, body: { email: "definitely-not-a-real-account@example.invalid" } }));
  }
  const parsed = JSON.parse(last.body);
  assert.doesNotMatch(parsed.error, /exist|not found|no account/i);
});

test("resolveProviderRetryAfterSeconds: a numeric Retry-After header (seconds) is normalized", () => {
  const response = { headers: { get: (name) => (name === "retry-after" ? "37" : null) } };
  const resolved = resolveProviderRetryAfterSeconds(response, {});
  assert.deepEqual(resolved, { seconds: 37, source: "provider_header" });
});

test("resolveProviderRetryAfterSeconds: an HTTP-date Retry-After header is converted to a positive second count", () => {
  const future = new Date(Date.now() + 45_000).toUTCString();
  const response = { headers: { get: (name) => (name === "retry-after" ? future : null) } };
  const resolved = resolveProviderRetryAfterSeconds(response, {});
  assert.equal(resolved.source, "provider_header");
  // Allow a little slack for the toUTCString() second-resolution rounding.
  assert.ok(resolved.seconds >= 43 && resolved.seconds <= 46, `expected ~45, got ${resolved.seconds}`);
});

test("resolveProviderRetryAfterSeconds: a numeric retry_after field in the provider body is trusted when there is no header", () => {
  const response = { headers: { get: () => null } };
  const resolved = resolveProviderRetryAfterSeconds(response, { retry_after: 22 });
  assert.deepEqual(resolved, { seconds: 22, source: "provider_body" });
});

test("resolveProviderRetryAfterSeconds: an absurd/hostile Retry-After is clamped, never trusted as-is", () => {
  const response = { headers: { get: (name) => (name === "retry-after" ? "999999" : null) } };
  const resolved = resolveProviderRetryAfterSeconds(response, {});
  assert.equal(resolved.seconds, 900);
});

test("resolveProviderRetryAfterSeconds: no header and no body value returns null (nothing invented)", () => {
  const response = { headers: { get: () => null } };
  assert.equal(resolveProviderRetryAfterSeconds(response, {}), null);
  assert.equal(resolveProviderRetryAfterSeconds(response, { retry_after: "not-a-number" }), null);
  assert.equal(resolveProviderRetryAfterSeconds(response, { retry_after: -5 }), null);
});

test("mapAuthProviderFailure: a provider 429 with a trustworthy Retry-After is normalized for the recover flow", () => {
  const response = { status: 429, headers: { get: (name) => (name === "retry-after" ? "12" : null) } };
  const mapped = mapAuthProviderFailure(response, {}, { flow: "recover" });
  assert.equal(mapped.code, "auth_rate_limited");
  assert.equal(mapped.retryAfterSeconds, 12);
  assert.equal(mapped.retryAfterSource, "provider_header");
});

test("mapAuthProviderFailure: a provider 429 with no usable wait value falls back, clearly labeled", () => {
  const response = { status: 429, headers: { get: () => null } };
  const mapped = mapAuthProviderFailure(response, {}, { flow: "recover" });
  assert.equal(mapped.retryAfterSeconds, FALLBACK_RATE_LIMIT_RETRY_SECONDS);
  assert.equal(mapped.retryAfterSource, "fallback");
});

test("mapAuthProviderFailure: retry-after countdown is scoped to the recover flow only — login is untouched", () => {
  const response = { status: 429, headers: { get: (name) => (name === "retry-after" ? "12" : null) } };
  const mapped = mapAuthProviderFailure(response, {}, { flow: "login" });
  assert.equal(mapped.code, "auth_rate_limited");
  assert.equal(mapped.retryAfterSeconds, undefined);
  assert.equal(mapped.retryAfterSource, undefined);
});

test("handler: a Supabase-side 429 with Retry-After is surfaced end to end as retry_after_seconds", async () => {
  const restoreEnv = fakeSupabaseEnv();
  const restoreFetch = mockFetchOnce(() => ({
    ok: false,
    status: 429,
    headers: { get: (name) => (name === "retry-after" ? "25" : null) },
    json: async () => ({ error_code: "over_email_send_rate_limit", msg: "email rate limit exceeded" })
  }));
  try {
    const result = await handler(fakeEvent({ ip: "203.0.113.20", body: { email: "florist@example.invalid" } }));
    assert.equal(result.statusCode, 429);
    const parsed = JSON.parse(result.body);
    assert.equal(parsed.code, "auth_rate_limited");
    assert.equal(parsed.retry_after_seconds, 25);
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test("handler: normal success path is unchanged — generic accepted message, no retry_after_seconds field", async () => {
  const restoreEnv = fakeSupabaseEnv();
  const restoreFetch = mockFetchOnce(() => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({})
  }));
  try {
    const result = await handler(fakeEvent({ ip: "203.0.113.30", body: { email: "florist@example.invalid" } }));
    assert.equal(result.statusCode, 200);
    const parsed = JSON.parse(result.body);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.code, "recover_accepted");
    assert.equal(parsed.retry_after_seconds, undefined);
    assert.match(parsed.message, /if an account exists/i);
  } finally {
    restoreFetch();
    restoreEnv();
  }
});
