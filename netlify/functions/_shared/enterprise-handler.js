/**
 * Enterprise-grade Netlify function wrapper: security headers, rate limiting,
 * structured errors, and graceful degradation under concurrent load.
 */

import { json, preflight } from "./http.js";
import { createRateLimiter, clientKeyFromEvent } from "../../../lib/core/security.js";
import { withTimeout } from "../../../lib/core/resilience.js";

const limiter = createRateLimiter({ capacity: 180, refillPerSec: 3 });

/**
 * Wrap a handler with rate limiting + timeout + consistent error responses.
 * @param {Function} handler async (event, context) => response
 * @param {object} options { timeoutMs, rateLimitCost }
 */
export function withEnterpriseHandler(handler, options = {}) {
  const timeoutMs = options.timeoutMs ?? 25_000;
  const cost = options.rateLimitCost ?? 1;

  return async (event, context) => {
    const pf = preflight(event);
    if (pf) return pf;

    const key = clientKeyFromEvent(event);
    const rate = limiter.take(key, cost);
    if (!rate.allowed) {
      return {
        ...json(429, { error: "Too many requests. Please retry shortly.", retryAfterMs: rate.retryAfterMs }, process.env, event),
        headers: {
          ...json(429, {}, process.env, event).headers,
          "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)),
        },
      };
    }

    try {
      return await withTimeout(handler(event, context), timeoutMs, event.path || "function");
    } catch (err) {
      if (err?.code === "timeout") {
        return json(504, { error: "Request timed out. Your shop data is safe — please retry.", code: "timeout" }, process.env, event);
      }
      if (err?.code === "circuit_open") {
        return json(503, { error: "Service is busy. Florisyn POS remains available offline.", code: "circuit_open" }, process.env, event);
      }
      const status = err?.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
      const message = status === 500 ? "An unexpected error occurred." : err.message || "Request failed.";
      console.error("[enterprise-handler]", event.path, err);
      return json(status, { error: message, code: err?.code || null }, process.env, event);
    }
  };
}
