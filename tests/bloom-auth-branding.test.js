import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const authPages = ["login.html", "signup.html", "forgot-password.html", "verify-email.html", "reset-password.html"];

test("auth pages share bloom-auth.css", () => {
  for (const page of authPages) {
    const html = fs.readFileSync(new URL(`../public/${page}`, import.meta.url), "utf8");
    assert.match(html, /bloom-auth\.css/, `${page} missing auth stylesheet`);
    assert.match(html, /bloom-auth/, `${page} missing auth body class or layout`);
    assert.match(html, /florisyn\/favicon\.svg/, `${page} missing favicon`);
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
  assert.match(js, /auth-resend-confirmation/);
  assert.match(js, /florisyn_pending_email/);
  assert.match(fn, /auth\/v1\/resend/);
  assert.match(fn, /type:\s*"signup"/);
  assert.match(fn, /authRedirectPath\(process\.env, origin, "\/verify-email\?confirmed=1"\)/);
});

test("login pages guide unconfirmed accounts to resend confirmation", () => {
  const login = fs.readFileSync(new URL("../public/login.js", import.meta.url), "utf8");
  const admin = fs.readFileSync(new URL("../public/admin.js", import.meta.url), "utf8");

  assert.match(login, /invalid login credentials\|email not confirmed/i);
  assert.match(login, /\/verify-email\?pending=1&email=/);
  assert.match(admin, /invalid login credentials\|email not confirmed/i);
  assert.match(admin, /\/verify-email\?pending=1&email=/);
});

test("Florisyn app icon uses official monoline mark", () => {
  const icon = fs.readFileSync(new URL("../public/assets/florisyn/florisyn-mark.svg", import.meta.url), "utf8");
  assert.match(icon, /4[Dd]6[Bb]5[Cc]/);
  assert.match(icon, /Florisyn/i);
});
