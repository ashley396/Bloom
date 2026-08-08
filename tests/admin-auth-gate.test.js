import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const adminHtml = fs.readFileSync(path.join(root, "public/admin.html"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "public/admin.js"), "utf8");
const adminCss = fs.readFileSync(path.join(root, "public/admin.css"), "utf8");
const atelierCss = fs.readFileSync(path.join(root, "public/florisyn-atelier-admin.css"), "utf8");

test("Admin HTML starts locked and hides app until auth", () => {
  assert.match(adminHtml, /id="adminAuthGateCss"/);
  assert.match(adminHtml, /class="[^"]*\badmin-locked\b/);
  assert.match(adminHtml, /id="adminApp"[^>]*\bhidden\b/);
  assert.match(adminHtml, /id="adminApp"[^>]*aria-hidden="true"/);
  assert.match(adminHtml, /id="adminAuth"[^>]*\bhidden\b/);
  assert.match(adminHtml, /id="ownerSetup"[^>]*\bhidden\b/);
  // Design Mode / UI Editor remains Admin-gated visual tooling.
  assert.match(adminHtml, /uiDesignModeRoot/);
  assert.match(adminHtml, /florisyn-ui-editor\.js/);
});

test("Admin CSS forces [hidden] so display:grid cannot leak Admin UI", () => {
  assert.match(adminCss, /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important/i);
  assert.match(adminCss, /#adminApp\[hidden\]/);
  assert.match(adminCss, /body\.admin-locked\s*#adminApp/);
  assert.match(atelierCss, /admin-locked\s*#adminApp/);
});

test("Admin JS restores auth shell gate sequence", () => {
  assert.match(adminJs, /function lockAdminShell/);
  assert.match(adminJs, /function showLoginGate/);
  assert.match(adminJs, /function showOwnerSetupGate/);
  assert.match(adminJs, /function clearAdminSession/);
  assert.match(adminJs, /lockAdminShell\(\)/);
  assert.match(adminJs, /initializeAdmin\(\)/);
  assert.match(adminJs, /admin-command-center\?action=dashboard/);
  assert.match(adminJs, /if\(!session\?\.accessToken/);
  assert.match(adminJs, /auth-login/);
  assert.match(adminJs, /bloom_admin_session/);
  assert.match(adminJs, /admin-bootstrap/);
  assert.match(adminJs, /FlorisynUiEditor/);
  assert.match(adminJs, /uiDesignMode/);
  assert.match(adminJs, /florisyn-admin-authenticated/);
});

test("Admin login exposes password eye and reset via existing forgot-password API", () => {
  assert.match(adminHtml, /id="adminPasswordToggle"/);
  assert.match(adminHtml, /aria-label="Show password"/);
  assert.match(adminHtml, /id="adminResetPassword"/);
  assert.match(adminHtml, /Reset password/);
  assert.match(adminJs, /adminPasswordToggle/);
  assert.match(adminJs, /auth-forgot-password/);
  assert.match(adminCss, /\.admin-password-toggle/);
});

test("Admin command center does not use jQuery .change on DOM helpers", () => {
  const cc = fs.readFileSync(path.join(root, "public/admin-command-center-ui.js"), "utf8");
  assert.doesNotMatch(cc, /\?\.change\(/);
  assert.match(cc, /userRoleFilter.*addEventListener\('change'/);
});
