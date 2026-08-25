import test from "node:test";
import assert from "node:assert/strict";
import {
  CircuitOpenError,
  createCircuitBreaker,
  sleep,
  withRetry,
  withTimeout,
  safeAll,
} from "../lib/core/resilience.js";

// lib/core/resilience.js (circuit breaker / retry / timeout) had zero test
// coverage despite being the fault-tolerance layer the module's own comment
// says "keeps POS/orders alive under load" — worth locking down for real.

test("CircuitOpenError: has the expected name/code, and a sensible default message", () => {
  const err = new CircuitOpenError();
  assert.equal(err.name, "CircuitOpenError");
  assert.equal(err.code, "circuit_open");
  assert.match(err.message, /temporarily unavailable/i);
  assert.ok(err instanceof Error);
});

test("createCircuitBreaker: a successful call clears prior failures and returns the result", async () => {
  const breaker = createCircuitBreaker({ threshold: 2 });
  await assert.rejects(() => breaker.exec(() => Promise.reject(new Error("boom"))));
  assert.equal(breaker.state().failures, 1);
  const result = await breaker.exec(() => Promise.resolve("ok"));
  assert.equal(result, "ok");
  assert.equal(breaker.state().failures, 0, "a success should reset the failure count");
});

test("createCircuitBreaker: opens after reaching the failure threshold, rejecting further calls without invoking fn", async () => {
  const breaker = createCircuitBreaker({ threshold: 2, cooldownMs: 10_000 });
  await assert.rejects(() => breaker.exec(() => Promise.reject(new Error("1"))));
  await assert.rejects(() => breaker.exec(() => Promise.reject(new Error("2"))));
  assert.equal(breaker.state().open, true);

  let called = false;
  await assert.rejects(
    () => breaker.exec(() => { called = true; return Promise.resolve("should not run"); }),
    CircuitOpenError
  );
  assert.equal(called, false, "an open circuit must not invoke fn at all");
});

test("createCircuitBreaker: closes again once the cooldown elapses", async (t) => {
  const realNow = Date.now;
  let fakeNow = 1_000_000;
  t.mock.method(Date, "now", () => fakeNow);
  try {
    const breaker = createCircuitBreaker({ threshold: 1, cooldownMs: 5_000 });
    await assert.rejects(() => breaker.exec(() => Promise.reject(new Error("boom"))));
    assert.equal(breaker.state().open, true);

    fakeNow += 5_001;
    assert.equal(breaker.state().open, false, "state() must report closed once cooldown has elapsed");
    const result = await breaker.exec(() => Promise.resolve("recovered"));
    assert.equal(result, "recovered");
  } finally {
    Date.now = realNow;
  }
});

test("createCircuitBreaker: failures outside the tracking window are pruned, not counted toward the threshold", async (t) => {
  const realNow = Date.now;
  let fakeNow = 1_000_000;
  t.mock.method(Date, "now", () => fakeNow);
  try {
    const breaker = createCircuitBreaker({ threshold: 2, windowMs: 1_000 });
    await assert.rejects(() => breaker.exec(() => Promise.reject(new Error("old"))));
    fakeNow += 2_000; // outside the window
    await assert.rejects(() => breaker.exec(() => Promise.reject(new Error("new"))));
    assert.equal(breaker.state().open, false, "a stale failure must not combine with a fresh one to trip the breaker");
    assert.equal(breaker.state().failures, 1);
  } finally {
    Date.now = realNow;
  }
});

test("sleep: resolves after roughly the requested delay", async () => {
  const start = Date.now();
  await sleep(20);
  assert.ok(Date.now() - start >= 15, "sleep resolved suspiciously early");
});

test("withRetry: returns the result immediately on first success, no retries", async () => {
  let calls = 0;
  const result = await withRetry(() => { calls++; return Promise.resolve("ok"); });
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("withRetry: retries on failure and succeeds within the attempt budget", async () => {
  let calls = 0;
  const result = await withRetry(
    () => {
      calls++;
      if (calls < 3) return Promise.reject(new Error("transient"));
      return Promise.resolve("recovered");
    },
    { attempts: 5, baseDelayMs: 1 }
  );
  assert.equal(result, "recovered");
  assert.equal(calls, 3);
});

test("withRetry: exhausts attempts and throws the last error", async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(() => { calls++; return Promise.reject(new Error(`fail-${calls}`)); }, { attempts: 3, baseDelayMs: 1 }),
    /fail-3/
  );
  assert.equal(calls, 3);
});

test("withRetry: never retries a 4xx client error — fails fast on the first attempt", async () => {
  let calls = 0;
  const err = new Error("bad request");
  err.statusCode = 400;
  await assert.rejects(
    () => withRetry(() => { calls++; return Promise.reject(err); }, { attempts: 5, baseDelayMs: 1 }),
    /bad request/
  );
  assert.equal(calls, 1, "a 4xx must not be retried");
});

test("withRetry: does retry a 5xx server error", async () => {
  let calls = 0;
  const result = await withRetry(
    () => {
      calls++;
      if (calls === 1) {
        const err = new Error("server hiccup");
        err.statusCode = 503;
        return Promise.reject(err);
      }
      return Promise.resolve("ok");
    },
    { attempts: 3, baseDelayMs: 1 }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("withTimeout: resolves with the promise's value when it settles before the deadline", async () => {
  const result = await withTimeout(Promise.resolve("fast"), 1000);
  assert.equal(result, "fast");
});

test("withTimeout: rejects with a typed timeout error when the promise is too slow", async () => {
  const slow = new Promise((resolve) => setTimeout(() => resolve("too late"), 200));
  await assert.rejects(
    () => withTimeout(slow, 10, "inventory lookup"),
    (err) => {
      assert.equal(err.code, "timeout");
      assert.match(err.message, /inventory lookup timed out after 10ms/);
      return true;
    }
  );
});

test("safeAll: mixes functions and bare promises, returning results in order", async () => {
  const results = await safeAll([() => Promise.resolve(1), Promise.resolve(2), () => Promise.resolve(3)]);
  assert.deepEqual(results, [1, 2, 3]);
});

test("safeAll: a failed task becomes null instead of rejecting the whole batch", async () => {
  const results = await safeAll([
    () => Promise.resolve("ok"),
    () => Promise.reject(new Error("this one broke")),
    () => Promise.resolve("also ok"),
  ]);
  assert.deepEqual(results, ["ok", null, "also ok"]);
});

test("safeAll: an empty task list resolves to an empty array", async () => {
  assert.deepEqual(await safeAll([]), []);
});
