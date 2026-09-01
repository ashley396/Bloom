/**
 * Batch 6 ("Preview path + CI + provider cleanup + live-readiness"), Part
 * D: the exact source commit/environment a given build actually came
 * from — never a heavy build-info subsystem, just one small, pure
 * function. Reuses the SAME env vars Netlify already sets on every build
 * (COMMIT_REF/BRANCH/CONTEXT — no new build-time plumbing needed) plus
 * FLORISYN_ENV (set per-context in netlify.toml, Part C).
 *
 * Deliberately side-effect-free (no file I/O, no process exit) so it's
 * independently unit-testable — scripts/stamp-build.mjs (the real Netlify
 * build hook) is what actually writes it to
 * public/florisyn-build-info.json; netlify/functions/marketing-preview-
 * status.js (Part B's own "status route") reads that file back at
 * request time; the acceptance harness (Part K) reads the same file
 * directly.
 */
export function buildStampInfo(env = process.env) {
  const commitSha = env.COMMIT_REF || env.GITHUB_SHA || null;
  return {
    commitSha,
    commitShaShort: commitSha ? String(commitSha).slice(0, 12) : null,
    branch: env.BRANCH || env.HEAD || null,
    buildTimestamp: new Date().toISOString(),
    // "production" is never assumed from absence — an environment that
    // never set FLORISYN_ENV at all is reported exactly as that, not
    // silently treated as safe/preview OR silently treated as
    // production; a caller that needs an actual safety verdict uses the
    // preview-environment guard (marketing-preview-environment-guard.js),
    // never this field alone.
    environment: env.FLORISYN_ENV || null,
    isPreview: env.FLORISYN_ENV === "preview" || env.FLORISYN_ENV === "staging",
    netlifyContext: env.CONTEXT || null
  };
}
