/** Bloom Command Center shared helpers (server-side). */

export const PLATFORM_FEATURE_FLAGS = [
  "marketplace",
  "wholesale",
  "ai",
  "voice",
  "website_builder",
  "university",
  "connect",
  "beta_features"
];

export const DEFAULT_FEATURE_FLAGS = Object.fromEntries(
  PLATFORM_FEATURE_FLAGS.map((key) => [key, true])
);

export const ANNOUNCEMENT_AUDIENCES = ["everyone", "florists", "wholesalers", "selected"];
export const ANNOUNCEMENT_KINDS = ["announcement", "maintenance", "holiday", "feature_release", "popup"];

export function sanitizeSubscriptionForAdmin(row = {}) {
  if (!row || typeof row !== "object") return {};
  return {
    shop_id: row.shop_id,
    plan_code: row.plan_code,
    status: row.status,
    trial_ends_at: row.trial_ends_at,
    current_period_ends_at: row.current_period_ends_at,
    cancel_at_period_end: row.cancel_at_period_end,
    stripe_customer_id: row.stripe_customer_id ? String(row.stripe_customer_id) : null,
    updated_at: row.updated_at,
    created_at: row.created_at
  };
}

export function mergeFeatureFlags(stored = {}) {
  return { ...DEFAULT_FEATURE_FLAGS, ...(stored && typeof stored === "object" ? stored : {}) };
}

export function buildMonthlySeries(rows = [], { dateKey = "created_at", months = 6 } = {}) {
  const buckets = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.push({
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }),
      value: 0
    });
  }
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  for (const row of rows) {
    const raw = row[dateKey];
    if (!raw) continue;
    const dt = new Date(raw);
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
    if (index.has(key)) buckets[index.get(key)].value += 1;
  }
  return buckets;
}

export function buildRevenueSeries(orders = [], months = 6) {
  const buckets = buildMonthlySeries([], { months });
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  for (const order of orders) {
    const dt = new Date(order.created_at || order.updated_at || Date.now());
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!index.has(key)) continue;
    buckets[index.get(key)].value += Number(order.total || order.amount || 0);
  }
  return buckets.map((b) => ({ ...b, value: Math.round(b.value * 100) / 100 }));
}

export function validateAnnouncementPayload(body = {}) {
  const errors = [];
  if (!String(body.title || "").trim()) errors.push("Title is required.");
  if (!String(body.body || body.message || "").trim()) errors.push("Message body is required.");
  const audience = String(body.audience || "everyone").toLowerCase();
  if (!ANNOUNCEMENT_AUDIENCES.includes(audience)) errors.push("Invalid audience.");
  const kind = String(body.kind || "announcement").toLowerCase();
  if (!ANNOUNCEMENT_KINDS.includes(kind)) errors.push("Invalid announcement kind.");
  return { valid: errors.length === 0, errors, audience, kind };
}

export function systemHealthSnapshot(env = process.env) {
  const missing = [];
  if (!env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!env.SUPABASE_ANON_KEY && !env.SUPABASE_PUBLISHABLE_KEY) missing.push("SUPABASE_ANON_KEY");
  if (!env.SUPABASE_SERVICE_ROLE_KEY && !env.SUPABASE_SECRET_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return {
    database: missing.length ? "degraded" : "ok",
    // Self-evidently true: a running Netlify Function answered this
    // request, so the functions runtime itself is up. Real signal, just
    // a weak one — Netlify's own deploy/function logs are the actual
    // source of truth for function-level failures, not this snapshot.
    netlify_functions: "ok",
    storage: env.SUPABASE_URL ? "ok" : "unknown",
    api: missing.length ? "misconfigured" : "ok",
    // Deliberately no "queue" field — there is no job/message queue
    // anywhere in this codebase. The old value ("ok", hardcoded) claimed
    // health for a subsystem that doesn't exist, which is worse than no
    // field at all.
    environment_valid: missing.length === 0,
    missing_env: missing,
    checked_at: new Date().toISOString()
  };
}

/**
 * Turns raw `audit_events` rows (event_type = "client_error", written by
 * netlify/functions/client-errors.js from every florist's browser via
 * public/production-monitor.js) into an actionable summary for the
 * platform owner — grouped by error type and by page, so a real pattern
 * ("6 people hit an API failure on Orders in the last hour") is visible
 * before anyone files a support ticket about it, instead of only after.
 */
export function summarizeClientErrors(rows = []) {
  const items = (rows || []).map((row) => {
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    return {
      at: row.created_at,
      shop_id: row.shop_id || null,
      type: metadata.type || "client",
      message: String(metadata.message || "").slice(0, 200),
      path: metadata.path || null,
      status: metadata.status ?? null
    };
  });

  const byType = {};
  const byPath = {};
  const shopsAffected = new Set();
  for (const item of items) {
    byType[item.type] = (byType[item.type] || 0) + 1;
    if (item.path) byPath[item.path] = (byPath[item.path] || 0) + 1;
    if (item.shop_id) shopsAffected.add(item.shop_id);
  }

  const topPaths = Object.entries(byPath)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([path, count]) => ({ path, count }));

  return {
    total: items.length,
    shops_affected: shopsAffected.size,
    by_type: byType,
    top_paths: topPaths,
    most_recent_at: items[0]?.at || null,
    recent: items.slice(0, 25)
  };
}

export function auditRecordFromRow(row) {
  const details = row.details && typeof row.details === "object" ? row.details : {};
  return {
    id: row.id,
    timestamp: row.created_at,
    admin_user_id: row.admin_user_id,
    action: row.action,
    target_type: details.target_type || details.targetType || null,
    target_id: details.target_id || details.targetId || null,
    shop_id: row.shop_id,
    ip_placeholder: details.ip_placeholder || details.ip || "unknown",
    result: details.result || "success",
    details
  };
}
