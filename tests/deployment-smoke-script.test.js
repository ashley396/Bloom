import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const smokeSource = fs.readFileSync(new URL("../scripts/verify-live-staging-smoke.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const rollbackDoc = fs.readFileSync(new URL("../docs/FLORISYN_STAGING_DEPLOY_ROLLBACK_PROOF.md", import.meta.url), "utf8");

test("live staging smoke script verifies headers, auth failure, and secret redaction", () => {
  assert.match(smokeSource, /FLORISYN_STAGING_BASE_URL/);
  assert.match(smokeSource, /production-health/);
  assert.match(smokeSource, /admin-bootstrap/);
  assert.match(smokeSource, /auth-login/);
  assert.match(smokeSource, /auth-resend-confirmation/);
  assert.match(smokeSource, /X-Frame-Options DENY/);
  assert.match(smokeSource, /no-store/);
  assert.match(smokeSource, /wildcard CORS/);
  assert.match(smokeSource, /hasSecretLikeValue/);
  assert.match(smokeSource, /sb_secret_|service_role|sk_live_|sk_test_|whsec_|Bearer/);
});

test("deployment docs and package scripts expose the live staging smoke gate", () => {
  assert.equal(packageJson.scripts["verify:live-staging-smoke"], "node scripts/verify-live-staging-smoke.mjs");
  assert.match(rollbackDoc, /npm run verify:live-staging-smoke/);
  assert.match(rollbackDoc, /secret redaction/);
});
