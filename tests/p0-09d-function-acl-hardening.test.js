import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260804171338_p0_09d_function_acl_hardening.sql"
);
const sql = fs.readFileSync(migrationPath, "utf8");

test("P0-09D hardening disables permissive app-function defaults deployably", () => {
  assert.match(
    sql,
    /alter default privileges for role postgres in schema public\s+revoke execute on functions from public, anon, authenticated;/i
  );
  assert.doesNotMatch(
    sql,
    /^\s*alter default privileges for role supabase_admin/im,
    "postgres cannot alter defaults owned by Supabase's platform role"
  );
  assert.match(
    sql,
    /verify supabase_admin defaults separately as a\s+-- platform configuration\/advisor gate/i
  );
});

test("P0-09D removes direct API access from trigger-only functions", () => {
  for (const functionName of [
    "bloom_subscription_admin_alert",
    "handle_new_user",
    "bloom_inventory_price_3x",
    "touch_updated_at"
  ]) {
    assert.match(
      sql,
      new RegExp(
        `revoke all privileges on function public\\.${functionName}\\(\\)\\s+from public, anon, authenticated, service_role;`,
        "i"
      )
    );
  }
});

test("P0-09D pins mutable trigger-function search paths", () => {
  assert.match(
    sql,
    /alter function public\.bloom_inventory_price_3x\(\)\s+set search_path = pg_catalog, public;/i
  );
  assert.match(
    sql,
    /alter function public\.touch_updated_at\(\)\s+set search_path = pg_catalog, public;/i
  );
});

test("P0-09D keeps onboarding authenticated and removes anonymous execution", () => {
  assert.match(
    sql,
    /revoke all privileges on function public\.complete_florist_onboarding\([\s\S]*?\) from public, anon, authenticated, service_role;/i
  );
  assert.match(
    sql,
    /grant execute on function public\.complete_florist_onboarding\([\s\S]*?\) to authenticated, service_role;/i
  );
});

test("P0-09D grants RLS helpers only to authenticated and service roles", () => {
  for (const functionName of [
    "user_has_shop_access",
    "user_is_shop_owner",
    "is_shop_member"
  ]) {
    assert.match(
      sql,
      new RegExp(
        `revoke all privileges on function public\\.${functionName}\\(uuid\\)\\s+from public, anon, authenticated, service_role;`,
        "i"
      )
    );
    assert.match(
      sql,
      new RegExp(
        `grant execute on function public\\.${functionName}\\(uuid\\)\\s+to authenticated, service_role;`,
        "i"
      )
    );
  }
});
