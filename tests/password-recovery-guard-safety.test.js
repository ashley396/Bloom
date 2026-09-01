import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { redactAuthMeta, logAuthEvent } from "../netlify/functions/_shared/auth-email.js";

const root = process.cwd();
const guardSource = fs.readFileSync(path.join(root, "public/recovery-redirect-guard.js"), "utf8");
const resetPasswordJs = fs.readFileSync(path.join(root, "public/reset-password.js"), "utf8");
const resetFnSource = fs.readFileSync(path.join(root, "netlify/functions/auth-reset-password.js"), "utf8");
const forgotFnSource = fs.readFileSync(path.join(root, "netlify/functions/auth-forgot-password.js"), "utf8");

test("recovery-redirect-guard.js never sends the recovery hash anywhere except a same-origin location.replace", () => {
  // The whole point is a pure client-side hand-off — nothing is allowed to
  // transmit, log, or persist the access_token it forwards.
  assert.doesNotMatch(guardSource, /fetch\s*\(/);
  assert.doesNotMatch(guardSource, /XMLHttpRequest/);
  assert.doesNotMatch(guardSource, /sendBeacon/);
  assert.doesNotMatch(guardSource, /console\.(log|info|warn|error|debug)/);
  assert.doesNotMatch(guardSource, /localStorage|sessionStorage|document\.cookie/);
  assert.match(guardSource, /location\.replace\("\/reset-password"\s*\+\s*location\.hash\)/);
});

test("recovery-redirect-guard.js only acts on the unambiguous recovery-success shape, never on an error redirect", () => {
  // An expired/invalid-link error redirect must be left alone here (it's
  // handled locally by reset-password.js instead) rather than guessed at,
  // since an error hash alone can't be reliably told apart from an
  // unrelated email-confirmation failure that belongs on /verify-email.
  assert.match(guardSource, /type"\)\s*===\s*"recovery"/);
  assert.match(guardSource, /access_token"\)/);
  assert.doesNotMatch(guardSource, /error_code|error_description/);
});

test("reset-password.js never logs the access token or new password to the console", () => {
  assert.doesNotMatch(resetPasswordJs, /console\.(log|info|warn|error|debug)/);
});

test("redactAuthMeta strips password/token/link fields before anything is logged", () => {
  const redacted = redactAuthMeta({
    password: "super-secret",
    access_token: "real-recovery-token",
    accessToken: "real-recovery-token",
    refresh_token: "r",
    redirect_to: "https://florisyn-marketing-staging.netlify.app/reset-password",
    request_id: "req-123",
    provider_status: 400,
    code: "reset_link_expired"
  });
  assert.equal(redacted.password, undefined);
  assert.equal(redacted.access_token, undefined);
  assert.equal(redacted.accessToken, undefined);
  assert.equal(redacted.refresh_token, undefined);
  assert.equal(redacted.redirect_to, undefined);
  // Non-sensitive diagnostic fields survive untouched.
  assert.equal(redacted.request_id, "req-123");
  assert.equal(redacted.provider_status, 400);
  assert.equal(redacted.code, "reset_link_expired");
});

test("auth-reset-password.js and auth-forgot-password.js only ever log pre-redacted, non-sensitive fields", () => {
  // Belt-and-suspenders on top of redactAuthMeta itself: the call sites
  // should never even attempt to pass password/token/link fields in, so a
  // future refactor of redactAuthMeta can't silently reopen a leak.
  for (const source of [resetFnSource, forgotFnSource]) {
    const calls = source.match(/logAuthEvent\([^;]*?\}\s*,\s*event\)/gs) || [];
    assert.ok(calls.length > 0, "expected at least one logAuthEvent call site");
    for (const call of calls) {
      assert.doesNotMatch(call, /\bpassword\b/i);
      assert.doesNotMatch(call, /access_?token/i);
      assert.doesNotMatch(call, /refresh_?token/i);
      assert.doesNotMatch(call, /redirect_to/i);
    }
  }
});

test("logAuthEvent end-to-end: a call carrying real tokens never reaches structuredLog with them intact", () => {
  // structuredLog routes "warn" through console.warn (stderr) and other
  // levels through console.log (stdout) — capture both so this actually
  // proves nothing leaks regardless of which level a real call site uses.
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;
  let captured = "";
  process.stdout.write = (chunk) => {
    captured += String(chunk);
    return true;
  };
  process.stderr.write = (chunk) => {
    captured += String(chunk);
    return true;
  };
  try {
    logAuthEvent("warn", "auth_reset_failed", {
      password: "super-secret",
      access_token: "real-recovery-token",
      code: "reset_link_expired"
    });
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
  assert.doesNotMatch(captured, /super-secret/);
  assert.doesNotMatch(captured, /real-recovery-token/);
});
