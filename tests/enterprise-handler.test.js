import test from "node:test";
import assert from "node:assert/strict";
import { withEnterpriseHandler } from "../netlify/functions/_shared/enterprise-handler.js";

// enterprise-handler.js had zero test coverage despite being the wrapper
// that gives every function it wraps rate limiting, a timeout, and
// consistent (non-leaking) error responses. Each test uses a distinct
// x-forwarded-for IP so it gets its own rate-limit bucket, since the
// limiter inside the module is shared across calls in this process.

let ipCounter = 0;
function eventWithFreshIp(overrides = {}) {
  ipCounter += 1;
  return {
    httpMethod: "POST",
    path: "/.netlify/functions/test-fn",
    headers: { "x-forwarded-for": `10.0.0.${ipCounter}` },
    ...overrides,
  };
}

test("withEnterpriseHandler: an OPTIONS preflight short-circuits with 204 and never invokes the real handler", async () => {
  let called = false;
  const wrapped = withEnterpriseHandler(() => { called = true; return { statusCode: 200, body: "{}" }; });
  const res = await wrapped(eventWithFreshIp({ httpMethod: "OPTIONS" }));
  assert.equal(res.statusCode, 204);
  assert.equal(called, false);
});

test("withEnterpriseHandler: a normal call passes through to the real handler and returns its response untouched", async () => {
  const wrapped = withEnterpriseHandler(async () => ({ statusCode: 200, body: JSON.stringify({ ok: true }) }));
  const res = await wrapped(eventWithFreshIp());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});

test("withEnterpriseHandler: exhausting the rate limit returns 429 with a Retry-After header, without calling the handler again", async () => {
  const event = eventWithFreshIp();
  let calls = 0;
  const wrapped = withEnterpriseHandler(async () => { calls++; return { statusCode: 200, body: "{}" }; });
  // capacity is 180 for a fresh bucket — drain it, then the next call must 429.
  for (let i = 0; i < 180; i++) await wrapped(event);
  const denied = await wrapped(event);
  assert.equal(denied.statusCode, 429);
  assert.ok(denied.headers["Retry-After"]);
  assert.equal(calls, 180, "the handler must not run once the bucket is exhausted");
});

test("withEnterpriseHandler: a handler that exceeds timeoutMs returns 504 with code:timeout, not an unhandled rejection", async () => {
  const wrapped = withEnterpriseHandler(() => new Promise((resolve) => setTimeout(() => resolve({ statusCode: 200, body: "{}" }), 200)), {
    timeoutMs: 10,
  });
  const res = await wrapped(eventWithFreshIp());
  assert.equal(res.statusCode, 504);
  const body = JSON.parse(res.body);
  assert.equal(body.code, "timeout");
});

test("withEnterpriseHandler: a circuit_open error from the handler maps to 503, distinctly from a timeout", async () => {
  const wrapped = withEnterpriseHandler(async () => {
    const err = new Error("breaker tripped");
    err.code = "circuit_open";
    throw err;
  });
  const res = await wrapped(eventWithFreshIp());
  assert.equal(res.statusCode, 503);
  const body = JSON.parse(res.body);
  assert.equal(body.code, "circuit_open");
});

test("withEnterpriseHandler: a thrown error with a real 4xx statusCode is passed through with its own message", async () => {
  const wrapped = withEnterpriseHandler(async () => {
    const err = new Error("Invalid shop id");
    err.statusCode = 400;
    throw err;
  });
  const res = await wrapped(eventWithFreshIp());
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.equal(body.error, "Invalid shop id");
});

test("withEnterpriseHandler: an unexpected error (no statusCode, or a 5xx) is masked to a generic message — internals never leak to the client", async () => {
  const wrapped = withEnterpriseHandler(async () => {
    throw new Error("TypeError: cannot read property 'x' of undefined at internal/db.js:42");
  });
  const res = await wrapped(eventWithFreshIp());
  assert.equal(res.statusCode, 500);
  const body = JSON.parse(res.body);
  assert.equal(body.error, "An unexpected error occurred.");
  assert.doesNotMatch(body.error, /db\.js|TypeError/, "the real error detail must never reach the client");
});

test("withEnterpriseHandler: rateLimitCost is honored — a higher-cost call drains the bucket faster", async () => {
  const event = eventWithFreshIp();
  const wrapped = withEnterpriseHandler(async () => ({ statusCode: 200, body: "{}" }), { rateLimitCost: 60 });
  await wrapped(event);
  await wrapped(event);
  await wrapped(event);
  const denied = await wrapped(event);
  assert.equal(denied.statusCode, 429, "4 calls at cost 60 should exceed the default capacity of 180");
});
