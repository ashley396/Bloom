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
});

test("Admin CSS forces [hidden] so display:grid cannot leak Admin UI", () => {
  assert.match(adminCss, /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important/i);
  assert.match(adminCss, /#adminApp\[hidden\]/);
  assert.match(adminCss, /body\.admin-locked\s*#adminApp/);
  assert.match(atelierCss, /admin-locked\s*#adminApp/);
});

test("Admin JS restores original auth shell gate sequence", () => {
  assert.match(adminJs, /function lockAdminShell/);
  assert.match(adminJs, /function showLoginGate/);
  assert.match(adminJs, /function showOwnerSetupGate/);
  assert.match(adminJs, /function clearAdminSession/);
  assert.match(adminJs, /lockAdminShell\(\)/);
  assert.match(adminJs, /initializeAdmin\(\)/);
  assert.match(adminJs, /admin-command-center\?action=dashboard/);
  assert.match(adminJs, /if\(!session\?\.accessToken\)/);
  assert.match(adminJs, /clearAdminSession\(\);\s*showLoginGate\(\)/);
  // Still uses original login + session validation paths (no new auth invention).
  assert.match(adminJs, /auth-login/);
  assert.match(adminJs, /bloom_admin_session/);
  assert.match(adminJs, /admin-bootstrap/);
});

test("Admin login cannot be wiped by a stale session restore race", () => {
  assert.match(adminJs, /authEpoch|bumpAuthEpoch/);
  assert.match(adminJs, /session\?\.accessToken!==token/);
  assert.match(adminJs, /bumpAuthEpoch\(\).*cancel any in-flight stale session restore|const epoch=bumpAuthEpoch\(\)/);
  assert.match(adminJs, /Reveal shell first|never let post-auth UI init bounce/i);
});
