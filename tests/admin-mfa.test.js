import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { adminMfaGateDecision, challengeAndVerifyAdminMfa } from "../public/admin-mfa.js";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("Admin MFA gate requires enroll when no factors, challenge when enrolled, allow at aal2", () => {
  assert.deepEqual(adminMfaGateDecision({ currentLevel: "aal2", nextLevel: "aal2" }).action, "allow");
  assert.deepEqual(
    adminMfaGateDecision({ currentLevel: "aal1", nextLevel: "aal2", verifiedFactorCount: 1 }).action,
    "challenge"
  );
  assert.deepEqual(
    adminMfaGateDecision({ currentLevel: "aal1", nextLevel: "aal1", pendingFactorCount: 1 }).action,
    "challenge"
  );
  assert.deepEqual(
    adminMfaGateDecision({ currentLevel: "aal1", nextLevel: "aal1", verifiedFactorCount: 0 }).action,
    "enroll"
  );
});

test("challengeAndVerifyAdminMfa uses supabase.auth.mfa.challenge + verify", async () => {
  const calls = [];
  const supabase = {
    auth: {
      mfa: {
        async challenge(args) {
          calls.push(["challenge", args]);
          return { data: { id: "chal-1" }, error: null };
        },
        async verify(args) {
          calls.push(["verify", args]);
          return {
            data: {
              access_token: "at",
              refresh_token: "rt",
              user: { id: "admin-1", email: "owner@example.com" }
            },
            error: null
          };
        }
      }
    }
  };
  const tokens = await challengeAndVerifyAdminMfa(supabase, { factorId: "factor-1", code: "123456" });
  assert.equal(tokens.accessToken, "at");
  assert.deepEqual(calls[0], ["challenge", { factorId: "factor-1" }]);
  assert.deepEqual(calls[1], ["verify", { factorId: "factor-1", challengeId: "chal-1", code: "123456" }]);
  await assert.rejects(() => challengeAndVerifyAdminMfa(supabase, { factorId: "factor-1", code: "12" }));
});

test("Admin login wires MFA only after password + platform admin check", () => {
  const adminJs = read("public/admin.js");
  assert.match(adminJs, /from '\.\/admin-mfa\.js'/);
  assert.match(adminJs, /ensureAdminMfaBeforeDashboard|enterAdminAfterAuth/);
  assert.match(adminJs, /enrollAdminTotp/);
  assert.match(adminJs, /challengeAndVerifyAdminMfa/);
  assert.match(adminJs, /admin-mfa-config/);
  assert.match(adminJs, /admin_mfa_enrollment_required|admin_mfa_challenge_required/);
  // Password login still uses auth-login; MFA is an Admin-only second step.
  assert.match(adminJs, /auth-login/);
  assert.match(adminJs, /admin-command-center\?action=dashboard/);
});

test("Admin MFA UI exists only on admin.html login, not florist pages", () => {
  const adminHtml = read("public/admin.html");
  assert.match(adminHtml, /id="adminMfaForm"/);
  assert.match(adminHtml, /id="adminMfaCode"/);
  assert.match(adminHtml, /id="adminPasswordToggle"/);
  assert.match(adminHtml, /forgot-password/);
  assert.match(adminHtml, /admin-mfa\.js|admin\.js/);

  for (const file of ["public/login.js", "public/app.js", "public/index.html", "public/login.html"]) {
    const src = read(file);
    assert.doesNotMatch(src, /adminMfaForm|admin-mfa\.js|mfa\.enroll|mfa\.challenge|mfa\.verify/);
  }
});

test("admin-mfa.js uses Supabase MFA enroll/challenge/verify APIs", () => {
  const src = read("public/admin-mfa.js");
  assert.match(src, /supabase\.auth\.mfa\.enroll/);
  assert.match(src, /supabase\.auth\.mfa\.challenge/);
  assert.match(src, /supabase\.auth\.mfa\.verify/);
  assert.match(src, /getAuthenticatorAssuranceLevel/);
  assert.doesNotMatch(src, /app\.js|showPage|Website Studio|BloomDaisy|BloomRose/);
});

test("admin-mfa-config exposes only public anon settings", () => {
  const src = read("netlify/functions/admin-mfa-config.js");
  assert.match(src, /publicSettings/);
  assert.match(src, /anonKey/);
  assert.doesNotMatch(src, /SERVICE_ROLE|service_role|requireServerKey/);
});
