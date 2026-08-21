/** Signup confirmation email via generate_link + transactional mailer (Resend/SendGrid/etc). */

import { createClient } from "@supabase/supabase-js";
import { authRedirectPath } from "./site-url.js";
import { resolveSupabaseServerKey } from "./supabase.js";
import { fetchWithTimeout } from "./upstream.js";
import { emailProviderConfigured, dispatchEmail } from "./notification-email.js";

function adminClient(env) {
  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const serverKey = resolveSupabaseServerKey(env)?.value;
  if (!supabaseUrl || !serverKey) return null;
  return createClient(supabaseUrl, serverKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function renderSignupConfirmationEmail({ confirmUrl, shopName, fullName }) {
  const greeting = fullName ? `Hi ${fullName},` : "Hi there,";
  const shop = shopName || "your flower shop";
  const subject = "Confirm your Florisyn account";
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f7eef3;padding:28px;font-family:Georgia,'Times New Roman',serif">
<div style="max-width:560px;margin:0 auto;background:#fffafb;border:1px solid #ecd7df;border-radius:18px;padding:32px 28px;color:#1a2b48">
  <p style="margin:0 0 6px;letter-spacing:.14em;font-size:11px;color:#c45d7a;font-family:system-ui,sans-serif;font-weight:700">FLORISYN</p>
  <h1 style="margin:0 0 14px;font-size:28px;line-height:1.2">Confirm your email</h1>
  <p style="margin:0 0 12px;font-size:16px;line-height:1.5">${greeting}</p>
  <p style="margin:0 0 22px;font-size:16px;line-height:1.5;color:#6d7385">Thanks for creating a Florisyn account for <strong style="color:#1a2b48">${shop}</strong>. Confirm your email to finish setup and open your shop.</p>
  <p style="text-align:center;margin:28px 0">
    <a href="${confirmUrl}" style="display:inline-block;background:#1a2b48;color:#fff;text-decoration:none;font-family:system-ui,sans-serif;font-weight:700;font-size:15px;padding:14px 28px;border-radius:999px">Confirm email</a>
  </p>
  <p style="margin:0;font-size:13px;line-height:1.5;color:#6d7385">If the button does not work, paste this link into your browser:<br><a href="${confirmUrl}" style="color:#1a2b48;word-break:break-all">${confirmUrl}</a></p>
  <p style="margin:24px 0 0;font-size:12px;color:#9aa0ad">If you did not create a Florisyn account, you can ignore this message.</p>
</div>
</body></html>`;
  const text = `${greeting}\n\nConfirm your Florisyn account for ${shop}:\n${confirmUrl}\n\nIf you did not create this account, ignore this email.`;
  return { subject, html, text };
}

/**
 * Build a Supabase Auth confirmation link for an existing (usually unconfirmed) user.
 */
export async function generateSignupConfirmLink({ email, redirectTo, env = process.env }) {
  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const serverKey = resolveSupabaseServerKey(env)?.value;
  if (!supabaseUrl || !serverKey) {
    return { ok: false, code: "supabase_server_key_missing" };
  }

  const response = await fetchWithTimeout(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serverKey,
      Authorization: `Bearer ${serverKey}`
    },
    body: JSON.stringify({
      type: "signup",
      email,
      options: { redirect_to: redirectTo }
    })
  }, { timeoutMs: 8_000, service: "Confirmation link service" });

  const data = await response.json().catch(() => ({}));
  const actionLink = data?.action_link || data?.properties?.action_link || null;
  if (!response.ok || !actionLink) {
    return {
      ok: false,
      code: "generate_link_failed",
      status: response.status,
      message: data?.msg || data?.error_description || data?.message || null
    };
  }
  return { ok: true, actionLink, data };
}

/**
 * Create a brand-new, not-yet-confirmed Supabase Auth user via the Admin API
 * (email_confirm: false). Admin-created users never trigger Supabase's own
 * built-in confirmation mailer — only our own branded email (below) will,
 * from a single token.
 */
export async function createUnconfirmedSignupUser({ email, password, userMetadata, env = process.env }) {
  const client = adminClient(env);
  if (!client) return { ok: false, code: "supabase_server_key_missing" };

  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: userMetadata || {}
  });

  if (error || !data?.user) {
    const raw = String(error?.message || "").toLowerCase();
    const alreadyRegistered =
      error?.code === "email_exists" || /already.*(registered|exists)|user already/.test(raw);
    return {
      ok: false,
      code: alreadyRegistered ? "account_already_registered" : "create_user_failed",
      status: error?.status || null,
      message: error?.message || null
    };
  }
  return { ok: true, user: data.user };
}

/**
 * Full new-signup path used when a branded email provider is configured.
 *
 * This exists to close a token-invalidation race in the old flow: calling
 * Supabase's public /auth/v1/signup endpoint makes GoTrue send its own
 * default "Confirm signup" email (token A) *synchronously*, before any of
 * our code runs. Immediately calling admin/generate_link afterward (the old
 * flow, still used for resends of an *existing* user below) regenerates
 * that user's stored confirmation token (token B) so it can be emailed in
 * our own branded template — which silently invalidates token A after
 * Supabase had already mailed it out. Whichever email the recipient
 * actually opened, it was a coin flip whether its token still worked.
 *
 * Creating the user via the Admin API instead (email_confirm: false) never
 * makes Supabase send anything on its own, so there is only ever one
 * token issued for the whole signup, and it always matches the one link we
 * actually email.
 *
 * Returns { ok, user, sent, provider, code, message }. `user` is populated
 * as soon as the Supabase account exists, even if a later step (link
 * generation or email dispatch) fails — callers must treat that as "the
 * account was created, but tell the user how to get a working confirmation
 * link" rather than retrying account creation.
 */
export async function signUpWithBrandedConfirmation({
  email,
  password,
  userMetadata,
  fullName,
  shopName,
  origin,
  env = process.env
}) {
  const provider = emailProviderConfigured(env);
  if (!provider.configured) return { ok: false, code: "provider_not_configured" };

  const created = await createUnconfirmedSignupUser({ email, password, userMetadata, env });
  if (!created.ok) return created;

  const redirectTo = authRedirectPath(env, origin || "", "/verify-email?confirmed=1");
  const link = await generateSignupConfirmLink({ email, redirectTo, env });
  if (!link.ok) {
    return { ok: false, code: link.code, message: link.message, user: created.user };
  }

  const tpl = renderSignupConfirmationEmail({ confirmUrl: link.actionLink, shopName, fullName });
  const result = await dispatchEmail(env, { to: email, subject: tpl.subject, html: tpl.html, text: tpl.text });
  if (!result.ok) {
    return { ok: false, code: result.code || "provider_error", user: created.user };
  }
  return { ok: true, user: created.user, sent: true, provider: result.provider || provider.provider };
}

/**
 * Send confirmation email when a transactional provider is configured.
 * Used for resending an *existing* unconfirmed user's confirmation link
 * (the user was already created earlier, so there is no "first" Supabase
 * email left to race against — generate_link is the only token issued).
 * Returns { sent, provider, reason }.
 */
export async function sendSignupConfirmationEmail({
  email,
  fullName,
  shopName,
  origin,
  env = process.env
}) {
  const provider = emailProviderConfigured(env);
  if (!provider.configured) {
    return { sent: false, provider: null, reason: "provider_not_configured" };
  }

  const redirectTo = authRedirectPath(env, origin || "", "/verify-email?confirmed=1");
  const link = await generateSignupConfirmLink({ email, redirectTo, env });
  if (!link.ok) {
    return { sent: false, provider: provider.provider, reason: link.code, detail: link.message || null };
  }

  const tpl = renderSignupConfirmationEmail({
    confirmUrl: link.actionLink,
    shopName,
    fullName
  });
  const result = await dispatchEmail(env, {
    to: email,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text
  });

  if (!result.ok) {
    return { sent: false, provider: provider.provider, reason: result.code || "provider_error" };
  }
  return { sent: true, provider: result.provider || provider.provider, reason: null };
}
