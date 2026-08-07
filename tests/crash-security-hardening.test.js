import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("app.js serializes session refresh and wraps critical shop forms", () => {
  const src = read("public/app.js");
  assert.match(src, /refreshInFlight/);
  assert.match(src, /\$\("#orderForm"\)&&\(\$\("#orderForm"\)\.onsubmit=async[\s\S]*catch\(err\)\{toast/);
  assert.match(src, /\$\("#productForm"\)&&\(\$\("#productForm"\)\.onsubmit=async[\s\S]*catch\(err\)/);
  assert.match(src, /\$\("#deliveryForm"\)&&\(\$\("#deliveryForm"\)\.onsubmit=async[\s\S]*catch\(err\)/);
  assert.match(src, /\$\("#marketplaceForm"\)&&\(\$\("#marketplaceForm"\)\.onsubmit=async[\s\S]*catch\(err\)/);
  assert.match(src, /\$\("#storeForm"\)&&\(\$\("#storeForm"\)\.onsubmit=async[\s\S]*catch\(err\)/);
  assert.match(src, /Could not save website draft/);
  assert.match(src, /Could not switch shops/);
});

test("admin and production monitor guard localStorage JSON.parse", () => {
  assert.match(read("public/admin.js"), /function readAdminSession\(\)/);
  assert.match(read("public/production-monitor.js"), /catch \{ token = null; \}/);
  assert.match(read("public/admin-command-center-ui.js"), /function readBetaChecks\(\)/);
  assert.match(read("public/admin-library-import-ui.js"), /accessToken \|\| session\?\.access_token/);
});

test("staff PIN and validation errors use client status codes", () => {
  const src = read("netlify/functions/staff.js");
  assert.match(src, /deny\("Incorrect employee PIN\.", 401\)/);
  assert.match(src, /deny\("Missing employee id", 400\)/);
  assert.match(src, /deny\("Employee PIN must be 4–8 digits\.", 400\)/);
});

test("floral-library and subscription checkout parse bodies safely", () => {
  assert.match(read("netlify/functions/floral-library.js"), /bodyOf\(event\)/);
  const checkout = read("netlify/functions/create-subscription-checkout.js");
  assert.match(checkout, /function stripeClient\(\)/);
  assert.doesNotMatch(checkout, /const stripe = new Stripe\(env\("STRIPE_SECRET_KEY"\)\);/);
  assert.match(checkout, /Invalid request body/);
});

test("subscription webhook does not leak error details and lazy-loads Stripe", () => {
  const src = read("netlify/functions/stripe-subscription-webhook.js");
  assert.match(src, /function stripeClient\(\)/);
  assert.match(src, /body: "Webhook error"/);
  assert.doesNotMatch(src, /Webhook error: \$\{error\.message\}/);
});

test("HTTP JSON responses include security headers and origin allowlist", () => {
  const src = read("netlify/functions/_shared/http.js");
  assert.match(src, /X-Content-Type-Options/);
  assert.match(src, /allowedOrigins/);
  assert.match(src, /florisyn\.com/);
  assert.match(read("netlify.toml"), /Cross-Origin-Opener-Policy/);
});

test("app.js pass2 guards payment checkout and inventory listeners", () => {
  const src = read("public/app.js");
  assert.match(src, /prepareOrderBuilder[\s\S]*Order form unavailable/);
  assert.match(src, /inventoryWholesaleCost"\)\?\.addEventListener/);
  assert.match(src, /if\(\$\("#checkout"\)\)\$\("#checkout"\)\.onclick/);
  assert.match(src, /florisynUnhandledToast/);
  assert.match(src, /window\.addEventListener\("unhandledrejection"/);
  assert.match(src, /openCustomer[\s\S]*Customer form unavailable/);
  assert.match(src, /openInventory[\s\S]*Inventory form unavailable/);
  assert.match(src, /if\(\$\("#paymentStatus"\)\)\$\("#paymentStatus"\)\.textContent/);
});

test("auth refresh re-checks shop membership before minting tokens", () => {
  const refresh = read("netlify/functions/auth-refresh.js");
  const access = read("netlify/functions/_shared/florist-access.js");
  assert.match(refresh, /assertFloristAccessOrAdmin/);
  assert.match(refresh, /response\.json\(\)\.catch/);
  assert.match(access, /membership_check_unavailable/);
  assert.match(access, /\.eq\("status", "active"\)/);
  assert.doesNotMatch(access, /retry without status|Fail open|without.*status/);
});

test("signup never returns session tokens; client does not auto-store bloom_session", () => {
  const signup = read("netlify/functions/auth-signup.js");
  const client = read("public/signup.js");
  assert.match(signup, /accessToken:null/);
  assert.match(signup, /session_tokens_omitted:true/);
  assert.doesNotMatch(client, /localStorage\.setItem\('bloom_session'/);
  assert.match(client, /authClient\?\.postAuth/);
  assert.match(client, /\/login\?account=created|verify-email/);
});

test("login and verify-email guard missing auth client and DOM nodes", () => {
  const login = read("public/login.js");
  const verify = read("public/verify-email.js");
  assert.match(login, /authClient\?\.postAuth/);
  assert.match(login, /authClient\?\.rateLimitMessage/);
  assert.match(verify, /title\) title\.textContent/);
  assert.match(verify, /resendButton\) \{\s*resendButton\.disabled/);
});

test("admin shop list and audit escape HTML; check payment avoids null delete", () => {
  const admin = read("public/admin.js");
  const app = read("public/app.js");
  assert.match(admin, /escapeHtml\(s\.name\)/);
  assert.match(admin, /escapeHtml\(JSON\.stringify\(x\.details\)\)/);
  assert.match(app, /if\(checkBtn\)delete checkBtn\.dataset\.moreMethod/);
  assert.match(read("netlify/functions/_shared/supabase.js"), /membershipSchemaUnavailable/);
});
