import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

import authAdmission, { config as authAdmissionConfig } from "../netlify/edge-functions/auth-admission.js";
import { fetchWithTimeout, requestIdOf } from "../netlify/functions/_shared/upstream.js";

const authLoginSource = fs.readFileSync(new URL("../netlify/functions/auth-login.js", import.meta.url), "utf8");
const authSignupSource = fs.readFileSync(new URL("../netlify/functions/auth-signup.js", import.meta.url), "utf8");
const authForgotSource = fs.readFileSync(new URL("../netlify/functions/auth-forgot-password.js", import.meta.url), "utf8");
const authResetSource = fs.readFileSync(new URL("../netlify/functions/auth-reset-password.js", import.meta.url), "utf8");
const authRefreshSource = fs.readFileSync(new URL("../netlify/functions/auth-refresh.js", import.meta.url), "utf8");

test("distributed auth admission covers password routes but excludes refresh", () => {
  assert.equal(authAdmissionConfig.rateLimit.windowLimit, 30);
  assert.equal(authAdmissionConfig.rateLimit.windowSize, 60);
  assert.deepEqual(authAdmissionConfig.rateLimit.aggregateBy, ["ip", "domain"]);
  assert.equal(authAdmissionConfig.rateLimit.action, "rate_limit");
  assert.ok(authAdmissionConfig.path.includes("/api/auth-login"));
  assert.ok(authAdmissionConfig.path.includes("/api/auth-signup"));
  assert.equal(authAdmissionConfig.path.length, 4);
  assert.ok(!authAdmissionConfig.path.some((path) => path.includes("auth-refresh")));
  assert.ok(!authAdmissionConfig.path.some((path) => path.includes("/.netlify/functions/")));
});

test("netlify.toml attaches redirect rate limits to /api password auth routes", () => {
  const toml = fs.readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  assert.match(toml, /from = "\/api\/auth-login"[\s\S]*?\[redirects\.rate_limit\]/);
  assert.match(toml, /from = "\/api\/auth-signup"[\s\S]*?window_limit = 30/);
  assert.match(toml, /from = "\/api\/auth-forgot-password"[\s\S]*?aggregate_by = \["ip", "domain"\]/);
  assert.match(toml, /from = "\/api\/auth-reset-password"[\s\S]*?window_size = 60/);
  assert.doesNotMatch(toml, /auth-refresh[\s\S]{0,120}rate_limit/);
});

test("auth admission propagates one request id without consuming the body", async () => {
  const request = new Request("https://florisyn-staging.netlify.app/api/auth-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "load@example.invalid", password: "not-a-real-secret" })
  });
  let forwarded;
  const response = await authAdmission(request, {
    requestId: "01NETLIFYREQUESTID123456789",
    nextRequest: async (nextRequest) => {
      forwarded = nextRequest;
      return new Response("{}", { status: 200 });
    }
  });

  assert.equal(forwarded.headers.get("x-florisyn-request-id"), "01NETLIFYREQUESTID123456789");
  assert.match(await forwarded.text(), /load@example\.invalid/);
  assert.equal(response.headers.get("x-request-id"), "01NETLIFYREQUESTID123456789");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("auth admission supports the standard edge next fallback", async () => {
  const request = new Request("https://florisyn-staging.netlify.app/api/auth-login", {
    method: "POST",
    body: "{}"
  });
  let forwarded;
  const response = await authAdmission(request, {
    next: async (nextRequest) => {
      forwarded = nextRequest;
      return new Response(null, { status: 204 });
    }
  });

  assert.match(forwarded.headers.get("x-florisyn-request-id"), /^[0-9a-f-]{36}$/);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("bounded upstream fetch returns a safe 503 timeout", { timeout: 10_000 }, async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  // node:test can drain before an unref'd AbortSignal.timeout timer fires.
  AbortSignal.timeout = (ms) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const reason = new Error("The operation was aborted due to timeout");
      reason.name = "TimeoutError";
      controller.abort(reason);
    }, ms);
    if (typeof timer.unref === "function") timer.ref();
    return controller.signal;
  };
  globalThis.fetch = (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      const onAbort = () => reject(signal.reason || new Error("aborted"));
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  try {
    await assert.rejects(
      fetchWithTimeout("https://example.invalid", {}, { timeoutMs: 40, service: "Authentication service" }),
      (error) => error?.statusCode === 503 && error?.code === "upstream_timeout"
    );
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
});

test("request id accepts provider ids and rejects unsafe log input", () => {
  assert.equal(
    requestIdOf({ headers: { "x-florisyn-request-id": "01NETLIFYREQUESTID123456789" } }),
    "01NETLIFYREQUESTID123456789"
  );
  assert.equal(requestIdOf({ headers: { "x-florisyn-request-id": "bad id\nforged" } }), null);
});

test("auth handlers do not expose raw Supabase auth failure messages", () => {
  assert.match(authLoginSource, /Invalid email or password\./);
  assert.doesNotMatch(authLoginSource, /data\.msg\|\|data\.message/);
  assert.doesNotMatch(authLoginSource, /data\.msg\s*\|\|\s*data\.message/);

  assert.match(authSignupSource, /validateEmail\(body\.email,\{required:true\}\)/);
  assert.match(authSignupSource, /Password must be at least 8 characters\./);
  assert.doesNotMatch(authSignupSource, /data\.msg\|\|data\.message/);

  assert.match(authForgotSource, /If an account exists for this email/);
  assert.doesNotMatch(authForgotSource, /data\.msg\s*\|\|\s*data\.message/);

  assert.match(authResetSource, /This reset link is invalid or expired/);
  assert.doesNotMatch(authResetSource, /data\.msg\s*\|\|\s*data\.message/);
});

test("auth refresh has local validation and rate limiting", () => {
  assert.match(authRefreshSource, /checkRateLimit\(event,\{key:"auth-refresh",limit:120,windowMs:60_000\}\)/);
  assert.match(authRefreshSource, /Refresh token is required\./);
  assert.match(authRefreshSource, /grant_type=refresh_token/);
});

test("password auth routes use distributed Blobs admission", () => {
  const production = fs.readFileSync(new URL("../netlify/functions/_shared/production.js", import.meta.url), "utf8");
  assert.match(production, /checkDistributedRateLimit/);
  assert.match(production, /@netlify\/blobs/);
  assert.match(production, /connectLambda\(event\)/);
  assert.match(production, /florisyn-auth-admission/);
  assert.match(authLoginSource, /checkDistributedRateLimit/);
  assert.match(authSignupSource, /checkDistributedRateLimit/);
  assert.match(authForgotSource, /checkDistributedRateLimit/);
  assert.match(authResetSource, /checkDistributedRateLimit/);
  assert.match(authLoginSource, /Retry-After/);
});
