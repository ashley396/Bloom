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
    return json(200, {
      supabaseUrl: url,
      anonKey,
      mfaRequiredForAdmin: true
    });
  } catch (error) {
    return fail(error);
  }
}
