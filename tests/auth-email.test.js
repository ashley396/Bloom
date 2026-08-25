import test from "node:test";
import assert from "node:assert/strict";
import { redactAuthMeta, logAuthEvent, mapAuthProviderFailure, jsonAuthError } from "../netlify/functions/_shared/auth-email.js";

// auth-email.js had only 56.6% coverage despite being the module whose
// own header comment promises "never log passwords, tokens, reset links,
// or service keys" — that promise deserves a real test, not just trust.

test("redactAuthMeta: strips every field whose key looks sensitive (password/token/secret/authorization/link/etc), case-insensitively", () => {
  const redacted = redactAuthMeta({
    password: "hunter2",
    reset_token: "abc123",
    api_key: "sk_live_xxx",
    Authorization: "Bearer xxx",
    redirect_to: "https://x",
    reset_link: "https://reset/xyz",
    cookie: "session=abc",
    email: "florist@example.com",
  });
  for (const gone of ["password", "reset_token", "api_key", "Authorization", "redirect_to", "reset_link", "cookie"]) {
    assert.ok(!(gone in redacted), `${gone} must be stripped`);
  }
  assert.equal(redacted.email, "florist@example.com", "a genuinely non-sensitive field must survive redaction");
});

test("redactAuthMeta: truncates an overly long string value instead of logging it in full", () => {
  const redacted = redactAuthMeta({ note: "x".repeat(300) });
  assert.equal(redacted.note.length, 181); // 180 chars + the ellipsis marker
  assert.match(redacted.note, /…$/);
});

test("redactAuthMeta: numbers, booleans, and null pass through unchanged", () => {
  const redacted = redactAuthMeta({ attempt: 3, success: false, missing: null });
  assert.deepEqual(redacted, { attempt: 3, success: false, missing: null });
});

test("redactAuthMeta: a non-string/number/boolean value (e.g. an object) is stringified and capped, never logged as a live reference", () => {
  const redacted = redactAuthMeta({ context: { nested: "x".repeat(200) } });
  assert.equal(typeof redacted.context, "string");
  assert.ok(redacted.context.length <= 120);
});

test("redactAuthMeta: no meta at all redacts to an empty object, not a crash", () => {
  assert.deepEqual(redactAuthMeta(), {});
});

test("logAuthEvent: routes through structuredLog with redaction applied and a real request id attached when present", (t) => {
  const logs = [];
  t.mock.method(console, "log", (line) => logs.push(line));
  logAuthEvent("info", "signup_attempted", { email: "a@example.com", password: "shhh" }, {
    headers: { "x-florisyn-request-id": "req-abc12345" },
  });
  const entry = JSON.parse(logs[0]);
  assert.equal(entry.message, "signup_attempted");
  assert.equal(entry.email, "a@example.com");
  assert.ok(!("password" in entry), "password must never reach the log line");
  assert.equal(entry.request_id, "req-abc12345");
});

test("mapAuthProviderFailure: a 429 (or rate-limit message) maps to a real 429 with a friendly wait message", () => {
  const mapped = mapAuthProviderFailure({ status: 429 }, {});
  assert.equal(mapped.statusCode, 429);
  assert.equal(mapped.code, "auth_rate_limited");
});

test("mapAuthProviderFailure: a 5xx or SMTP/provider outage message maps to a real 503, not a confusing generic error", () => {
  const mapped = mapAuthProviderFailure({ status: 502 }, { message: "SMTP connection timeout" });
  assert.equal(mapped.statusCode, 503);
  assert.equal(mapped.code, "auth_email_provider_unavailable");
});

test("mapAuthProviderFailure: an unconfirmed-email message maps to a real 401 telling the user to check their inbox", () => {
  const mapped = mapAuthProviderFailure({ status: 400 }, { msg: "Email not confirmed" });
  assert.equal(mapped.statusCode, 401);
  assert.equal(mapped.code, "email_not_confirmed");
});

test("mapAuthProviderFailure: an already-registered account message maps to a clear next step, not a generic failure", () => {
  const mapped = mapAuthProviderFailure({ status: 400 }, { error_description: "User already registered" });
  assert.equal(mapped.code, "account_already_registered");
});

test("mapAuthProviderFailure: an invalid-email-domain message is mapped before falling through to a generic failure", () => {
  const mapped = mapAuthProviderFailure({ status: 400 }, { message: "Unable to validate email address: invalid format" });
  assert.equal(mapped.code, "invalid_email_domain");
});

test("mapAuthProviderFailure: the reset flow always maps an expired/invalid token to reset_link_expired, even for an otherwise-unmatched message", () => {
  const mapped = mapAuthProviderFailure({ status: 400 }, { message: "something odd" }, { flow: "reset" });
  assert.equal(mapped.code, "reset_link_expired");
});

test("mapAuthProviderFailure: an unmatched signup failure still returns a clear, actionable signup_failed code", () => {
  const mapped = mapAuthProviderFailure({ status: 400 }, { message: "totally unrecognized issue" }, { flow: "signup" });
  assert.equal(mapped.code, "signup_failed");
  assert.equal(mapped.statusCode, 400);
});

test("mapAuthProviderFailure: the resend flow reports ok:true for a real client-side failure — never leaks whether the email exists", () => {
  const clientSide = mapAuthProviderFailure({ status: 400 }, {}, { flow: "resend" });
  assert.equal(clientSide.ok, true);
  assert.equal(clientSide.statusCode, 200);
});

test("mapAuthProviderFailure: a genuine 5xx provider outage is caught before any flow-specific handling, even for resend", () => {
  const outage = mapAuthProviderFailure({ status: 500 }, {}, { flow: "resend" });
  assert.equal(outage.statusCode, 503);
  assert.equal(outage.code, "auth_email_provider_unavailable");
});

test("mapAuthProviderFailure: the recover (forgot-password) flow always reports generic success to the caller — never confirms whether the account exists", () => {
  const mapped = mapAuthProviderFailure({ status: 400 }, { message: "user not found" }, { flow: "recover" });
  assert.deepEqual(mapped, { statusCode: 200, code: "recover_accepted", error: null, ok: true });
});

test("mapAuthProviderFailure: the recover flow only breaks its generic-success rule for a real provider outage", () => {
  const mapped = mapAuthProviderFailure({ status: 503 }, {}, { flow: "recover" });
  assert.equal(mapped.statusCode, 503);
  assert.equal(mapped.code, "auth_email_provider_unavailable");
});

test("mapAuthProviderFailure: a completely unmatched failure with no flow falls back to a generic, still-real HTTP status", () => {
  const mapped = mapAuthProviderFailure({ status: 418 }, { message: "unexpected" });
  assert.equal(mapped.statusCode, 418);
  assert.equal(mapped.code, "auth_request_failed");
});

test("mapAuthProviderFailure: a missing/zero response status still resolves to a sane default (400), never NaN or undefined", () => {
  const mapped = mapAuthProviderFailure(undefined, {});
  assert.equal(mapped.statusCode, 400);
});

test("jsonAuthError: builds a real HTTP response shape with no-store caching and the mapped error/code", () => {
  const res = jsonAuthError({ statusCode: 429, code: "auth_rate_limited", error: "Too many requests." });
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.deepEqual(JSON.parse(res.body), { error: "Too many requests.", code: "auth_rate_limited" });
});

test("jsonAuthError: includes ok:true in the body only when the mapped result actually set it", () => {
  const withOk = jsonAuthError({ statusCode: 200, code: "recover_accepted", error: null, ok: true });
  assert.equal(JSON.parse(withOk.body).ok, true);

  const withoutOk = jsonAuthError({ statusCode: 400, code: "auth_request_failed", error: "x" });
  assert.equal("ok" in JSON.parse(withoutOk.body), false);
});
