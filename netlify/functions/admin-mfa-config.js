/**
 * Public Supabase client settings for Admin MFA only.
 * Anon/publishable key is safe for browser use; never returns service role.
 */
import { json, preflight, methodNotAllowed } from "./_shared/http.js";
import { fail, publicSettings } from "./_shared/supabase.js";

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "GET") return methodNotAllowed();
  try {
    const { url, anonKey } = publicSettings();
    if (!url || !anonKey) {
      const e = new Error("Admin MFA configuration is unavailable.");
      e.statusCode = 503;
      e.code = "admin_mfa_config_unavailable";
      throw e;
    }
    const skipRaw = String(process.env.FLORISYN_ADMIN_MFA_SKIP || "").toLowerCase();
    const site = String(process.env.SITE_URL || process.env.URL || "").toLowerCase();
    const envTag = String(process.env.FLORISYN_ENV || "").toLowerCase();
    const isProduction =
      /florisyn\.com/i.test(site) && !/staging|deploy-preview|localhost|127\.0\.0\.1/i.test(site);
    const mfaSkipAllowed =
      skipRaw === "true" && !isProduction && (envTag === "staging" || /staging|deploy-preview|localhost|127\.0\.0\.1|netlify\.app/i.test(site));

    return json(200, {
      supabaseUrl: url,
      anonKey,
      mfaRequiredForAdmin: !mfaSkipAllowed,
      mfaSkipAllowed,
    });
  } catch (error) {
    return fail(error);
  }
}
