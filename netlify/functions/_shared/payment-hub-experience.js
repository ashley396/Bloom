/** Payment Hub Experience v1.2 — links, saved methods, recurring, recovery, reporting (pure). */

import crypto from "node:crypto";
import { nextDeliveryDate } from "./business-ecosystem.js";

export const PAYMENT_LINK_STATUSES = ["active", "viewed", "partially_paid", "paid", "expired", "canceled"];

export const TERMINAL_CATALOG = [
  { id: "stripe_terminal", label: "Stripe Terminal", provider_id: "stripe", status: "coming_soon" },
  { id: "square_terminal", label: "Square Terminal", provider_id: "square", status: "coming_soon" },
  { id: "clover_terminal", label: "Clover Terminal", provider_id: "clover", status: "coming_soon" }
];

export const RECOVERY_CHANNELS = ["email", "sms", "payment_link", "florist_notify"];

export function hashPaymentLinkToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

export function generatePaymentLinkToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export function buildSecurePaymentUrl(baseUrl, token) {
  const base = String(baseUrl || "").replace(/\/$/, "");
  return `${base}/pay.html?t=${encodeURIComponent(token)}`;
}

export function paymentLinkQrPayload(url) {
  return String(url || "");
}

export function validatePaymentLinkCreate({ orderTotal, amountRequested, allowPartial = true }) {
  const total = Math.round(Number(orderTotal || 0) * 100) / 100;
  const amt = Math.round(Number(amountRequested ?? total) * 100) / 100;
  if (total <= 0) return { valid: false, error: "Order must have a positive balance." };
  if (amt <= 0) return { valid: false, error: "Link amount must be positive." };
  if (amt > total + 0.005) return { valid: false, error: "Amount cannot exceed order balance." };
  const partial = allowPartial && amt < total - 0.005;
  return { valid: true, amount: amt, partial, balance_after: Math.round((total - amt) * 100) / 100 };
}

export function transitionPaymentLinkStatus(current, event) {
  const cur = String(current || "active");
  const map = {
    viewed: { from: ["active"], to: "viewed" },
    partial_pay: { from: ["active", "viewed", "partially_paid"], to: "partially_paid" },
    paid: { from: ["active", "viewed", "partially_paid"], to: "paid" },
    expire: { from: ["active", "viewed", "partially_paid"], to: "expired" },
    cancel: { from: ["active", "viewed", "partially_paid"], to: "canceled" }
  };
  const rule = map[event];
  if (!rule || !rule.from.includes(cur)) return { ok: false, status: cur };
  return { ok: true, status: rule.to };
}

export function sanitizeSavedMethodRow(row = {}) {
  return {
    id: row.id,
    provider_id: row.provider_id,
    brand: row.brand || null,
    last4: row.last4 || "****",
    exp_month: row.exp_month || null,
    exp_year: row.exp_year || null,
    is_default: Boolean(row.is_default),
    created_at: row.created_at
  };
}

export function validateSavedMethodToken(body = {}) {
  if (!body.provider_token_ref && !body.payment_method_id) {
    return { valid: false, error: "Provider token reference required — never send card numbers." };
  }
  if (body.pan || body.card_number || body.cvv) {
    return { valid: false, error: "Card numbers must not be sent to Bloom." };
  }
  return { valid: true };
}

export function planRecoveryAttempt(attemptNumber, config = {}) {
  const max = Number(config.max_retries ?? 3);
  const n = Number(attemptNumber || 0);
  if (n >= max) return { should_retry: false, reason: "max_retries" };
  const delayHours = Number(config.retry_delay_hours ?? 24) * (n + 1);
  return {
    should_retry: true,
    attempt: n + 1,
    next_retry_at: new Date(Date.now() + delayHours * 3600000).toISOString(),
    send_email: config.email_reminders !== false,
    send_sms: Boolean(config.sms_reminders),
    send_payment_link: true,
    notify_florist: true
  };
}

export function buildRecurringBillingPlan(subscription = {}) {
  const schedule = subscription.schedule || "monthly";
  const next = subscription.next_delivery_date || nextDeliveryDate(schedule, new Date(), subscription.custom_interval_days);
  return {
    subscription_id: subscription.id,
    schedule,
    next_delivery_date: next,
    amount: Number(subscription.amount || 0),
    steps: [
      { step: "generate_order", status: "pending" },
      { step: "process_payment", status: "pending", via: "payment_hub" },
      { step: "reserve_inventory", status: "pending" },
      { step: "notify_florist", status: "pending" },
      { step: "schedule_delivery", status: "pending" }
    ]
  };
}

export function buildExperienceReports({ payments = [], links = [], refunds = [], subscriptions = [] } = {}) {
  const paid = payments.filter((p) => Number(p.amount || 0) > 0 && String(p.metadata?.status || p.status || "") !== "failed");
  const failed = payments.filter((p) => String(p.metadata?.status || p.status || "") === "failed" || Number(p.amount || 0) === 0);
  const successRate = paid.length + failed.length > 0 ? paid.length / (paid.length + failed.length) : 1;
  const byProcessor = {};
  for (const p of paid) {
    const proc = String(p.processor || p.metadata?.processor || "manual").toLowerCase();
    byProcessor[proc] = byProcessor[proc] || { volume: 0, count: 0 };
    byProcessor[proc].volume += Number(p.amount || 0);
    byProcessor[proc].count += 1;
  }
  const recurringRevenue = subscriptions
    .filter((s) => s.status === "active")
    .reduce((sum, s) => sum + Number(s.amount || 0), 0);
  const outstanding = links
    .filter((l) => ["active", "viewed", "partially_paid"].includes(l.status))
    .reduce((sum, l) => sum + Math.max(0, Number(l.amount_due || 0) - Number(l.amount_paid || 0)), 0);
  return {
    payment_success_rate: Math.round(successRate * 1000) / 10,
    failed_payments_count: failed.length,
    refund_volume: refunds.reduce((s, r) => s + Number(r.amount || 0), 0),
    refund_count: refunds.length,
    outstanding_balances: Math.round(outstanding * 100) / 100,
    recurring_revenue: Math.round(recurringRevenue * 100) / 100,
    processor_comparison: byProcessor,
    payment_links: {
      active: links.filter((l) => l.status === "active" || l.status === "viewed").length,
      paid: links.filter((l) => l.status === "paid").length,
      expired: links.filter((l) => l.status === "expired").length,
      canceled: links.filter((l) => l.status === "canceled").length
    }
  };
}

export function buildRefundAuditEntry(refund = {}, actor = {}) {
  return {
    event: "refund",
    refund_id: refund.id,
    amount: refund.amount,
    partial: refund.partial,
    reason: refund.reason,
    notes: refund.notes || refund.metadata?.notes || null,
    actor_user_id: actor.userId || refund.actor_user_id,
    provider_id: refund.provider_id,
    status: refund.status
  };
}

export function experienceSecurityChecklist() {
  return {
    provider_tokens: "Encrypted at rest (AES-256-GCM); PAN never stored.",
    permissions: "Refunds and provider connect restricted to owner/manager/accountant roles.",
    audit_logging: "Connect, refunds, payment links, and recovery use shop audit events.",
    tenant_isolation: "All payment tables scoped by shop_id with RLS is_shop_member.",
    webhook_validation: "Verify provider signatures before applying webhook side effects (Stripe-Signature)."
  };
}

export function validateWebhookPayload({ providerId, signatureHeader, secretConfigured }) {
  if (!secretConfigured) return { valid: false, error: "Webhook secret not configured." };
  if (!signatureHeader && providerId === "stripe") return { valid: false, error: "Missing Stripe-Signature header." };
  return { valid: true, note: "Verify signature in handler before mutating state." };
}
