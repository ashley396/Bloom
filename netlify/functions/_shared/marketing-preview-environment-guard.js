/**
 * Fail-closed Marketing preview/staging environment guard (Batch 6,
 * "Preview path + CI + provider cleanup + live-readiness", Part B).
 *
 * One reusable check, callable from anywhere Marketing generation could
 * run in a non-production environment — never scattered production-host
 * checks re-implemented per call site. Every check here fails CLOSED:
 * an unreadable/missing value is never treated as "safe," and a single
 * violation is enough to refuse.
 *
 * Callers (Part B):
 *   - the Marketing Studio preview/status route
 *   - generation entry points, when running in preview mode
 *   - the acceptance-test bootstrap (Part K)
 *
 * At minimum, per Part B, this rejects when:
 *   1. FLORISYN_ENV isn't explicitly "preview" or "staging"
 *   2. the public site URL equals/resolves to a production Florisyn domain
 *   3. the Supabase hostname matches the configured production project
 *   4. a real social-publishing OAuth credential is present at all
 *   5. SOCIAL_PUBLISHING_ENABLED is true
 *   6. SCHEDULED_PUBLISHING_ENABLED is true
 *
 * Reuses the existing, real credential-naming convention
 * (marketing-social-providers.js's SUPPORTED_PLATFORMS/
 * platformOAuthEnvVarNames) rather than inventing a second list of
 * platform names — "production publishing credentials present" is
 * checked against the SAME env vars the real social-provider registry
 * already reads.
 */

import { SUPPORTED_PLATFORMS, platformOAuthEnvVarNames } from "./marketing-social-providers.js";

// Public, non-secret production identifiers — the same hosts http.js's
// own allowedOrigins() already treats as production, reused here rather
// than duplicated with a risk of drifting out of sync.
const PRODUCTION_SITE_HOSTS = Object.freeze(["www.florisyn.com", "florisyn.com"]);

function hostnameOf(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    // Not a full URL (e.g. a bare hostname was configured) — use as-is.
    return value.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

/**
 * @param {object} [env] - defaults to process.env.
 * @returns {{ ok: boolean, errors: string[] }} — ok:false whenever ANY
 *   violation is found; errors is always the FULL list of every
 *   violation found, not just the first, so a caller can report
 *   everything wrong at once rather than fixing one at a time.
 */
export function checkSafeMarketingPreviewEnvironment(env = process.env) {
  const errors = [];

  // 1. Explicit preview/staging environment — never inferred from absence.
  const florisynEnv = String(env.FLORISYN_ENV || "").trim().toLowerCase();
  if (florisynEnv !== "preview" && florisynEnv !== "staging") {
    errors.push(`FLORISYN_ENV must be explicitly "preview" or "staging" for Marketing preview generation — got ${JSON.stringify(env.FLORISYN_ENV || "")}.`);
  }

  // 2. Public site URL must never equal/resolve to a production domain.
  const siteHost = hostnameOf(env.SITE_URL || env.URL || "");
  if (siteHost && PRODUCTION_SITE_HOSTS.includes(siteHost)) {
    errors.push(`Public site URL resolves to a production Florisyn domain (${siteHost}) — refusing to run Marketing generation.`);
  }

  // 3. Supabase project must not be the production project. The real
  // production project host is never hardcoded here (it isn't a secret,
  // but it also isn't checked into this repo) — it's supplied via
  // PRODUCTION_SUPABASE_HOST, set only on the real production site's own
  // Netlify config, so a preview environment that was accidentally handed
  // production Supabase credentials can still be caught even without this
  // file knowing the value in advance.
  //
  // Fail-closed: a real Supabase project genuinely configured
  // (SUPABASE_URL set) with no PRODUCTION_SUPABASE_HOST to compare
  // against is an UNVERIFIABLE state, never a safe one — this used to
  // silently skip the comparison instead of refusing, which is exactly
  // the "unreadable state treated as safe" this whole guard exists to
  // prevent (a real, independent-review-caught defect). Only a
  // completely unconfigured Supabase project (no SUPABASE_URL at all —
  // the ordinary case for a fresh, not-yet-connected local check) has
  // nothing to verify and stays a non-issue here.
  const supabaseHost = hostnameOf(env.SUPABASE_URL || "");
  const productionSupabaseHost = String(env.PRODUCTION_SUPABASE_HOST || "").trim().toLowerCase();
  if (supabaseHost && !productionSupabaseHost) {
    errors.push(
      "A real Supabase project is configured (SUPABASE_URL is set) but PRODUCTION_SUPABASE_HOST is not — cannot verify this deploy isn't pointed at the production Supabase project. Set PRODUCTION_SUPABASE_HOST on this site to the production project's real hostname."
    );
  } else if (supabaseHost && productionSupabaseHost && supabaseHost === productionSupabaseHost) {
    errors.push(`Supabase project host (${supabaseHost}) matches the configured production project — refusing to run Marketing generation.`);
  }

  // 4. Production publishing credentials must be absent from preview —
  // reuses the real per-platform OAuth env var names social publishing
  // already defines, never a second, hand-maintained list.
  const presentPlatforms = SUPPORTED_PLATFORMS.filter((platform) => {
    const { clientIdVar, clientSecretVar } = platformOAuthEnvVarNames(platform);
    return Boolean(String(env[clientIdVar] || "").trim()) || Boolean(String(env[clientSecretVar] || "").trim());
  });
  if (presentPlatforms.length) {
    errors.push(`Real social-publishing credentials are present in a preview environment (${presentPlatforms.join(", ")}) — preview must use no publishing credentials at all, staging or otherwise.`);
  }

  // 5/6. Publishing must be explicitly disabled in preview.
  if (String(env.SOCIAL_PUBLISHING_ENABLED || "").trim().toLowerCase() === "true") {
    errors.push("SOCIAL_PUBLISHING_ENABLED is true in a preview environment — social publishing must stay disabled in preview.");
  }
  if (String(env.SCHEDULED_PUBLISHING_ENABLED || "").trim().toLowerCase() === "true") {
    errors.push("SCHEDULED_PUBLISHING_ENABLED is true in a preview environment — scheduled publishing must stay disabled in preview.");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Throws a real, actionable error (never a generic "denied") when the
 * environment fails any check above. The one call callers actually make;
 * checkSafeMarketingPreviewEnvironment() above stays available separately
 * for a caller that wants the full error list without an exception (e.g.
 * a status endpoint that wants to display every problem at once).
 */
export function assertSafeMarketingPreviewEnvironment(env = process.env) {
  const { ok, errors } = checkSafeMarketingPreviewEnvironment(env);
  if (!ok) {
    const error = new Error(`Unsafe Marketing preview environment — refusing to proceed:\n- ${errors.join("\n- ")}`);
    error.code = "unsafe_marketing_preview_environment";
    error.statusCode = 412;
    error.violations = errors;
    throw error;
  }
}

/**
 * True whenever this deploy claims to be a preview/staging environment at
 * all — checked BEFORE the full safety assertion below, so a genuine
 * production deploy (which never sets these) is never subjected to the
 * preview-only checks (a production request has no FLORISYN_ENV/
 * MARKETING_STUDIO_PREVIEW set, so this correctly reads false there and
 * the enforcement call below becomes a true no-op — it must never
 * accidentally reject real production traffic).
 */
function claimsToBePreview(env) {
  const florisynEnv = String(env.FLORISYN_ENV || "").trim().toLowerCase();
  return florisynEnv === "preview" || florisynEnv === "staging" || String(env.MARKETING_STUDIO_PREVIEW || "").trim().toLowerCase() === "true";
}

/**
 * Independent-review finding, Batch 6 Part S: the guard above existed but
 * was never actually called from any real Marketing generation entry
 * point — only from a separate advisory status route and a script that
 * never runs. This is the ONE call real entry points make (Part B: "do
 * not scatter production-host checks across random call sites").
 *
 * A genuine production deploy never claims to be preview, so this is a
 * complete no-op there — it can only ever refuse a request that is
 * ALREADY claiming (via FLORISYN_ENV/MARKETING_STUDIO_PREVIEW) to be a
 * preview/staging deploy, and only when that claim doesn't hold up under
 * the full check above (wrong domain, production Supabase, publishing
 * enabled, etc.).
 */
export function enforceSafeMarketingPreviewEnvironmentIfClaimed(env = process.env) {
  if (!claimsToBePreview(env)) return;
  assertSafeMarketingPreviewEnvironment(env);
}
