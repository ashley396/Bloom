import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { publicSettings, fail } from "./_shared/supabase.js";
import { checkRateLimit } from "./_shared/production.js";

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
    const response = await fetch(`${url}/auth/v1/user`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return json(response.status, { error: data.msg || data.message || "Could not update password." });
    }
    return json(200, { ok: true });
  } catch (error) {
    return fail(error);
  }
}
