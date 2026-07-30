import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  authRedirectPath,
  resolvePublicSiteUrl,
  sanitizeAuthPathname,
  getSiteUrlDiagnostics,
  isNetlifyPreviewUrl,
} from "../netlify/functions/_shared/site-url.js";
import { getAiProviderStatus, AI_STATUS } from "../netlify/functions/_shared/ai-status.js";
import { getFeatureFlags, isFeatureEnabled } from "../netlify/functions/_shared/feature-flags.js";
import { assertStripeLivemodeMatchesKey, stripeKeyMode } from "../netlify/functions/_shared/stripe-mode.js";
import {
  validateDeliveryProofUpload,
  DELIVERY_PROOF_MAX_BYTES,
} from "../netlify/functions/_shared/upload-validation.js";
import { requireRowShopId } from "../netlify/functions/_shared/shop-scope.js";
import { handler as aiStatusHandler } from "../netlify/functions/ai-status.js";
import { handler as productionHealthHandler } from "../netlify/functions/production-health.js";

const SECRET_PATTERNS = [
  /sk_live_[a-zA-Z0-9]+/,
  /sk_test_[a-zA-Z0-9]+/,
  /SUPABASE_SERVICE_ROLE_KEY/,
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/,
];

function assertNoSecrets(payload) {
  const text = JSON.stringify(payload);
  for (const re of SECRET_PATTERNS) {
    assert.doesNotMatch(text, re, `Response must not contain secret matching ${re}`);
  }
}

// ---------------------------------------------------------------------------
// Auth redirect handling
// ---------------------------------------------------------------------------

test("auth redirect uses production SITE_URL", () => {
  const url = authRedirectPath(
    { SITE_URL: "https://app.florisyn.com" },
    "http://localhost:8888",
    "/verify-email?confirmed=1",
  );
  assert.equal(url, "https://app.florisyn.com/verify-email?confirmed=1");
  assert.doesNotMatch(url, /localhost/);
});

test("auth redirect allows Netlify preview DEPLOY_PRIME_URL", () => {
  const preview = "https://deploy-preview-42--bloom-technologies.netlify.app";
  assert.ok(isNetlifyPreviewUrl(preview));
  const url = authRedirectPath({ DEPLOY_PRIME_URL: preview }, "", "/reset-password");
  assert.equal(url, `${preview}/reset-password`);
});

test("auth redirect localhost development falls back when SITE_URL unset", () => {
  const url = authRedirectPath({}, "http://localhost:8888", "/verify-email");
  assert.doesNotMatch(url, /localhost/);
  assert.match(url, /^https:\/\//);
});

test("missing SITE_URL produces configuration warning", () => {
  const diag = getSiteUrlDiagnostics({}, "http://localhost:8888");
  assert.ok(diag.warnings.length > 0);
  assert.equal(diag.site_url_configured, false);
});

test("malicious external redirect pathname is sanitized", () => {
  const evil = authRedirectPath(
    { SITE_URL: "https://app.florisyn.com" },
    "",
    "https://evil.example/phish",
  );
  assert.equal(evil, "https://app.florisyn.com/verify-email");
  assert.doesNotMatch(evil, /evil\.example/);
});

test("sanitizeAuthPathname rejects protocol-relative paths", () => {
  assert.equal(sanitizeAuthPathname("//evil.example"), "/verify-email");
});

// ---------------------------------------------------------------------------
// AI status honesty
// ---------------------------------------------------------------------------

test("AI status never reports online without provider credentials", () => {
  const empty = getAiProviderStatus({});
  assert.notEqual(empty.state, AI_STATUS.ONLINE);
  assert.equal(empty.lily, "offline");

  const partialToken = getAiProviderStatus({ CLOUDFLARE_AI_API_TOKEN: "only-token" });
  assert.notEqual(partialToken.state, AI_STATUS.ONLINE);
});

test("ai-status HTTP handler exposes no secrets", async () => {
  const res = await aiStatusHandler({
    httpMethod: "GET",
    headers: {},
  });
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assertNoSecrets(body);
  assert.ok("state" in body);
  assert.ok(!("OPENAI_API_KEY" in body));
});

// ---------------------------------------------------------------------------
// Feature flags — risky modules default off
// ---------------------------------------------------------------------------

test("risky feature flags default false in empty environment", () => {
  const flags = getFeatureFlags({});
  assert.equal(flags.VOICE_WAKE, false);
  assert.equal(flags.VOICE_TTS_CLOUD, false);
  assert.equal(flags.INVENTORY_AI_INTAKE, false);
  assert.equal(flags.INVENTORY_RECIPE_DEDUCTIONS, false);
});

test("feature flags cannot grant platform admin or bypass auth", () => {
  const flags = getFeatureFlags({ FLORISYN_FLAG_VOICE_WAKE: "true" });
  assert.equal(flags.VOICE_WAKE, true);
  assert.equal(isFeatureEnabled("PLATFORM_ADMIN", {}), false);
});

// ---------------------------------------------------------------------------
// Health endpoint
// ---------------------------------------------------------------------------

test("production-health exposes no secret values", async () => {
  const prev = { ...process.env };
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-test-key-not-real-jwt";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret-value";
  process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_test";
  try {
    const res = await productionHealthHandler({ httpMethod: "GET", headers: {} });
    const body = JSON.parse(res.body);
    assertNoSecrets(body);
    assert.ok("ai" in body);
    assert.ok("feature_flags" in body);
    assert.ok(!JSON.stringify(body).includes("service-role-secret-value"));
    assert.ok(!JSON.stringify(body).includes("sk_test_fake_key_for_test"));
  } finally {
    process.env = prev;
  }
});

// ---------------------------------------------------------------------------
// Tenant isolation — server-side patterns
// ---------------------------------------------------------------------------

test("orders handler scopes queries to shop_id", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/orders.js"), "utf8");
  assert.match(src, /\.eq\("shop_id", shopId\)/);
});

test("customers handler scopes queries to shop_id", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/customers.js"), "utf8");
  assert.match(src, /\.eq\("shop_id",shopId\)/);
});

test("inventory handler scopes queries to shop_id", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/inventory.js"), "utf8");
  assert.match(src, /\.eq\("shop_id",shopId\)/);
});

test("cross-tenant order access denied via requireRowShopId", () => {
  assert.throws(
    () => requireRowShopId({ shop_id: "shop-a" }, "shop-b", "Order"),
    (err) => err.statusCode === 403,
  );
});

test("cross-tenant customer row rejected by shop scope helper", () => {
  assert.throws(
    () => requireRowShopId({ shop_id: "aaa" }, "bbb", "Customer"),
    /Customer|403/,
  );
});

test("cross-tenant inventory row rejected by shop scope helper", () => {
  assert.throws(
    () => requireRowShopId({ shop_id: "inv-a" }, "inv-b", "Inventory item"),
    (err) => err.statusCode === 403,
  );
});

// ---------------------------------------------------------------------------
// Audit events RLS — policy source verification
// ---------------------------------------------------------------------------

test("audit_events migration restricts access to shop members", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260730_foundation_daily_loop_v1.sql"),
    "utf8",
  );
  assert.match(sql, /alter table public\.audit_events enable row level security/i);
  assert.match(sql, /is_shop_member\(shop_id\)/);
  assert.doesNotMatch(sql, /for all using \(true\)/i);
});

test("order_status_history migration enforces shop member RLS", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260730_foundation_daily_loop_v1.sql"),
    "utf8",
  );
  assert.match(sql, /order_status_history shop members/i);
  assert.match(sql, /is_shop_member\(shop_id\)/);
});

// ---------------------------------------------------------------------------
// Staff PIN protection
// ---------------------------------------------------------------------------

test("staff GET strips sensitive fields server-side", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/staff.js"), "utf8");
  assert.match(src, /\.map\(staffSummary\)/);
  assert.match(src, /pin_set:Boolean\(row\.pin_hash\)/);
  assert.match(src, /const\{pin_hash,\.\.\.safe\}=row/);
  assert.doesNotMatch(src, /items:.*hourly_rate/s);
});

test("staff OPEN_FILE requires PIN when pin_hash is set", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/staff.js"), "utf8");
  assert.match(src, /if\(employee\.pin_hash&&!validPin\(body\.pin,employee\.pin_hash\)\)/);
});

// ---------------------------------------------------------------------------
// Delivery proof upload validation
// ---------------------------------------------------------------------------

test("delivery proof upload rejects invalid mime type", () => {
  const result = validateDeliveryProofUpload({ mime: "application/pdf", sizeBytes: 1000 });
  assert.equal(result.valid, false);
});

test("delivery proof upload rejects oversized files", () => {
  const result = validateDeliveryProofUpload({
    mime: "image/jpeg",
    sizeBytes: DELIVERY_PROOF_MAX_BYTES + 1,
  });
  assert.equal(result.valid, false);
  assert.match(result.error, /MB/);
});

test("delivery proof upload accepts valid jpeg", () => {
  const result = validateDeliveryProofUpload({ mime: "image/jpeg", sizeBytes: 1024 });
  assert.equal(result.valid, true);
});

// ---------------------------------------------------------------------------
// Stripe payment safety
// ---------------------------------------------------------------------------

test("stripe key mode derived from prefix only — no auto-switch", () => {
  assert.equal(stripeKeyMode("sk_test_abc"), "test");
  assert.equal(stripeKeyMode("sk_live_abc"), "live");
});

test("stripe live/test mode mismatch fails safely", () => {
  const mismatch = assertStripeLivemodeMatchesKey("sk_test_abc", true);
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.reason, /does not match/);

  const match = assertStripeLivemodeMatchesKey("sk_test_abc", false);
  assert.equal(match.ok, true);
});

test("create-checkout verifies order belongs to shop before Stripe session", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/create-checkout.js"), "utf8");
  assert.match(src, /\.eq\("shop_id",shopId\)/);
  assert.match(src, /currency:"usd"/);
  assert.match(src, /return json\(200,\{url:session\.url,session_id:session\.id/);
});

test("stripe webhook verifies signature before processing", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/stripe-order-webhook.js"), "utf8");
  assert.match(src, /constructEvent/);
  assert.match(src, /assertStripeLivemodeMatchesKey/);
});

test("postStripePayment uses idempotency key in RPC", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "netlify/functions/_shared/post-stripe-payment.js"),
    "utf8",
  );
  assert.match(src, /p_idempotency_key/);
  assert.match(src, /stripe-session:/);
});

test("Stripe secret not present in public client bundle", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public/app.js"), "utf8");
  assert.doesNotMatch(appJs, /sk_live|sk_test|STRIPE_SECRET/);
});

// ---------------------------------------------------------------------------
// Migration safety — additive checks
// ---------------------------------------------------------------------------

test("foundation migration is additive without DROP TABLE", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260730_foundation_daily_loop_v1.sql"),
    "utf8",
  );
  assert.doesNotMatch(sql, /drop table/i);
  assert.match(sql, /if not exists/i);
  assert.match(sql, /'NEW'/);
  assert.match(sql, /'CANCELLED'/);
});

test("rollback migration file exists and is marked emergency-only", () => {
  const rollback = path.join(
    process.cwd(),
    "supabase/migrations/20260730_foundation_daily_loop_v1_rollback.sql",
  );
  assert.ok(fs.existsSync(rollback));
  const sql = fs.readFileSync(rollback, "utf8");
  assert.match(sql, /EMERGENCY|manual/i);
  assert.doesNotMatch(sql, /drop table public\.orders/i);
});

// ---------------------------------------------------------------------------
// Today page unchanged since pre-foundation commit
// ---------------------------------------------------------------------------

test("public index.html dashboard Today section preserved", () => {
  const current = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");
  const dashboard = current.match(/<section id="dashboardPage"[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(dashboard, /id="dashboardPage"/);
  assert.match(dashboard, /pos-home|pos-welcome-row/);
  assert.match(dashboard, /rose-welcome-card|profit-intelligence-grid|pos-workspace/);
  assert.doesNotMatch(dashboard, /design-system-overhaul|experimental-today-v2/i);
});

test("order form still routes to Payment Center after create", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "public/app.js"), "utf8");
  assert.match(src, /goToPayment.*openPaymentCenterForOrder/s);
  assert.match(src, /showPage\("paymentsPage"\)/);
});

test("invoice navigation wired in sidebar and loadPage", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(process.cwd(), "public/app.js"), "utf8");
  assert.match(html, /data-page="invoicesPage">Invoices/);
  assert.match(app, /invoicesPage:loadInvoices/);
});
