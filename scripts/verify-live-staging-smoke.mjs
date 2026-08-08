const DEFAULT_BASE = "https://florisyn-staging.netlify.app";
const BASE = String(process.env.FLORISYN_STAGING_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
const REQUEST_ID = `smoke-${Date.now().toString(36)}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasSecretLikeValue(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /(sb_secret_|service_role|sk_live_|sk_test_|whsec_|Bearer\s+[A-Za-z0-9._-]+)/i.test(text || "");
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "x-florisyn-request-id": REQUEST_ID,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { response, body };
}

function assertFunctionHeaders(response, name) {
  assert(response.headers.get("cache-control")?.includes("no-store"), `${name} must return no-store.`);
  assert(response.headers.get("vary")?.toLowerCase().includes("origin"), `${name} must vary by Origin.`);
  assert(response.headers.get("access-control-allow-origin") !== "*", `${name} must not use wildcard CORS.`);
}

const homepage = await fetch(`${BASE}/login`, { redirect: "manual" });
assert([200, 301, 302].includes(homepage.status), `/login returned ${homepage.status}.`);
assert(homepage.headers.get("x-frame-options") === "DENY", "Static pages must keep X-Frame-Options DENY.");
assert(homepage.headers.get("x-content-type-options") === "nosniff", "Static pages must keep nosniff.");

const health = await request("/.netlify/functions/production-health");
assert([200, 503].includes(health.response.status), `production-health returned ${health.response.status}.`);
assertFunctionHeaders(health.response, "production-health");
assert(!hasSecretLikeValue(health.body), "production-health leaked a secret-looking value.");

const bootstrap = await request("/.netlify/functions/admin-bootstrap");
assert([200, 503].includes(bootstrap.response.status), `admin-bootstrap returned ${bootstrap.response.status}.`);
assertFunctionHeaders(bootstrap.response, "admin-bootstrap");
assert(!hasSecretLikeValue(bootstrap.body), "admin-bootstrap leaked a secret-looking value.");

const login = await request("/.netlify/functions/auth-login", {
  method: "POST",
  body: JSON.stringify({ email: "not-a-real-user@example.invalid", password: "wrongwrong" })
});
assert(login.response.status === 401 || login.response.status === 400, `invalid auth-login returned ${login.response.status}.`);
assertFunctionHeaders(login.response, "auth-login");
assert(!hasSecretLikeValue(login.body), "auth-login leaked a secret-looking value.");

const resend = await request("/.netlify/functions/auth-resend-confirmation", {
  method: "POST",
  body: JSON.stringify({ email: "not-a-real-user@example.invalid" })
});
assert([200, 400, 429, 503].includes(resend.response.status), `auth-resend-confirmation returned ${resend.response.status}.`);
assertFunctionHeaders(resend.response, "auth-resend-confirmation");
assert(!hasSecretLikeValue(resend.body), "auth-resend-confirmation leaked a secret-looking value.");

console.log(JSON.stringify({
  ok: true,
  base: BASE,
  request_id: REQUEST_ID,
  checks: {
    static_headers: "ok",
    production_health: health.response.status,
    admin_bootstrap: bootstrap.response.status,
    invalid_login: login.response.status,
    confirmation_resend: resend.response.status,
    secret_redaction: "ok"
  }
}, null, 2));
