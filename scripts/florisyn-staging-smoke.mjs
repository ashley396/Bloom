#!/usr/bin/env node
/**
 * Florisyn staging smoke (HTTP). Default: florisyn-staging.
 * Override: STAGING_BASE=https://deploy-preview-13--bloom-technologies.netlify.app
 */
import assert from "node:assert/strict";

const BASE = String(process.env.STAGING_BASE || "https://florisyn-staging.netlify.app").replace(/\/$/, "");
const REQUIRE_LAUNCH = process.env.REQUIRE_LAUNCH_MARKERS !== "0";
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.error(`FAIL  ${name}: ${e.message}`);
  }
}

async function getJson(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { res, body, text };
}

await check("production-health ok without secrets", async () => {
  const { res, body, text } = await getJson("/.netlify/functions/production-health");
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.doesNotMatch(text, /service_role|sk_live|SUPABASE_SERVICE_ROLE_KEY\s*[:=]/i);
});

await check("admin-bootstrap owner state", async () => {
  const { res, body } = await getJson("/.netlify/functions/admin-bootstrap");
  assert.equal(res.status, 200);
  assert.equal(body.ownerExists, true);
  assert.equal(body.error == null || body.error === undefined, true);
});

await check("auth-login invalid credentials fail closed", async () => {
  const { res, body } = await getJson("/api/auth-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "not-a-real-user@example.invalid", password: "wrongwrong" })
  });
  assert.equal(res.status, 401);
  assert.equal(body.code, "invalid_credentials");
  assert.match(String(body.error || ""), /Invalid email or password/i);
  assert.doesNotMatch(JSON.stringify(body), /accessToken|refreshToken|access_token/i);
});

await check("auth-login edge admission request id", async () => {
  const res = await fetch(`${BASE}/api/auth-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "not-a-real-user@example.invalid", password: "wrongwrong" })
  });
  assert.equal(res.status, 401);
  const requestId = res.headers.get("x-request-id");
  assert.ok(requestId && requestId.length >= 8, "expected x-request-id from auth-admission edge function");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

await check("auth-resend generic success", async () => {
  const { res, body } = await getJson("/.netlify/functions/auth-resend-confirmation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "not-a-real-user@example.invalid" })
  });
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.match(String(body.message || ""), /confirmation|Forgot Password/i);
});

await check("auth pages serve", async () => {
  for (const path of ["/login", "/signup", "/forgot-password", "/verify-email", "/reset-password"]) {
    const res = await fetch(`${BASE}${path}`);
    assert.equal(res.status, 200, path);
  }
});

await check("login.js launch markers", async () => {
  const res = await fetch(`${BASE}/login.js`);
  assert.equal(res.status, 200);
  const src = await res.text();
  if (REQUIRE_LAUNCH) {
    assert.match(src, /shop_membership_required/);
    assert.match(src, /invalid_credentials/);
    assert.match(src, /forgot-password/);
  } else {
    assert.match(src, /auth-login|bloom_session/);
  }
});

await check("website-editor launch markers", async () => {
  const res = await fetch(`${BASE}/website-editor-ui.js`);
  assert.equal(res.status, 200);
  const src = await res.text();
  if (REQUIRE_LAUNCH) {
    assert.match(src, /expected_updated_at/);
    assert.match(src, /setBusy/);
    assert.match(src, /editorOpenPreview/);
  }
});

await check("luxury shell CSS markers", async () => {
  const res = await fetch(`${BASE}/florisyn-rc2.2-founder-polish.css`);
  assert.equal(res.status, 200);
  const src = await res.text();
  if (REQUIRE_LAUNCH) {
    assert.match(src, /#18252f/);
    assert.match(src, /#c9a962/);
  }
});

await check("atelier UI CSS markers", async () => {
  const [ui, auth, shell, login] = await Promise.all([
    fetch(`${BASE}/florisyn-atelier-ui.css`),
    fetch(`${BASE}/florisyn-atelier-auth.css`),
    fetch(`${BASE}/florisyn-atelier-shell.css`),
    fetch(`${BASE}/login`),
  ]);
  assert.equal(ui.status, 200);
  assert.equal(auth.status, 200);
  assert.equal(shell.status, 200);
  assert.equal(login.status, 200);
  const uiSrc = await ui.text();
  const authSrc = await auth.text();
  const shellSrc = await shell.text();
  const loginHtml = await login.text();
  assert.match(uiSrc, /florisyn-atelier|--atelier-navy/);
  assert.match(authSrc, /florisyn-atelier-auth|--atelier-navy/);
  assert.match(shellSrc, /florisyn-atelier-shell|--atelier-ink/);
  assert.match(loginHtml, /florisyn-atelier-auth\.css/);
  assert.match(loginHtml, /Where Your Passion Flowers/);
});

const failed = results.filter((r) => !r.ok);
console.log(
  JSON.stringify(
    {
      base: BASE,
      require_launch_markers: REQUIRE_LAUNCH,
      pass: results.filter((r) => r.ok).length,
      fail: failed.length,
      failed: failed.map((f) => ({ name: f.name, error: f.error }))
    },
    null,
    2
  )
);
process.exit(failed.length ? 1 : 0);
