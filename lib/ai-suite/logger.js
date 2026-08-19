/**
 * Structured logging for AI Suite micro-modules (marketing, photo, POS).
 * In Netlify, logs go to function stdout; include shopId for traceability.
 */

export function logAiSuiteEvent(level, event, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    service: "florisyn-ai-suite",
    level,
    event,
    ...meta
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  return entry;
}

export function logAiSuiteError(event, error, meta = {}) {
  return logAiSuiteEvent("error", event, {
    ...meta,
    message: error?.message || String(error),
    code: error?.code || null
  });
}
