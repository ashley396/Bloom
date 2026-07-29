import crypto from "node:crypto";
import { checkRateLimit } from "./production.js";

function timingSafeEqual(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

/** Rate limits for unauthenticated bootstrap endpoints. */
export function bootstrapRateLimit(event, method) {
  const key = method === "POST" ? "admin-bootstrap-post" : "admin-bootstrap-get";
  const limit = method === "POST" ? 10 : 60;
  return checkRateLimit(event, { key, limit, windowMs: 60_000 });
}

/**
 * When PLATFORM_BOOTSTRAP_SECRET is set, first-time POST must include the same value
 * (body.bootstrapSecret only — no custom headers). FLORISYN_ALLOW_OPEN_BOOTSTRAP=true allows open POST only when
 * secret env is unset (local dev).
 */
export function verifyBootstrapSecret(body = {}, env = process.env) {
  const configured = String(env.PLATFORM_BOOTSTRAP_SECRET || "").trim();
  if (!configured) {
    if (String(env.FLORISYN_ALLOW_OPEN_BOOTSTRAP || "").toLowerCase() === "true") {
      return { ok: true };
    }
    const err = new Error(
      "Platform owner setup is not configured on the server yet. Whoever manages Florisyn hosting must add PLATFORM_BOOTSTRAP_SECRET in Netlify before the first owner can be created."
    );
    err.statusCode = 503;
    err.code = "bootstrap_config_missing";
    return { ok: false, error: err };
  }
  const provided = String(body.bootstrapSecret || body.bootstrap_secret || "").trim();
  if (!provided) {
    const err = new Error("Enter the platform setup key from your Florisyn host.");
    err.statusCode = 403;
    err.code = "bootstrap_secret_missing";
    return { ok: false, error: err };
  }
  if (!timingSafeEqual(provided, configured)) {
    const err = new Error("That setup key is not correct. Check the key in Netlify and try again.");
    err.statusCode = 403;
    err.code = "bootstrap_secret_invalid";
    return { ok: false, error: err };
  }
  return { ok: true };
}
