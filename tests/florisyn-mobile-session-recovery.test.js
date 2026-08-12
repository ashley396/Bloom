import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const mobileCss = fs.readFileSync(path.join(root, "public/florisyn-mobile-shell.css"), "utf8");

test("expired mobile session shows recovery screen with sign-in actions", () => {
  assert.match(appJs, /function showSessionRecovery\(/);
  assert.match(appJs, /sessionRecoverySignIn/);
  assert.match(appJs, /sessionRecoveryClear/);
  assert.match(appJs, /Clear session \/ Sign out/);
  assert.match(appJs, /Sign in again/);
  assert.match(appJs, /florisyn-session-recovery/);
  assert.match(appJs, /showSessionRecovery\([\s\S]*?#app[\s\S]*?hidden=true/);
  assert.match(mobileCss, /body\.florisyn-session-recovery #auth[\s\S]*display: block !important/);
});

test("expired session does not render active dashboard controls as usable", () => {
  assert.match(appJs, /function requireActiveSession\(/);
  assert.match(appJs, /function showPage\(id\)\{[\s\S]*?requireActiveSession\(\)/);
  assert.match(appJs, /hasUsableSession\(\)\{return Boolean\(session\?\.accessToken\)&&!sessionRecoveryActive\}/);
  assert.match(appJs, /if\(app\)app\.hidden=true/);
  assert.match(mobileCss, /body\.florisyn-session-recovery #app[\s\S]*display: none !important/);
  assert.match(mobileCss, /body\.florisyn-session-recovery \.mobile-nav\.atelier-mobile-nav[\s\S]*display: none !important/);
});

test("repeated API auth failures do not spam toasts", () => {
  assert.match(appJs, /AUTH_TOAST_COOLDOWN_MS/);
  assert.match(appJs, /lastAuthToastAt/);
  assert.match(appJs, /if\(sessionRecoveryActive&&isAuthToastMessage\(msg\)\)return/);
  assert.match(appJs, /function isAuthToastMessage/);
  assert.match(appJs, /if\(auth&&r\.status===401\)\{handleSessionInvalid\(\);throw sessionExpiredError/);
  assert.match(appJs, /if\(err\?\.code==="session_expired"\|\|sessionRecoveryActive\)return/);
});

test("bottom nav signed-out tap redirects to recovery instead of navigating", () => {
  assert.match(appJs, /function wireSignedOutInteractionGuards\(/);
  assert.match(appJs, /sessionRecoveryActive\|\|!hasUsableSession\(\)/);
  assert.match(appJs, /\.mobile-nav[\s\S]*?handleSessionInvalid\("Choose Sign in to continue\."\)/);
  assert.match(appJs, /wireMobileDrawerToggleFallback[\s\S]*?sessionRecoveryActive\|\|!hasUsableSession\(\)/);
});

test("Lily FAB while signed out shows sign-in requirement without opening panel", () => {
  assert.match(appJs, /\.lily-fab,#lilyFab/);
  assert.match(appJs, /Sign in to use Lily/);
  assert.match(appJs, /stopImmediatePropagation/);
  assert.match(mobileCss, /body\.florisyn-session-recovery \.lily-fab[\s\S]*display: none !important/);
});

test("valid session still loads dashboard through bootFloristApp", () => {
  assert.match(appJs, /async function bootFloristApp\(/);
  assert.match(appJs, /bootFloristApp\(\)/);
  assert.match(appJs, /showApp\(\)/);
  assert.match(appJs, /loadDashboard\(\),loadInventory\(\),loadOrders\(\),loadProducts\(\)/);
  assert.match(appJs, /if\(!session\?\.accessToken\)\{showAuth\(\);return\}/);
  assert.doesNotMatch(appJs, /if\(session\?\.accessToken\)\{showApp\(\);Promise\.all/);
});
