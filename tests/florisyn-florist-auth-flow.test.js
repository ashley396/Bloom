import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  mapAuthProviderFailure,
  redactAuthMeta,
  logAuthEvent
} from "../netlify/functions/_shared/auth-email.js";
import { validateEmail } from "../netlify/functions/_shared/validation.js";
import { safePublicError } from "../netlify/functions/_shared/production.js";

const loginFn = fs.readFileSync(new URL("../netlify/functions/auth-login.js", import.meta.url), "utf8");
const signupFn = fs.readFileSync(new URL("../netlify/functions/auth-signup.js", import.meta.url), "utf8");
const resendFn = fs.readFileSync(new URL("../netlify/functions/auth-resend-confirmation.js", import.meta.url), "utf8");
const forgotFn = fs.readFileSync(new URL("../netlify/functions/auth-forgot-password.js", import.meta.url), "utf8");
const resetFn = fs.readFileSync(new URL("../netlify/functions/auth-reset-password.js", import.meta.url), "utf8");
const loginJs = fs.readFileSync(new URL("../public/login.js", import.meta.url), "utf8");
const appJs = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const supabase = fs.readFileSync(new URL("../netlify/functions/_shared/supabase.js", import.meta.url), "utf8");

test("florist login stores bloom_session and redirects home", () => {
  assert.match(loginJs, /localStorage\.setItem\('bloom_session'/);
  assert.match(loginJs, /location\.href="\/"/);
  assert.doesNotMatch(loginJs, /admin-bootstrap|ownerSetup/);
});

test("confirmed florist boot loads shop workflows from session", () => {
  assert.match(appJs, /if\(session\?\.accessToken\)\{showApp\(\)/);
  assert.match(appJs, /loadDashboard\(\),loadInventory\(\),loadOrders\(\),loadProducts\(\)/);
  assert.match(appJs, /localStorage\.getItem\("bloom_session"\)/);
});

test("missing shop membership shows onboarding, not invalid-login copy", () => {
  assert.match(supabase, /shop_membership_required/);
  assert.match(supabase, /not linked to an active flower shop/);
  assert.match(loginFn, /shop_membership_required/);
  assert.match(loginFn, /platform_admins/);
  assert.match(loginFn, /hasActiveShopMembership|shop_members/);
  assert.match(loginJs, /shop_membership_required/);
  assert.match(appJs, /showMembershipOnboarding/);
  assert.match(appJs, /SHOP SETUP NEEDED/);
  assert.match(appJs, /This is not an invalid password problem/);
  assert.doesNotMatch(appJs, /showMembershipOnboarding[\s\S]{0,200}Invalid email or password/);
});

test("login membership gate fails closed when lookup unavailable", () => {
  assert.match(loginFn, /membership_check_unavailable/);
  assert.match(loginFn, /service_role_missing/);
  assert.doesNotMatch(loginFn, /Fail open to currentUser/);
  assert.doesNotMatch(loginFn, /return \{ ok: true, skipped: true \}/);
  assert.match(loginFn, /status: 503/);
  assert.match(loginJs, /membership_check_unavailable/);
});

test("login UI separates unconfirmed email from wrong-password guidance", () => {
  assert.match(loginJs, /invalid login credentials\|invalid email or password\|email not confirmed/i);
  assert.match(loginJs, /forgot-password/);
  assert.match(loginJs, /email_not_confirmed/);
  assert.match(loginJs, /invalid_credentials/);
  assert.match(loginFn, /auth_rate_limited/);
  assert.match(loginFn, /auth_email_provider_unavailable/);
});

test("validateEmail rejects malformed domains with actionable code", () => {
  assert.equal(validateEmail("ada@localhost", { required: true }).code, "invalid_email_domain");
  assert.equal(validateEmail("ada@.com", { required: true }).ok, false);
  assert.equal(validateEmail("florist@liliesinbloom26.com", { required: true }).ok, true);
});

test("mapAuthProviderFailure covers rate limit, provider outage, expired reset, confirmed hint", () => {
  assert.equal(mapAuthProviderFailure({ status: 429 }, {}, { flow: "signup" }).code, "auth_rate_limited");
  assert.equal(
    mapAuthProviderFailure({ status: 503 }, { message: "smtp timeout" }, { flow: "resend" }).code,
    "auth_email_provider_unavailable"
  );
  assert.equal(
    mapAuthProviderFailure({ status: 400 }, { msg: "Email not confirmed" }, { flow: "login" }).code,
    "email_not_confirmed"
  );
  assert.equal(
    mapAuthProviderFailure({ status: 400 }, { message: "token expired" }, { flow: "reset" }).code,
    "reset_link_expired"
  );
  assert.match(
    mapAuthProviderFailure({ status: 422 }, { msg: "User already registered" }, { flow: "signup" }).error,
    /Forgot Password/
  );
});

test("auth email logs redact secrets and never include passwords or tokens", () => {
  const redacted = redactAuthMeta({
    password: "secret-pass",
    access_token: "tok",
    refresh_token: "r",
    email_domain: "shop.com",
    provider_status: 503
  });
  assert.equal(redacted.password, undefined);
  assert.equal(redacted.access_token, undefined);
  assert.equal(redacted.refresh_token, undefined);
  assert.equal(redacted.email_domain, "shop.com");
  assert.equal(typeof logAuthEvent, "function");
});

test("auth handlers wire mapAuthProviderFailure and structured auth logging", () => {
  for (const src of [loginFn, signupFn, resendFn, forgotFn, resetFn]) {
    assert.match(src, /logAuthEvent/);
    assert.doesNotMatch(src, /password:\s*body\.password/);
    assert.doesNotMatch(src, /structuredLog\([^\)]*password/);
  }
  assert.match(loginFn, /email_not_confirmed/);
  assert.match(loginFn, /invalid_credentials/);
  assert.match(signupFn, /mapAuthProviderFailure/);
  assert.match(resendFn, /Forgot Password/);
  assert.match(forgotFn, /recover_accepted|auth_recover/);
  assert.match(resetFn, /reset_link_expired/);
});

test("membership public error stays actionable through safePublicError", () => {
  const err = new Error("x");
  err.statusCode = 403;
  err.code = "shop_membership_required";
  assert.match(safePublicError(err), /not linked to an active flower shop/i);
});
