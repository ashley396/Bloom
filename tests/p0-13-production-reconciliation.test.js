import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260804223000_p0_13_policy_consolidation.sql"),
  "utf8",
);
const onboarding = fs.readFileSync(path.join(root, "netlify/functions/complete-onboarding.js"), "utf8");
const stores = fs.readFileSync(path.join(root, "netlify/functions/stores.js"), "utf8");
const preflight = fs.readFileSync(
  path.join(root, "supabase/production_reconciliation/P0-13-PREFLIGHT.sql"),
  "utf8",
);
const verify = fs.readFileSync(
  path.join(root, "supabase/production_reconciliation/P0-13-VERIFY.sql"),
  "utf8",
);
const runtime = fs.readFileSync(
  path.join(root, "tests/fixtures/p0-13-staging-runtime.sql"),
  "utf8",
);

test("P0-13 removes every legacy policy before installing one exact authenticated set", () => {
  assert.match(migration, /from pg_policies[\s\S]*?tablename = any\(array\[/i);
  assert.match(migration, /execute format\('drop policy %I on %I\.%I'/i);
  assert.doesNotMatch(migration, /create policy[^;]*\bto public\b/i);
  assert.equal((migration.match(/\bcreate policy\b/gi) || []).length, 28);
  assert.match(verify, /policy_count[^\n]*= 28/i);
});

test("P0-13 closes self-enrollment and keeps membership mutation owner-only", () => {
  assert.doesNotMatch(migration, /for insert to authenticated[\s\S]{0,200}user_id\s*=\s*auth\.uid\(\)/i);
  for (const action of ["insert", "update", "delete"]) {
    assert.match(
      migration,
      new RegExp(`create policy "members owner ${action}"[\\s\\S]*?public\\.user_is_shop_owner\\(shop_id\\)`, "i"),
    );
  }
});

test("onboarding uses the atomic RPC and no longer performs direct table writes", () => {
  assert.match(onboarding, /client\.rpc\("complete_florist_onboarding"/);
  assert.doesNotMatch(onboarding, /\.from\("(?:shops|shop_members|shop_subscriptions|ai_shop_profiles|shop_hours|audit_events)"\)/);
  assert.match(migration, /insert into public\.audit_events[\s\S]*?shop\.onboarding_completed/i);
  assert.match(migration, /insert into public\.shops \([\s\S]*?owner_user_id, owner_id/i);
});

test("additional stores use a service-only atomic RPC", () => {
  assert.match(stores, /requireServerKeyFor\("add_store"\)/);
  assert.match(stores, /admin\(\)\.rpc\("create_additional_shop_atomic"/);
  assert.doesNotMatch(stores, /client\.from\("shops"\)\.insert/);
  assert.doesNotMatch(stores, /client\.from\("shop_members"\)\.insert/);
  assert.match(migration, /v_claim_role <> 'service_role'/i);
  assert.match(migration, /grant execute on function public\.create_additional_shop_atomic\(uuid, jsonb\)[\s\S]*?to service_role;/i);
  assert.doesNotMatch(migration, /grant execute on function public\.create_additional_shop_atomic\(uuid, jsonb\)\s+to authenticated/i);
});

test("manager operations use a dedicated active-member helper", () => {
  assert.match(migration, /create or replace function public\.user_can_manage_shop\(target_shop_id uuid\)/i);
  assert.match(migration, /coalesce\(sm\.status, 'active'\) = 'active'/i);
  assert.match(migration, /in \('owner', 'manager', 'admin'\)/i);
  assert.match(migration, /shops active manager update[\s\S]*?user_can_manage_shop\(id\)/i);
});

test("runtime harness proves policy count, self-enrollment denial, and atomic workflows", () => {
  assert.match(runtime, /n <> 28/);
  assert.match(runtime, /cross-shop self-enrollment unexpectedly succeeded/i);
  assert.match(runtime, /complete_florist_onboarding/);
  assert.match(runtime, /create_additional_shop_atomic/);
  assert.match(runtime, /shop_settings is directly exposed/i);
  assert.match(runtime, /rollback;\s*$/i);
});

test("production package is read-only before approval and never edits migration history directly", () => {
  const executablePreflight = preflight.replace(/^\s*--.*$/gm, "").trim();
  const executableVerify = verify.replace(/^\s*--.*$/gm, "").trim();
  assert.match(executablePreflight, /^with\b/i);
  assert.doesNotMatch(executablePreflight, /^\s*(insert|update|delete|alter|create|drop|truncate|grant|revoke)\b/im);
  assert.match(preflight, /marketplace_security_hardening_v1/i);
  assert.match(preflight, /vojeelyiakvpqpwinicj/i);
  assert.doesNotMatch(preflight, /sqdzaoxqlsgbphvlmfeb/i);
  assert.doesNotMatch(executableVerify, /^\s*(insert|update|delete|alter|create|drop|truncate|grant|revoke)\b/im);
  assert.doesNotMatch(
    `${executablePreflight}\n${executableVerify}`,
    /(?:insert\s+into|update|delete\s+from)\s+supabase_migrations\.schema_migrations/i,
  );
});
