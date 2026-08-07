import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const recovery = fs.readFileSync(path.join(root, "netlify/functions/_shared/auth-recovery-email.js"), "utf8");
const forgot = fs.readFileSync(path.join(root, "netlify/functions/auth-forgot-password.js"), "utf8");
const siteUrl = fs.readFileSync(path.join(root, "netlify/functions/_shared/site-url.js"), "utf8");
const adminCc = fs.readFileSync(path.join(root, "netlify/functions/admin-command-center.js"), "utf8");

test("password recovery email uses generate_link recovery + production redirect helper", () => {
  assert.match(recovery, /type:\s*"recovery"/);
  assert.match(recovery, /authRedirectPath/);
  assert.match(recovery, /localhost_redirect_blocked/);
  assert.match(recovery, /Reset your Florisyn password/);
  assert.match(forgot, /sendPasswordRecoveryEmail/);
  assert.match(forgot, /auth_recover_branded_sent/);
  assert.match(siteUrl, /\/reset-password/);
});

test("admin command center dashboard soft-fails query errors", () => {
  assert.match(adminCc, /safeSelect/);
  assert.match(adminCc, /admin_command_center_safe_count_error/);
  assert.doesNotMatch(
    adminCc.slice(adminCc.indexOf("action === \"dashboard\""), adminCc.indexOf("action === \"users\"")),
    /throw error/
  );
});
