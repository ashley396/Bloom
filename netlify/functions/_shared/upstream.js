const DEFAULT_TIMEOUT_MS = 5_000;

/** Fetch an upstream service with a bounded deadline and a safe 503 on timeout. */
export async function fetchWithTimeout(url, options = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, service = "Upstream service" } = {}) {
  const normalizedTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(normalizedTimeout);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

  try {
    return await fetch(url, { ...options, signal });
  } catch (error) {
    if (timeoutSignal.aborted || error?.name === "TimeoutError") {
      const timeoutError = new Error(`${service} timed out. Please try again.`);
      timeoutError.statusCode = 503;
      timeoutError.code = "upstream_timeout";
      throw timeoutError;
    }
    throw error;
  }
}

export function requestIdOf(event) {
  const raw =
    event?.headers?.["x-florisyn-request-id"] ||
    event?.headers?.["X-Florisyn-Request-Id"] ||
    event?.headers?.["x-nf-request-id"] ||
    "";
  const value = String(raw).trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(value) ? value : null;
}
