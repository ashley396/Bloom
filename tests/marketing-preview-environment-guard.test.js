import test from "node:test";
import assert from "node:assert/strict";
import { checkSafeMarketingPreviewEnvironment, assertSafeMarketingPreviewEnvironment } from "../netlify/functions/_shared/marketing-preview-environment-guard.js";

// Batch 6 ("Preview path + CI + provider cleanup + live-readiness"), Part
// B: the one fail-closed guard every Marketing preview call site reuses —
// never scattered production-host checks. Every violation fails closed;
// nothing here ever infers "safe" from a missing/unreadable value.

function safeEnv(overrides = {}) {
  return {
    FLORISYN_ENV: "preview",
    SITE_URL: "https://deploy-preview-42--florisyn-marketing-staging.netlify.app",
    SUPABASE_URL: "https://staging-project-ref.supabase.co",
    PRODUCTION_SUPABASE_HOST: "prod-project-ref.supabase.co",
    SOCIAL_PUBLISHING_ENABLED: "false",
    SCHEDULED_PUBLISHING_ENABLED: "false",
    ...overrides
  };
}

// Part P #5: safe preview config passes.
test("checkSafeMarketingPreviewEnvironment: a genuinely safe preview config passes with no violations", () => {
  const result = checkSafeMarketingPreviewEnvironment(safeEnv());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("checkSafeMarketingPreviewEnvironment: 'staging' is accepted as well as 'preview'", () => {
  const result = checkSafeMarketingPreviewEnvironment(safeEnv({ FLORISYN_ENV: "staging" }));
  assert.equal(result.ok, true);
});

test("checkSafeMarketingPreviewEnvironment: FLORISYN_ENV missing/unset never defaults to safe", () => {
  const result = checkSafeMarketingPreviewEnvironment(safeEnv({ FLORISYN_ENV: "" }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /FLORISYN_ENV must be explicitly/);
});

test("checkSafeMarketingPreviewEnvironment: FLORISYN_ENV='production' is rejected outright", () => {
  const result = checkSafeMarketingPreviewEnvironment(safeEnv({ FLORISYN_ENV: "production" }));
  assert.equal(result.ok, false);
});

// Part P #1: preview mode rejects production public URL.
test("checkSafeMarketingPreviewEnvironment: rejects when the public site URL resolves to www.florisyn.com", () => {
  const result = checkSafeMarketingPreviewEnvironment(safeEnv({ SITE_URL: "https://www.florisyn.com" }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /production Florisyn domain/);
});

test("checkSafeMarketingPreviewEnvironment: rejects when the public site URL resolves to the bare apex florisyn.com", () => {
  const result = checkSafeMarketingPreviewEnvironment(safeEnv({ SITE_URL: "https://florisyn.com" }));
  assert.equal(result.ok, false);
});

test("checkSafeMarketingPreviewEnvironment: a Netlify-generated deploy-preview URL is never mistaken for production", () => {
  const result = checkSafeMarketingPreviewEnvironment(safeEnv({ SITE_URL: "https://deploy-preview-7--florisyn-marketing-staging.netlify.app" }));
  assert.equal(result.ok, true);
});

// Part P #2: preview mode rejects production Supabase host.
test("checkSafeMarketingPreviewEnvironment: rejects when the Supabase host matches the configured production project", () => {
  const result = checkSafeMarketingPreviewEnvironment(safeEnv({ SUPABASE_URL: "https://prod-project-ref.supabase.co", PRODUCTION_SUPABASE_HOST: "prod-project-ref.supabase.co" }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /matches the configured production project/);
});

test("checkSafeMarketingPreviewEnvironment: a genuinely different staging Supabase project passes", () => {
  const result = checkSafeMarketingPreviewEnvironment(safeEnv({ SUPABASE_URL: "https://staging-project-ref.supabase.co", PRODUCTION_SUPABASE_HOST: "prod-project-ref.supabase.co" }));
  assert.equal(result.ok, true);
});

// Independent-review finding, Batch 6 Part S: a real SUPABASE_URL with no
// PRODUCTION_SUPABASE_HOST to compare against used to silently skip the
// comparison entirely (an unverifiable state read as "nothing to check")
// instead of failing closed — the exact "unreadable value treated as
// safe" this guard's own docstring promises never happens. Fixed to
// refuse whenever a real Supabase project is configured but there is
// nothing to verify it against.
test("checkSafeMarketingPreviewEnvironment: fails closed — a real SUPABASE_URL with PRODUCTION_SUPABASE_HOST unset is a violation, never silently skipped", () => {
  const env = safeEnv();
  delete env.PRODUCTION_SUPABASE_HOST;
  const result = checkSafeMarketingPreviewEnvironment(env);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /PRODUCTION_SUPABASE_HOST is not/);
});

// Even if the configured SUPABASE_URL genuinely IS the real production
// project — the exact scenario the missing PRODUCTION_SUPABASE_HOST used
// to let through undetected.
test("checkSafeMarketingPreviewEnvironment: fails closed even when the unverifiable SUPABASE_URL happens to genuinely be the production project", () => {
  const env = safeEnv({ SUPABASE_URL: "https://real-production-project-ref.supabase.co" });
  delete env.PRODUCTION_SUPABASE_HOST;
  const result = checkSafeMarketingPreviewEnvironment(env);
  assert.equal(result.ok, false);
});

// No Supabase project configured at all is still a legitimate non-issue
// (nothing to verify) — only a REAL SUPABASE_URL with nothing to compare
// it against fails closed.
test("checkSafeMarketingPreviewEnvironment: no SUPABASE_URL configured at all is still a non-issue, not a violation", () => {
  const env = safeEnv();
  delete env.SUPABASE_URL;
  delete env.PRODUCTION_SUPABASE_HOST;
  const result = checkSafeMarketingPreviewEnvironment(env);
  assert.equal(result.ok, true);
});

// Production publishing credentials present.
test("checkSafeMarketingPreviewEnvironment: rejects when a real social-publishing credential is present at all", () => {
  const result = checkSafeMarketingPreviewEnvironment(safeEnv({ FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID: "real-client-id" }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /publishing credentials are present/);
  assert.match(result.errors.join("\n"), /facebook/);
});

// Part P #3: preview mode rejects publishing enabled.
test("checkSafeMarketingPreviewEnvironment: rejects when SOCIAL_PUBLISHING_ENABLED is true", () => {
  const result = checkSafeMarketingPreviewEnvironment(safeEnv({ SOCIAL_PUBLISHING_ENABLED: "true" }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /SOCIAL_PUBLISHING_ENABLED/);
});

// Part P #4: preview mode rejects scheduled publishing enabled.
test("checkSafeMarketingPreviewEnvironment: rejects when SCHEDULED_PUBLISHING_ENABLED is true", () => {
  const result = checkSafeMarketingPreviewEnvironment(safeEnv({ SCHEDULED_PUBLISHING_ENABLED: "true" }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /SCHEDULED_PUBLISHING_ENABLED/);
});

test("checkSafeMarketingPreviewEnvironment: reports EVERY violation at once, not just the first", () => {
  const result = checkSafeMarketingPreviewEnvironment({
    FLORISYN_ENV: "production",
    SITE_URL: "https://www.florisyn.com",
    SOCIAL_PUBLISHING_ENABLED: "true",
    SCHEDULED_PUBLISHING_ENABLED: "true"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 4, `expected at least 4 distinct violations, got ${result.errors.length}: ${JSON.stringify(result.errors)}`);
});

test("assertSafeMarketingPreviewEnvironment: throws a real, actionable, statusCode-carrying error on any violation", () => {
  assert.throws(
    () => assertSafeMarketingPreviewEnvironment(safeEnv({ SOCIAL_PUBLISHING_ENABLED: "true" })),
    (err) => {
      assert.equal(err.code, "unsafe_marketing_preview_environment");
      assert.equal(err.statusCode, 412);
      assert.ok(Array.isArray(err.violations) && err.violations.length > 0);
      assert.match(err.message, /SOCIAL_PUBLISHING_ENABLED/);
      return true;
    }
  );
});

test("assertSafeMarketingPreviewEnvironment: never throws for a genuinely safe config", () => {
  assert.doesNotThrow(() => assertSafeMarketingPreviewEnvironment(safeEnv()));
});
