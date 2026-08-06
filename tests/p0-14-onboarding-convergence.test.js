import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const sql = fs.readFileSync(
  path.join(root, "supabase/migrations/20260804224500_p0_14_onboarding_convergence.sql"),
  "utf8"
);

test("P0-14 converges Auth-triggered default shops to the complete onboarding state", () => {
  assert.match(sql, /create or replace function public\.complete_florist_onboarding/i);
  assert.match(sql, /insert into public\.shop_subscriptions[\s\S]*?on conflict \(shop_id\) do nothing/i);
  assert.match(sql, /insert into public\.ai_shop_profiles[\s\S]*?on conflict \(shop_id\) do update/i);
  assert.match(sql, /insert into public\.shop_settings[\s\S]*?on conflict \(shop_id\) do update/i);
  assert.match(sql, /for day_index in 0\.\.6 loop[\s\S]*?on conflict \(shop_id, weekday\) do nothing/i);
});

test("P0-14 retains signed-in authorization and explicit RPC ACLs", () => {
  assert.match(sql, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(sql, /if v_user_id is null[\s\S]*?errcode = '42501'/i);
  assert.match(sql, /if not public\.user_can_manage_shop\(v_shop_id\)/i);
  assert.match(sql, /revoke all privileges on function public\.complete_florist_onboarding[\s\S]*?from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant execute on function public\.complete_florist_onboarding[\s\S]*?to authenticated, service_role/i);
});

test("P0-14 keeps onboarding side effects in the database transaction", () => {
  assert.match(sql, /insert into public\.shop_members/i);
  assert.match(sql, /insert into public\.profiles/i);
  assert.match(sql, /insert into public\.audit_events/i);
  assert.doesNotMatch(sql, /\b(commit|rollback)\b\s*;/i);
});
