/** Production configuration, logging, audit, and safe errors. */

import { systemHealthSnapshot } from "./command-center.js";

export const ENV_GROUPS = {
  core: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
  payments: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  connect: ["STRIPE_CONNECT_CLIENT_ID"],
  ai: ["CLOUDFLARE_AI_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  email: ["RESEND_API_KEY"]
};

export const BETA_READINESS_CHECKLIST = [
  { id: "auth", area: "Authentication", item: "Florist login and session refresh work" },
  { id: "orders", area: "Orders", item: "Create, edit, and fulfill orders with shop scoping" },
  { id: "inventory", area: "Inventory", item: "Add/adjust inventory with low-stock alerts" },
  { id: "customers", area: "Customers", item: "CRM search and edit with validation" },
  { id: "payments", area: "Payments", item: "Stripe checkout when keys configured" },
  { id: "marketplace", area: "Marketplace", item: "Browse, verify, and checkout gated correctly" },
  { id: "wholesale", area: "Wholesale", item: "Seller publish workflow draft → published" },
  { id: "lily", area: "Lily", item: "AI actions respect role permissions" },
  { id: "admin", area: "Admin", item: "Command Center gated to platform admins" },
  { id: "performance", area: "Performance", item: "Dashboard loads under 3s on broadband" },
  { id: "accessibility", area: "Accessibility", item: "Keyboard nav and skip link on POS/admin" },
  { id: "audit", area: "Observability", item: "Audit events for orders, inventory, admin" }
];

export function getProductionConfig(env = process.env) {
  const health = systemHealthSnapshot(env);
  const features = {
    payments: Boolean(env.STRIPE_SECRET_KEY),
    stripe_webhooks: Boolean(env.STRIPE_WEBHOOK_SECRET),
    connect: Boolean(env.STRIPE_CONNECT_CLIENT_ID),
    ai_cloud: Boolean(env.CLOUDFLARE_AI_TOKEN && env.CLOUDFLARE_ACCOUNT_ID),
    email: Boolean(env.RESEND_API_KEY)
  };
  const warnings = [];
  if (!features.payments) warnings.push("Stripe payments disabled — STRIPE_SECRET_KEY missing.");
  if (features.payments && !features.stripe_webhooks) warnings.push("Stripe webhooks not verified — STRIPE_WEBHOOK_SECRET missing.");
  if (!features.ai_cloud) warnings.push("Cloud AI optional — local AI bridge or Cloudflare token required for full AI.");
  return {
    ...health,
    features,
    warnings,
    beta_checklist: BETA_READINESS_CHECKLIST
  };
}

export function safePublicError(error) {
  const status = error?.statusCode || 500;
  const msg = String(error?.message || "");
  if (/SUPABASE_SERVICE_ROLE_KEY is not configured in Netlify/i.test(msg)) {
    return "Florisyn's secure server connection is not set up in Netlify yet. You can still use your current shop; contact support if you need multi-location setup.";
  }
  if (/Supabase server API key is not configured/i.test(msg)) {
    return "Florisyn's secure server connection is not set up in Netlify yet. You can still use your current shop; contact support if you need multi-location setup.";
  }
  if (status === 401) return "Please sign in again.";
  if (status === 403) return "You do not have permission to perform this action.";
  if (status === 400) return error?.message || "Invalid request.";
  if (status === 404) return error?.message || "We could not find that record.";
  if (status === 503) return error?.message || "Florisyn is temporarily unavailable.";
  if (/permission denied for function post_order_payment/i.test(msg)) {
    return "Cash and manual payments could not be posted. Your shop session is valid, but the payment service rejected the request.";
  }
  if (/Payment exceeds remaining balance/i.test(msg)) {
    return "That amount is more than the order balance due.";
  }
  if (/Order not found/i.test(msg)) {
    return "That order was not found in your shop. Refresh orders and try again.";
  }
  if (status < 500) return error?.message || "Request could not be completed.";
  return "Unexpected Florisyn error. Try again or contact support.";
}

export function structuredLog(level, message, meta = {}) {
  const payload = {
    level,
    message,
    ts: new Date().toISOString(),
    ...meta
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

const rateBucket = new Map();

/** Best-effort rate limit hook (per isolate). Returns { allowed, retryAfterMs }. */
export function checkRateLimit(event, { key = "global", limit = 120, windowMs = 60_000 } = {}) {
  const ip =
    event?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    event?.headers?.["client-ip"] ||
    "unknown";
  const bucketKey = `${key}:${ip}`;
  const now = Date.now();
  let row = rateBucket.get(bucketKey);
  if (!row || now - row.start > windowMs) {
    row = { start: now, count: 0 };
  }
  row.count += 1;
  rateBucket.set(bucketKey, row);
  if (rateBucket.size > 5000) {
    for (const [k, v] of rateBucket) {
      if (now - v.start > windowMs) rateBucket.delete(k);
    }
  }
  if (row.count > limit) {
    return { allowed: false, retryAfterMs: windowMs - (now - row.start) };
  }
  return { allowed: true, retryAfterMs: 0 };
}

export async function writeShopAudit(
  client,
  { shopId = null, userId = null, eventType, entityType = null, entityId = null, metadata = {} }
) {
  if (!eventType) return;
  try {
    await client.from("audit_events").insert({
      shop_id: shopId,
      actor_user_id: userId,
      event_type: eventType,
      entity_type: entityType,
      entity_id: entityId ? String(entityId) : null,
      metadata: metadata && typeof metadata === "object" ? metadata : {}
    });
  } catch (error) {
    structuredLog("warn", "audit_events insert skipped", {
      eventType,
      reason: String(error.message || error).slice(0, 200)
    });
  }
}

export function securityReviewSummary() {
  return {
    authentication: "Bearer JWT via Supabase; platformAdmin for Command Center",
    authorization: "shop_members.role + requireRoles on sensitive routes",
    tenant_isolation: "shop_id filter on all florist mutations",
    validation: "shared validation.js on auth, orders, inventory, customers",
    rate_limiting: "Netlify distributed auth admission plus per-isolate defense-in-depth limits",
    secrets: "Never returned in API responses; sanitized client error payloads",
    error_handling: "safePublicError for 5xx; structured JSON logs"
  };
}
