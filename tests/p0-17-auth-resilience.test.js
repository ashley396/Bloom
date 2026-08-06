import assert from "node:assert/strict";
import test from "node:test";

import authAdmission, { config as authAdmissionConfig } from "../netlify/edge-functions/auth-admission.js";
import { fetchWithTimeout, requestIdOf } from "../netlify/functions/_shared/upstream.js";

test("distributed auth admission covers password routes but excludes refresh", () => {
  assert.equal(authAdmissionConfig.rateLimit.windowLimit, 30);
  assert.equal(authAdmissionConfig.rateLimit.windowSize, 60);
  assert.deepEqual(authAdmissionConfig.rateLimit.aggregateBy, ["ip", "domain"]);
  assert.ok(authAdmissionConfig.path.includes("/.netlify/functions/auth-login"));
  assert.ok(authAdmissionConfig.path.includes("/.netlify/functions/auth-signup"));
  assert.ok(!authAdmissionConfig.path.some((path) => path.includes("auth-refresh")));
});

test("auth admission propagates one request id without consuming the body", async () => {
  const request = new Request("https://florisyn-staging.netlify.app/.netlify/functions/auth-login", {
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

test("bounded upstream fetch returns a safe 503 timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  try {
    await assert.rejects(
      fetchWithTimeout("https://example.invalid", {}, { timeoutMs: 5, service: "Authentication service" }),
      (error) => error?.statusCode === 503 && error?.code === "upstream_timeout"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("request id accepts provider ids and rejects unsafe log input", () => {
  assert.equal(
    requestIdOf({ headers: { "x-florisyn-request-id": "01NETLIFYREQUESTID123456789" } }),
    "01NETLIFYREQUESTID123456789"
  );
  assert.equal(requestIdOf({ headers: { "x-florisyn-request-id": "bad id\nforged" } }), null);
});
