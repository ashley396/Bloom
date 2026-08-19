/**
 * Behavior tests for the admin-mfa-config handler. Previously the only
 * coverage here (in tests/admin-mfa.test.js) was a source-text grep for
 * "publicSettings" / "anonKey" / absence of "SERVICE_ROLE" — which would
 * pass even if the environment-vs-skip-flag logic below were wrong. The
 * one property that actually matters for security — the staging-only skip
 * flag can never disable MFA in production, even if someone sets it there
 * by mistake — was completely untested. These tests invoke the real
 * handler with real env vars (it makes no network call, so nothing here
 * needs mocking) and assert on the response.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { handler } from "../netlify/functions/admin-mfa-config.js";

const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "FLORISYN_ADMIN_MFA_SKIP",
  "FLORISYN_ENV",
  "SITE_URL",
  "URL",
];

function withEnv(vars, fn) {
  const prior = {};
  for (const key of ENV_KEYS) prior[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of ENV_KEYS) {
        if (prior[key] === undefined) delete process.env[key];
        else process.env[key] = prior[key];
      }
    });
}

function getEvent() {
  return { httpMethod: "GET", headers: {} };
}

test("admin-mfa-config: non-GET is rejected", () =>
  withEnv({}, async () => {
    const response = await handler({ httpMethod: "POST", headers: {} });
    assert.equal(response.statusCode, 405);
  }));

test("admin-mfa-config: missing SUPABASE_URL returns 503, not a crash", () =>
  withEnv({ SUPABASE_URL: undefined, SUPABASE_ANON_KEY: "anon" }, async () => {
    const response = await handler(getEvent());
    assert.equal(response.statusCode, 503);
  }));

test("admin-mfa-config: production requires MFA even if the staging skip flag is set", () =>
  withEnv(
    {
      SUPABASE_URL: "https://proj.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SITE_URL: "https://florisyn.com",
      FLORISYN_ADMIN_MFA_SKIP: "true",
      FLORISYN_ENV: "staging", // even a mislabeled env tag must not matter in production
    },
    async () => {
      const response = await handler(getEvent());
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.mfaRequiredForAdmin, true, "production must never allow the MFA skip flag");
      assert.equal(body.mfaSkipAllowed, false);
    },
  ));

test("admin-mfa-config: staging with the explicit skip flag allows skipping MFA", () =>
  withEnv(
    {
      SUPABASE_URL: "https://proj.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SITE_URL: "https://beta-august10-stabilization--florisyn-staging.netlify.app",
      FLORISYN_ADMIN_MFA_SKIP: "true",
      FLORISYN_ENV: "staging",
    },
    async () => {
      const response = await handler(getEvent());
      const body = JSON.parse(response.body);
      assert.equal(body.mfaSkipAllowed, true);
      assert.equal(body.mfaRequiredForAdmin, false);
    },
  ));

test("admin-mfa-config: staging without the skip flag still requires MFA", () =>
  withEnv(
    {
      SUPABASE_URL: "https://proj.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SITE_URL: "https://beta-august10-stabilization--florisyn-staging.netlify.app",
      FLORISYN_ADMIN_MFA_SKIP: undefined,
      FLORISYN_ENV: "staging",
    },
    async () => {
      const response = await handler(getEvent());
      const body = JSON.parse(response.body);
      assert.equal(body.mfaRequiredForAdmin, true);
      assert.equal(body.mfaSkipAllowed, false);
    },
  ));

test("admin-mfa-config: response never includes a service-role key, only the public anon key", () =>
  withEnv(
    { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_ANON_KEY: "anon-key", SITE_URL: "https://florisyn.com" },
    async () => {
      const response = await handler(getEvent());
      const body = JSON.parse(response.body);
      assert.equal(body.anonKey, "anon-key");
      assert.ok(!("serviceRoleKey" in body));
      assert.doesNotMatch(response.body, /service.?role/i);
    },
  ));
