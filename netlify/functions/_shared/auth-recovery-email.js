/** Password recovery email via generate_link + transactional mailer (avoids Supabase Site URL localhost). */

import { authRedirectPath } from "./site-url.js";
import { resolveSupabaseServerKey } from "./supabase.js";
import { fetchWithTimeout } from "./upstream.js";
import { emailProviderConfigured, dispatchEmail } from "./notification-email.js";

export function renderPasswordRecoveryEmail({ resetUrl, email }) {
  const subject = "Reset your Florisyn password";
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f7eef3;padding:28px;font-family:Georgia,'Times New Roman',serif">
<div style="max-width:560px;margin:0 auto;background:#fffafb;border:1px solid #ecd7df;border-radius:18px;padding:32px 28px;color:#1a2b48">
  <p style="margin:0 0 6px;letter-spacing:.14em;font-size:11px;color:#c45d7a;font-family:system-ui,sans-serif;font-weight:700">FLORISYN</p>
  <h1 style="margin:0 0 14px;font-size:28px;line-height:1.2">Reset your password</h1>
  <p style="margin:0 0 12px;font-size:16px;line-height:1.5">Hi,</p>
  <p style="margin:0 0 22px;font-size:16px;line-height:1.5;color:#6d7385">We received a request to reset the Florisyn password for <strong style="color:#1a2b48">${email}</strong>. Use the button below to choose a new password.</p>
  <p style="text-align:center;margin:28px 0">
    <a href="${resetUrl}" style="display:inline-block;background:#1a2b48;color:#fff;text-decoration:none;font-family:system-ui,sans-serif;font-weight:700;font-size:15px;padding:14px 28px;border-radius:999px">Reset password</a>
  </p>
  <p style="margin:0;font-size:13px;line-height:1.5;color:#6d7385">If the button does not work, paste this link into your browser:<br><a href="${resetUrl}" style="color:#1a2b48;word-break:break-all">${resetUrl}</a></p>
  <p style="margin:24px 0 0;font-size:12px;color:#9aa0ad">If you did not request this, you can ignore this message. The link expires for your security.</p>
</div>
</body></html>`;
  const text = `Reset your Florisyn password for ${email}:\n${resetUrl}\n\nIf you did not request this, ignore this email.`;
  return { subject, html, text };
}

export async function generatePasswordRecoveryLink({ email, redirectTo, env = process.env }) {
  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const serverKey = resolveSupabaseServerKey(env)?.value;
  if (!supabaseUrl || !serverKey) {
    return { ok: false, code: "supabase_server_key_missing" };
  }

  const response = await fetchWithTimeout(
    `${supabaseUrl}/auth/v1/admin/generate_link`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serverKey,
        Authorization: `Bearer ${serverKey}`
      },
      body: JSON.stringify({
        type: "recovery",
        email,
        options: { redirect_to: redirectTo }
      })
    },
    { timeoutMs: 8_000, service: "Password recovery link service" }
  );

  const data = await response.json().catch(() => ({}));
  let actionLink = data?.action_link || data?.properties?.action_link || null;
  if (!response.ok || !actionLink) {
    return {
      ok: false,
      code: "generate_link_failed",
      status: response.status,
      message: data?.msg || data?.error_description || data?.message || null
    };
  }

  // Force production redirect even if Supabase Auth Site URL is still localhost.
  try {
    const link = new URL(actionLink);
    link.searchParams.set("redirect_to", redirectTo);
    actionLink = link.toString();
  } catch {
    /* keep provider link as-is */
  }

  return { ok: true, actionLink, data };
}

/**
 * Prefer Florisyn-branded recovery email with an explicit production redirect.
 * Falls back to caller when provider/link generation is unavailable.
 */
export async function sendPasswordRecoveryEmail({ email, origin, env = process.env }) {
  const provider = emailProviderConfigured(env);
  if (!provider.configured) {
    return { sent: false, provider: null, reason: "provider_not_configured", redirectTo: null };
  }

  const redirectTo = authRedirectPath(env, origin || "", "/reset-password");
  if (/localhost|127\.0\.0\.1/i.test(redirectTo)) {
    return { sent: false, provider: provider.provider, reason: "localhost_redirect_blocked", redirectTo };
  }

  const link = await generatePasswordRecoveryLink({ email, redirectTo, env });
  if (!link.ok) {
    return {
      sent: false,
      provider: provider.provider,
      reason: link.code,
      detail: link.message || null,
      redirectTo
    };
  }

  const tpl = renderPasswordRecoveryEmail({ resetUrl: link.actionLink, email });
  const result = await dispatchEmail(env, {
    to: email,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text
  });

  if (!result.ok) {
    return {
      sent: false,
      provider: provider.provider,
      reason: result.code || "provider_error",
      redirectTo
    };
  }

  return {
    sent: true,
    provider: result.provider || provider.provider,
    reason: null,
    redirectTo
  };
}
