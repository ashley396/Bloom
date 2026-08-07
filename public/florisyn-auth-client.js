/**
 * Shared calm handling for Florisyn auth HTTP responses (429 / Retry-After).
 * Used by login, signup, and verify-email pages.
 */
(function (global) {
  function retryAfterSeconds(response, data) {
    const header = response?.headers?.get?.("Retry-After");
    const fromHeader = Number(header);
    if (Number.isFinite(fromHeader) && fromHeader > 0) return Math.min(120, Math.ceil(fromHeader));
    const fromBody = Number(data?.retryAfterSeconds);
    if (Number.isFinite(fromBody) && fromBody > 0) return Math.min(120, Math.ceil(fromBody));
    return 30;
  }

  function rateLimitMessage(seconds, fallback) {
    const wait = Math.max(1, Number(seconds) || 30);
    return fallback || `Too many attempts. Please wait about ${wait} seconds and try again.`;
  }

  async function postAuth(url, body) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 8_000) : null;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller?.signal
      });
      const data = await response.json().catch(() => ({}));
      const retry = response.status === 429 ? retryAfterSeconds(response, data) : null;
      return { response, data, retryAfterSeconds: retry };
    } catch (error) {
      if (error?.name === "AbortError") {
        const err = new Error("The request timed out. Please try again.");
        err.code = "upstream_timeout";
        throw err;
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  global.FlorisynAuthClient = { retryAfterSeconds, rateLimitMessage, postAuth };
})(typeof window !== "undefined" ? window : globalThis);
