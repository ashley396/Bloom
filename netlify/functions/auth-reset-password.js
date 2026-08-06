import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { publicSettings, fail } from "./_shared/supabase.js";
import { checkRateLimit } from "./_shared/production.js";
import { fetchWithTimeout } from "./_shared/upstream.js";

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();
  const limit = checkRateLimit(event, { key: "auth-reset", limit: 15, windowMs: 60_000 });
  if (!limit.allowed) return json(429, { error: "Too many requests. Please wait and try again." });

  try {
    const body = bodyOf(event);
    const password = String(body.password || "");
    const accessToken = String(body.access_token || "");
    if (!accessToken) return json(400, { error: "Reset session is missing. Open the link from your email again." });
    if (password.length < 8) return json(400, { error: "Password must be at least 8 characters." });

    const { url, anonKey } = publicSettings();
    const response = await fetchWithTimeout(`${url}/auth/v1/user`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ password })
    }, { timeoutMs: 5_000, service: "Password reset service" });
    await response.json().catch(() => ({}));
    if (!response.ok) {
      return json(400, { error: "This reset link is invalid or expired. Request a new password reset email." });
    }
    return json(200, { ok: true });
  } catch (error) {
    return fail(error);
  }
}
