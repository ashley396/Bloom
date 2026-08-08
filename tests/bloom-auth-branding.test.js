import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const authPages = ["login.html", "signup.html", "forgot-password.html", "verify-email.html", "reset-password.html"];

test("auth pages share bloom-auth.css", () => {
  for (const page of authPages) {
    const html = fs.readFileSync(new URL(`../public/${page}`, import.meta.url), "utf8");
    assert.match(html, /bloom-auth\.css/, `${page} missing auth stylesheet`);
    assert.match(html, /bloom-auth/, `${page} missing auth body class or layout`);
    assert.match(html, /florisyn\/(favicon\.svg|florisyn-favicon-32\.png)/, `${page} missing favicon`);
    assert.match(html, /<strong>Florisyn<\/strong>/, `${page} should use Florisyn branding`);
    assert.match(html, /\/assets\/florisyn\//, `${page} should use Florisyn assets`);
  }
});

test("auth hero image exists locally", () => {
  const path = new URL("../public/assets/auth/luxury-florist-workspace.jpg", import.meta.url);
  const stat = fs.statSync(path);
  assert.ok(stat.size > 50_000);
});

test("forgot password function exists", () => {
  const src = fs.readFileSync(new URL("../netlify/functions/auth-forgot-password.js", import.meta.url), "utf8");
  assert.match(src, /auth\/v1\/recover/);
});

test("signup redirects to verify email page", () => {
  const signup = fs.readFileSync(new URL("../public/signup.js", import.meta.url), "utf8");
  assert.match(signup, /verify-email\?pending=1/);
  assert.match(signup, /florisyn_pending_email/);
  assert.match(signup, /encodeURIComponent\(payload\.email\)/);
});

test("netlify routes for auth pages", () => {
  const toml = fs.readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  assert.match(toml, /forgot-password/);
  assert.match(toml, /verify-email/);
});

test("verify email page can resend confirmation email", () => {
  const html = fs.readFileSync(new URL("../public/verify-email.html", import.meta.url), "utf8");
  const js = fs.readFileSync(new URL("../public/verify-email.js", import.meta.url), "utf8");
  const fn = fs.readFileSync(new URL("../netlify/functions/auth-resend-confirmation.js", import.meta.url), "utf8");

  assert.match(html, /resendConfirmationForm/);
  assert.match(js, /fetch\("\/api\/auth-resend-confirmation"/);
  assert.doesNotMatch(js, /\/\.netlify\/functions\/auth-resend-confirmation/);
  assert.match(js, /florisyn_pending_email/);
  assert.match(fn, /auth\/v1\/resend/);
  assert.match(fn, /type:\s*"signup"/);
  assert.match(fn, /options:\s*\{\s*email_redirect_to:\s*redirectTo,\s*emailRedirectTo:\s*redirectTo\s*\}/);
  assert.match(fn, /sendSignupConfirmationEmail/);
  assert.match(fn, /confirmationEmailSent/);
  assert.match(fn, /mapAuthProviderFailure\(response, data, \{ flow: "resend" \}\)/);
  assert.match(fn, /authRedirectPath\(process\.env, origin, "\/verify-email\?confirmed=1"\)/);
  assert.match(fn, /If this email has an unconfirmed Florisyn account/);
});

test("signup requests Supabase confirmation email and sends branded confirmation when configured", () => {
  const signup = fs.readFileSync(new URL("../netlify/functions/auth-signup.js", import.meta.url), "utf8");
  const helper = fs.readFileSync(new URL("../netlify/functions/_shared/auth-confirmation-email.js", import.meta.url), "utf8");
  const mailer = fs.readFileSync(new URL("../netlify/functions/_shared/notification-email.js", import.meta.url), "utf8");
  const mapper = fs.readFileSync(new URL("../netlify/functions/_shared/auth-email.js", import.meta.url), "utf8");
  assert.match(signup, /auth\/v1\/signup\?redirect_to=\$\{encodeURIComponent\(confirmUrl\)\}/);
  assert.match(signup, /authRedirectPath\(process\.env,origin,"\/verify-email\?confirmed=1"\)/);
  assert.match(signup, /mapAuthProviderFailure\(response,data,\{flow:"signup"\}\)/);
  assert.match(signup, /confirmationRequired:!data\.access_token/);
  assert.match(signup, /sendSignupConfirmationEmail/);
  assert.match(signup, /confirmationEmailSent/);
  assert.match(helper, /admin\/generate_link/);
  assert.match(helper, /type:\s*"signup"/);
  assert.match(mailer, /RESEND_API_KEY/);
  assert.match(mailer, /api\.resend\.com\/emails/);
  assert.match(mapper, /auth_email_provider_unavailable/);
  assert.match(mapper, /account_already_registered/);
  assert.match(mapper, /invalid_email_domain/);
});

test("Florisyn app icon uses official founder artwork PNG", () => {
  const icon = fs.statSync(new URL("../public/assets/florisyn/florisyn-mark.png", import.meta.url));
  assert.ok(icon.size > 10_000);
});

test("admin page uses Atelier admin stylesheet", () => {
  const html = fs.readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
  const js = fs.readFileSync(new URL("../public/admin.js", import.meta.url), "utf8");
  const adminCss = fs.readFileSync(new URL("../public/admin.css", import.meta.url), "utf8");
  assert.match(html, /florisyn-atelier-admin\.css/);
  assert.match(html, /florisyn-atelier-admin/);
  assert.match(html, /florisyn-apple-touch-180\.png/);
  assert.match(html, /href="\/forgot-password"/);
  assert.match(html, /id="adminPasswordToggle"/);
  assert.match(adminCss, /\[hidden\]\{display:none!important\}/);
  assert.match(js, /adminPasswordToggle/);
  assert.match(js, /input\.type=show\?'text':'password'/);
  assert.match(js, /friendlyAdminError/);
  assert.match(js, /Florisyn Administration could not finish loading/);
  assert.match(js, /localStorage\.removeItem\('bloom_admin_session'\)/);
});

test("login pages guide unconfirmed accounts to resend confirmation", () => {
  const login = fs.readFileSync(new URL("../public/login.js", import.meta.url), "utf8");
  const admin = fs.readFileSync(new URL("../public/admin.js", import.meta.url), "utf8");

  assert.match(login, /invalid login credentials\|invalid email or password\|email not confirmed/i);
  assert.match(login, /\/verify-email\?pending=1&email=/);
  assert.match(admin, /invalid login credentials\|invalid email or password\|email not confirmed/i);
  assert.match(admin, /\/verify-email\?pending=1&email=/);
});
