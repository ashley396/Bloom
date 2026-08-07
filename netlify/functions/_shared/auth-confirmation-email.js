/** Signup confirmation email via generate_link + transactional mailer (Resend/SendGrid/etc). */

import { authRedirectPath } from "./site-url.js";
import { resolveSupabaseServerKey } from "./supabase.js";
import { fetchWithTimeout } from "./upstream.js";
import { emailProviderConfigured, dispatchEmail } from "./notification-email.js";

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

export function renderAlreadyConfirmedEmail({ loginUrl, fullName }) {
  const greeting = fullName ? `Hi ${fullName},` : "Hi there,";
  const subject = "Your Florisyn email is already confirmed";
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f7eef3;padding:28px;font-family:Georgia,'Times New Roman',serif">
<div style="max-width:560px;margin:0 auto;background:#fffafb;border:1px solid #ecd7df;border-radius:18px;padding:32px 28px;color:#1a2b48">
  <p style="margin:0 0 6px;letter-spacing:.14em;font-size:11px;color:#c45d7a;font-family:system-ui,sans-serif;font-weight:700">FLORISYN</p>
  <h1 style="margin:0 0 14px;font-size:28px;line-height:1.2">You're already confirmed</h1>
  <p style="margin:0 0 12px;font-size:16px;line-height:1.5">${greeting}</p>
  <p style="margin:0 0 22px;font-size:16px;line-height:1.5;color:#6d7385">This Florisyn account is already verified. You can sign in now.</p>
  <p style="text-align:center;margin:28px 0">
    <a href="${loginUrl}" style="display:inline-block;background:#1a2b48;color:#fff;text-decoration:none;font-family:system-ui,sans-serif;font-weight:700;font-size:15px;padding:14px 28px;border-radius:999px">Sign in</a>
  </p>
</div>
</body></html>`;
  const text = `${greeting}\n\nYour Florisyn email is already confirmed. Sign in: ${loginUrl}\n`;
  return { subject, html, text };
}

export function renderPasswordResetEmail({ resetUrl, fullName }) {
  const greeting = fullName ? `Hi ${fullName},` : "Hi there,";
  const subject = "Reset your Florisyn password";
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f7eef3;padding:28px;font-family:Georgia,'Times New Roman',serif">
<div style="max-width:560px;margin:0 auto;background:#fffafb;border:1px solid #ecd7df;border-radius:18px;padding:32px 28px;color:#1a2b48">
  <p style="margin:0 0 6px;letter-spacing:.14em;font-size:11px;color:#c45d7a;font-family:system-ui,sans-serif;font-weight:700">FLORISYN</p>
  <h1 style="margin:0 0 14px;font-size:28px;line-height:1.2">Reset your password</h1>
  <p style="margin:0 0 12px;font-size:16px;line-height:1.5">${greeting}</p>
  <p style="margin:0 0 22px;font-size:16px;line-height:1.5;color:#6d7385">We received a request to reset your Florisyn password. This link opens the Florisyn reset page — not a local development URL.</p>
  <p style="text-align:center;margin:28px 0">
    <a href="${resetUrl}" style="display:inline-block;background:#1a2b48;color:#fff;text-decoration:none;font-family:system-ui,sans-serif;font-weight:700;font-size:15px;padding:14px 28px;border-radius:999px">Choose a new password</a>
  </p>
  <p style="margin:0;font-size:13px;line-height:1.5;color:#6d7385">If the button does not work, paste this link into your browser:<br><a href="${resetUrl}" style="color:#1a2b48;word-break:break-all">${resetUrl}</a></p>
  <p style="margin:24px 0 0;font-size:12px;color:#9aa0ad">If you did not request a reset, you can ignore this message.</p>
</div>
</body></html>`;
  const text = `${greeting}\n\nReset your Florisyn password:\n${resetUrl}\n\nIf you did not request this, ignore this email.`;
  return { subject, html, text };
}

function adminHeaders(serverKey) {
  return {
    "Content-Type": "application/json",
    apikey: serverKey,
    Authorization: `Bearer ${serverKey}`
  };
}

/**
 * Look up an Auth user by email via Admin API.
 * Prefer email query when supported; fall back to a bounded page scan.
 */
export async function findAuthUserByEmail({ email, env = process.env }) {
  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const serverKey = resolveSupabaseServerKey(env)?.value;
  if (!supabaseUrl || !serverKey) {
    return { ok: false, code: "supabase_server_key_missing" };
  }

  const needle = String(email || "").trim().toLowerCase();
  if (!needle) return { ok: true, user: null };

  const headers = adminHeaders(serverKey);
  const attempts = [
    `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(needle)}`,
    `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=200`
  ];

  let lastError = null;
  for (const url of attempts) {
    const response = await fetchWithTimeout(
      url,
      { method: "GET", headers },
      { timeoutMs: 8_000, service: "Auth user lookup" }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      lastError = {
        ok: false,
        code: "user_lookup_failed",
        status: response.status,
        message: data?.msg || data?.message || null
      };
      continue;
    }
    const users = Array.isArray(data?.users) ? data.users : Array.isArray(data) ? data : [];
    const user = users.find((u) => String(u?.email || "").trim().toLowerCase() === needle) || null;
    if (user || url.includes("email=")) {
      return { ok: true, user };
    }
  }
  return lastError || { ok: true, user: null };
}

async function generateLinkOnce({ email, redirectTo, type, env }) {
  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const serverKey = resolveSupabaseServerKey(env)?.value;
  if (!supabaseUrl || !serverKey) {
    return { ok: false, code: "supabase_server_key_missing" };
  }

  const body = {
    type,
    email,
    // GoTrue accepts both shapes; include both for compatibility.
    redirect_to: redirectTo,
    options: { redirect_to: redirectTo }
  };

  const response = await fetchWithTimeout(
    `${supabaseUrl}/auth/v1/admin/generate_link`,
    {
      method: "POST",
      headers: adminHeaders(serverKey),
      body: JSON.stringify(body)
    },
    { timeoutMs: 8_000, service: "Confirmation link service" }
  );

  const data = await response.json().catch(() => ({}));
  const actionLink =
    data?.action_link ||
    data?.properties?.action_link ||
    data?.email_otp ||
    null;
  if (!response.ok || !actionLink) {
    return {
      ok: false,
      code: "generate_link_failed",
      status: response.status,
      message: data?.msg || data?.error_description || data?.message || null,
      type
    };
  }
  return { ok: true, actionLink, data, type };
}

/**
 * Build a Supabase Auth confirmation / sign-in link for an existing user.
 * Tries signup → magiclink → invite so already-created accounts still get mail.
 */
export async function generateSignupConfirmLink({ email, redirectTo, env = process.env }) {
  const types = ["signup", "magiclink", "invite"];
  let last = null;
  for (const type of types) {
    const result = await generateLinkOnce({ email, redirectTo, type, env });
    if (result.ok) return result;
    last = result;
    // Hard config failures should not retry other types.
    if (result.code === "supabase_server_key_missing") return result;
  }
  return last || { ok: false, code: "generate_link_failed" };
}

/**
 * Send confirmation email when a transactional provider is configured.
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
  const loginUrl = authRedirectPath(env, origin || "", "/login");

  // Best-effort lookup: used to send a clearer "already confirmed" message.
  // Link generation still runs if lookup is inconclusive.
  const lookup = await findAuthUserByEmail({ email, env });
  if (!lookup.ok && lookup.code === "supabase_server_key_missing") {
    return { sent: false, provider: provider.provider, reason: lookup.code, detail: lookup.message || null };
  }

  const user = lookup.ok ? lookup.user : null;
  const alreadyConfirmed = Boolean(user?.email_confirmed_at || user?.confirmed_at);

  if (alreadyConfirmed) {
    const tpl = renderAlreadyConfirmedEmail({
      loginUrl,
      fullName: fullName || user?.user_metadata?.full_name || ""
    });
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
        detail: result.detail || null
      };
    }
    return { sent: true, provider: result.provider || provider.provider, reason: null, alreadyConfirmed: true };
  }

  const link = await generateSignupConfirmLink({ email, redirectTo, env });
  if (!link.ok) {
    // If no Auth user exists yet, keep a quiet not-found reason for the handler.
    if (lookup.ok && !user) {
      return { sent: false, provider: provider.provider, reason: "user_not_found" };
    }
    return {
      sent: false,
      provider: provider.provider,
      reason: link.code,
      detail: link.message || null
    };
  }

  const tpl = renderSignupConfirmationEmail({
    confirmUrl: ensureAuthActionRedirect(link.actionLink, redirectTo),
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
    return {
      sent: false,
      provider: provider.provider,
      reason: result.code || "provider_error",
      detail: result.detail || null
    };
  }
  return {
    sent: true,
    provider: result.provider || provider.provider,
    reason: null,
    linkType: link.type || null
  };
}

/**
 * Force the verify redirect onto our public Florisyn URL (never localhost).
 */
export function ensureAuthActionRedirect(actionLink, redirectTo) {
  try {
    const url = new URL(String(actionLink || ""));
    url.searchParams.set("redirect_to", redirectTo);
    return url.toString();
  } catch {
    return actionLink;
  }
}

/**
 * Password reset via admin recovery link + Resend (not Supabase's built-in mailer).
 */
export async function sendPasswordResetEmail({ email, fullName = "", origin = "", env = process.env }) {
  const provider = emailProviderConfigured(env);
  if (!provider.configured) {
    return { sent: false, provider: null, reason: "provider_not_configured" };
  }

  const redirectTo = authRedirectPath(env, origin || "", "/reset-password");
  const link = await generateLinkOnce({ email, redirectTo, type: "recovery", env });
  if (!link.ok) {
    const lookup = await findAuthUserByEmail({ email, env });
    if (lookup.ok && !lookup.user) {
      return { sent: false, provider: provider.provider, reason: "user_not_found" };
    }
    return {
      sent: false,
      provider: provider.provider,
      reason: link.code,
      detail: link.message || null
    };
  }

  const resetUrl = ensureAuthActionRedirect(link.actionLink, redirectTo);
  const tpl = renderPasswordResetEmail({ resetUrl, fullName });
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
      detail: result.detail || null
    };
  }
  return { sent: true, provider: result.provider || provider.provider, reason: null };
}
