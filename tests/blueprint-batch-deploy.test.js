import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);

test("ADR 0001 links the scalability blueprint", () => {
  const adr = fs.readFileSync(new URL("docs/architecture/adr/0001-scalability-stability-blueprint.md", root), "utf8");
  const blueprint = fs.readFileSync(
    new URL("docs/architecture/FLORISYN-SCALABILITY-STABILITY-BLUEPRINT.md", root),
    "utf8"
  );
  assert.match(adr, /Accepted/);
  assert.match(adr, /FLORISYN-SCALABILITY-STABILITY-BLUEPRINT\.md/);
  assert.match(blueprint, /0001-scalability-stability-blueprint\.md/);
  assert.match(blueprint, /\[x\] Create an architecture decision record linking this blueprint/);
});

test("auth hero display assets stay under the 250KB performance budget", () => {
  for (const file of [
    "public/assets/florisyn/florisyn-auth-hero-devices.png",
    "public/assets/florisyn/florisyn-auth-hero-devices.webp",
    "public/assets/florisyn/florisyn-auth-bouquet.png",
    "public/assets/florisyn/florisyn-auth-bouquet.webp"
  ]) {
    const stat = fs.statSync(new URL(file, root));
    assert.ok(stat.size > 5_000, `${file} missing`);
    assert.ok(stat.size <= 250 * 1024, `${file} exceeds 250KB (${stat.size})`);
  }
});

test("auth clients honor Retry-After and 8s total deadline", () => {
  const client = fs.readFileSync(new URL("public/florisyn-auth-client.js", root), "utf8");
  const login = fs.readFileSync(new URL("public/login.js", root), "utf8");
  const signup = fs.readFileSync(new URL("public/signup.js", root), "utf8");
  const verify = fs.readFileSync(new URL("public/verify-email.js", root), "utf8");
  assert.match(client, /8_000|8000/);
  assert.match(client, /Retry-After/);
  assert.match(login, /FlorisynAuthClient/);
  assert.match(signup, /auth_rate_limited/);
  assert.match(verify, /auth_rate_limited/);
});

test("session refresh uses expiry scheduling, jitter, and cross-tab sync", () => {
  const app = fs.readFileSync(new URL("public/app.js", root), "utf8");
  assert.match(app, /BroadcastChannel/);
  assert.match(app, /scheduleSessionRefresh/);
  assert.match(app, /jitterMs/);
  assert.match(app, /floristDisplayName/);
  assert.doesNotMatch(app, /Good morning", Ashley|Ashley 🌸/);
});

test("order create accepts client request idempotency markers", () => {
  const orders = fs.readFileSync(new URL("netlify/functions/orders.js", root), "utf8");
  const app = fs.readFileSync(new URL("public/app.js", root), "utf8");
  assert.match(orders, /client_request_id/);
  assert.match(orders, /idempotent:\s*true/);
  assert.match(app, /client_request_id/);
});
