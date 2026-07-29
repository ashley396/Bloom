import test from "node:test";
import assert from "node:assert/strict";
import { verifyBootstrapSecret } from "../netlify/functions/_shared/platform-bootstrap.js";

test("verifyBootstrapSecret rejects when secret env missing and open bootstrap disabled", () => {
  const r = verifyBootstrapSecret({}, {});
  assert.equal(r.ok, false);
  assert.equal(r.error.statusCode, 503);
  assert.match(r.error.message, /not configured on the server/i);
});

test("verifyBootstrapSecret allows open bootstrap when flag set and no secret env", () => {
  const r = verifyBootstrapSecret({}, { FLORISYN_ALLOW_OPEN_BOOTSTRAP: "true" });
  assert.equal(r.ok, true);
});

test("verifyBootstrapSecret requires body bootstrapSecret when env set", () => {
  const env = { PLATFORM_BOOTSTRAP_SECRET: "test-secret-key" };
  const missing = verifyBootstrapSecret({}, env);
  assert.equal(missing.ok, false);
  assert.equal(missing.error.statusCode, 403);
  assert.match(missing.error.message, /Enter the platform setup key/i);
  const wrong = verifyBootstrapSecret({ bootstrapSecret: "wrong" }, env);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.error.code, "bootstrap_secret_invalid");
  assert.match(wrong.error.message, /not correct/i);
  assert.equal(verifyBootstrapSecret({ bootstrapSecret: "test-secret-key" }, env).ok, true);
});
