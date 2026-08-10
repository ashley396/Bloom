/**
 * Fault-tolerance primitives for Florisyn backend services.
 * Circuit breaker + retry + timeout — keeps POS/orders alive under load.
 */

export class CircuitOpenError extends Error {
  constructor(message = "Service temporarily unavailable") {
    super(message);
    this.name = "CircuitOpenError";
    this.code = "circuit_open";
  }
}

/**
 * Simple circuit breaker: after `threshold` failures within `windowMs`,
 * reject calls until `cooldownMs` elapses.
 */
export function createCircuitBreaker(options = {}) {
  const threshold = options.threshold ?? 5;
  const windowMs = options.windowMs ?? 60_000;
  const cooldownMs = options.cooldownMs ?? 15_000;
  let failures = [];
  let openedAt = 0;

  function prune(now) {
    failures = failures.filter((t) => now - t < windowMs);
  }

  return {
    async exec(fn) {
      const now = Date.now();
      prune(now);
      if (openedAt && now - openedAt < cooldownMs) {
        throw new CircuitOpenError();
      }
      if (openedAt && now - openedAt >= cooldownMs) {
        openedAt = 0;
        failures = [];
      }
      try {
        const result = await fn();
        failures = [];
        return result;
      } catch (err) {
        failures.push(now);
        prune(now);
        if (failures.length >= threshold) openedAt = now;
        throw err;
      }
    },
    state() {
      const now = Date.now();
      prune(now);
      return {
        open: Boolean(openedAt && now - openedAt < cooldownMs),
        failures: failures.length,
        threshold,
      };
    },
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry with exponential backoff; never retries 4xx client errors. */
export async function withRetry(fn, options = {}) {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 120;
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastError = err;
      const status = err?.statusCode ?? err?.status;
      if (status >= 400 && status < 500) throw err;
      if (i < attempts - 1) await sleep(baseDelayMs * 2 ** i);
    }
  }
  throw lastError;
}

/** Race a promise against a timeout; rejects with a typed error on expiry. */
export function withTimeout(promise, ms, label = "operation") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms}ms`);
      err.code = "timeout";
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Aggregate multiple independent queries; failed ones become null instead of crashing. */
export async function safeAll(tasks) {
  const results = await Promise.allSettled(tasks.map((t) => (typeof t === "function" ? t() : t)));
  return results.map((r) => (r.status === "fulfilled" ? r.value : null));
}
