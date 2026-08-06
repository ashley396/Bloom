function normalizeOrigin(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

export function allowedOrigins(env = process.env) {
  const primary = normalizeOrigin(env.SITE_URL || env.URL || "");
  const extras = String(env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
  const known = [
    "https://www.florisyn.com",
    "https://florisyn.com",
    "https://florisyn-staging.netlify.app"
  ];
  return [...new Set([primary, ...known, ...extras].filter(Boolean))];
}

/** Prefer SITE_URL; reflect request Origin only when it is an allowlisted host. */
export function corsOrigin(env = process.env, requestOrigin = "") {
  const allowed = allowedOrigins(env);
  const origin = normalizeOrigin(requestOrigin);
  if (origin && allowed.includes(origin)) return origin;
  const primary = normalizeOrigin(env.SITE_URL || env.URL || "");
  if (primary) return primary;
  return "https://florisyn-staging.netlify.app";
}

function securityHeaders(env = process.env, requestOrigin = "") {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Access-Control-Allow-Origin": corsOrigin(env, requestOrigin),
    Vary: "Origin",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS"
  };
}

export function json(statusCode, body, env = process.env, event = null) {
  const requestOrigin = event?.headers?.origin || event?.headers?.Origin || "";
  return {
    statusCode,
    headers: securityHeaders(env, requestOrigin),
    body: JSON.stringify(body)
  };
}

export function preflight(event, env = process.env) {
  return event.httpMethod === "OPTIONS" ? json(204, {}, env, event) : null;
}

export function bodyOf(event) {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    const e = new Error("Invalid request body");
    e.statusCode = 400;
    throw e;
  }
}

export function methodNotAllowed(env = process.env, event = null) {
  return json(405, { error: "Method not allowed" }, env, event);
}
