import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { publicSettings, fail } from "./_shared/supabase.js";
import { checkRateLimit } from "./_shared/production.js";
import { validateEmail } from "./_shared/validation.js";
import { authRedirectPath } from "./_shared/site-url.js";
import { fetchWithTimeout } from "./_shared/upstream.js";

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();
  const limit = checkRateLimit(event, { key: "auth-forgot", limit: 10, windowMs: 60_000 });
  if (!limit.allowed) return json(429, { error: "Too many requests. Please wait and try again." });

  try {
    const body = bodyOf(event);
    const emailCheck = validateEmail(body.email, { required: true });
    if (!emailCheck.ok) return json(400, { error: emailCheck.error });

    const { url, anonKey } = publicSettings();
    const origin = event.headers?.origin || event.headers?.Origin || "";
    const redirectTo = authRedirectPath(process.env, origin, "/reset-password");

    const response = await fetchWithTimeout(`${url}/auth/v1/recover`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`
      },
      body: JSON.stringify({ email: emailCheck.value, redirect_to: redirectTo })
    }, { timeoutMs: 5_000, service: "Password recovery service" });
    await response.json().catch(() => ({}));
    return json(200, {
      ok: true,
      message: "If an account exists for this email, you will receive password reset instructions shortly."
    });
  } catch (error) {
    return fail(error);
  }
}
