/** Bloom notification email adapter — no hard-coded credentials. */

import { validateEmail } from "./validation.js";

export function emailProviderConfigured(env = process.env) {
  if (env.BLOOM_EMAIL_PROVIDER === "sendgrid" && env.SENDGRID_API_KEY) return { configured: true, provider: "sendgrid" };
  if (env.BLOOM_EMAIL_PROVIDER === "postmark" && env.POSTMARK_SERVER_TOKEN) return { configured: true, provider: "postmark" };
  if (env.BLOOM_EMAIL_WEBHOOK_URL) return { configured: true, provider: "webhook" };
  return { configured: false, provider: null };
}

function brandShell({ title, bodyHtml, shopName }) {
  const name = shopName || "Bloom Florist";
  return `<!DOCTYPE html><html><body style="font-family:Georgia,serif;background:#f8edf1;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e8d4df">
<p style="letter-spacing:.12em;font-size:11px;color:#7a4a66;margin:0 0 8px">BLOOM PAYMENTS</p>
<h1 style="color:#4d2540;font-size:22px;margin:0 0 16px">${title}</h1>
${bodyHtml}
<p style="color:#666;font-size:13px;margin-top:24px">— ${name}</p>
</div></body></html>`;
}

export function renderPaymentLinkEmail({ shopName, customerName, orderNumber, amountDue, payUrl, expiresAt, shopPhone, shopEmail }) {
  const title = "Complete your payment";
  const bodyHtml = `<p>Hi ${customerName || "there"},</p>
<p>Your balance of <strong>$${Number(amountDue).toFixed(2)}</strong>${orderNumber ? ` for order <strong>${orderNumber}</strong>` : ""} is ready to pay securely online.</p>
<p style="text-align:center;margin:28px 0"><a href="${payUrl}" style="background:#4d2540;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold">Pay now</a></p>
<p style="font-size:13px;color:#555">This link expires ${expiresAt ? new Date(expiresAt).toLocaleDateString() : "soon"}. Questions? ${shopPhone ? `Call ${shopPhone}` : ""}${shopEmail ? ` · ${shopEmail}` : ""}</p>`;
  return { subject: `${shopName || "Your florist"} — secure payment link`, html: brandShell({ title, bodyHtml, shopName }), text: `Pay ${amountDue} at ${payUrl}` };
}

export function renderPaymentReceiptEmail({ shopName, customerName, amount, orderNumber }) {
  const title = "Payment received";
  const bodyHtml = `<p>Hi ${customerName || "there"},</p><p>We received your payment of <strong>$${Number(amount).toFixed(2)}</strong>${orderNumber ? ` for order ${orderNumber}` : ""}. Thank you!</p>`;
  return { subject: `${shopName || "Your florist"} — receipt`, html: brandShell({ title, bodyHtml, shopName }) };
}

export function renderPaymentFailedEmail({ shopName, customerName, amountDue, payUrl }) {
  const title = "Payment could not be processed";
  const bodyHtml = `<p>Hi ${customerName || "there"},</p><p>We couldn't process your payment. You can try again securely:</p>
<p style="text-align:center"><a href="${payUrl}">Retry payment</a></p>`;
  return { subject: `${shopName || "Your florist"} — payment failed`, html: brandShell({ title, bodyHtml, shopName }) };
}

export function renderPaymentReminderEmail({ shopName, customerName, amountDue, payUrl }) {
  const title = "Friendly payment reminder";
  const bodyHtml = `<p>Hi ${customerName || "there"},</p><p>Balance due: <strong>$${Number(amountDue).toFixed(2)}</strong></p>
<p><a href="${payUrl}">Pay securely</a></p>`;
  return { subject: `${shopName || "Your florist"} — payment reminder`, html: brandShell({ title, bodyHtml, shopName }) };
}

export function renderSubscriptionReceiptEmail({ shopName, customerName, amount, schedule }) {
  const title = "Subscription payment received";
  const bodyHtml = `<p>Hi ${customerName || "there"},</p><p>Your ${schedule || "recurring"} flower subscription payment of <strong>$${Number(amount).toFixed(2)}</strong> was received.</p>`;
  return { subject: `${shopName || "Your florist"} — subscription receipt`, html: brandShell({ title, bodyHtml, shopName }) };
}

async function dispatchEmail(env, { to, subject, html, text }) {
  const cfg = emailProviderConfigured(env);
  if (!cfg.configured) return { ok: false, code: "provider_not_configured", provider: null };

  const toCheck = validateEmail(to, { required: true });
  if (!toCheck.ok) return { ok: false, code: "invalid_recipient", error: toCheck.error };

  if (cfg.provider === "sendgrid") {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: toCheck.value }] }],
        from: { email: env.BLOOM_EMAIL_FROM || "payments@bloom.app", name: env.BLOOM_EMAIL_FROM_NAME || "Bloom" },
        subject,
        content: [
          { type: "text/plain", value: text || subject },
          { type: "text/html", value: html }
        ]
      })
    });
    if (!res.ok) return { ok: false, code: "provider_error", status: res.status };
    return { ok: true, provider: "sendgrid" };
  }

  if (cfg.provider === "postmark") {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": env.POSTMARK_SERVER_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        From: env.BLOOM_EMAIL_FROM || "payments@bloom.app",
        To: toCheck.value,
        Subject: subject,
        HtmlBody: html,
        TextBody: text || subject
      })
    });
    if (!res.ok) return { ok: false, code: "provider_error", status: res.status };
    return { ok: true, provider: "postmark" };
  }

  if (cfg.provider === "webhook") {
    const res = await fetch(env.BLOOM_EMAIL_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: toCheck.value, subject, html, text })
    });
    if (!res.ok) return { ok: false, code: "provider_error", status: res.status };
    return { ok: true, provider: "webhook" };
  }

  return { ok: false, code: "provider_not_configured" };
}

export async function sendPaymentLinkEmail(payload, env = process.env) {
  const tpl = renderPaymentLinkEmail(payload);
  return dispatchEmail(env, { to: payload.to, subject: tpl.subject, html: tpl.html, text: tpl.text });
}

export async function sendPaymentReceiptEmail(payload, env = process.env) {
  const tpl = renderPaymentReceiptEmail(payload);
  return dispatchEmail(env, { to: payload.to, subject: tpl.subject, html: tpl.html });
}

export async function sendPaymentFailedEmail(payload, env = process.env) {
  const tpl = renderPaymentFailedEmail(payload);
  return dispatchEmail(env, { to: payload.to, subject: tpl.subject, html: tpl.html });
}

export async function sendPaymentReminderEmail(payload, env = process.env) {
  const tpl = renderPaymentReminderEmail(payload);
  return dispatchEmail(env, { to: payload.to, subject: tpl.subject, html: tpl.html });
}

export async function sendSubscriptionReceiptEmail(payload, env = process.env) {
  const tpl = renderSubscriptionReceiptEmail(payload);
  return dispatchEmail(env, { to: payload.to, subject: tpl.subject, html: tpl.html });
}
