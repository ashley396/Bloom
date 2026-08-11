import {
  createCircuitBreaker,
  withRetry,
  withTimeout,
  safeAll,
  CircuitOpenError,
} from "../lib/core/resilience.js";

describe("resilience", () => {
  test("circuit breaker opens after repeated failures", async () => {
    const breaker = createCircuitBreaker({ threshold: 2, windowMs: 10_000, cooldownMs: 50 });
    const fail = () => Promise.reject(new Error("down"));
    await expect(breaker.exec(fail)).rejects.toThrow("down");
    await expect(breaker.exec(fail)).rejects.toThrow("down");
    await expect(breaker.exec(fail)).rejects.toThrow(CircuitOpenError);
  });

  test("withRetry succeeds on second attempt", async () => {
    let n = 0;
    const result = await withRetry(async () => {
      n++;
      if (n < 2) throw new Error("transient");
      return "ok";
    }, { attempts: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(n).toBe(2);
  });

  test("withTimeout rejects slow operations", async () => {
    await expect(
      withTimeout(new Promise((r) => setTimeout(() => r("late"), 200)), 30, "slow")
    ).rejects.toMatchObject({ code: "timeout" });
  });

  test("safeAll returns null for failed tasks", async () => {
    const out = await safeAll([
      () => Promise.resolve(1),
      () => Promise.reject(new Error("x")),
      () => Promise.resolve(3),
    ]);
    expect(out).toEqual([1, null, 3]);
  });
});
