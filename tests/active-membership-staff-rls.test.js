import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migration = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260812_active_membership_staff_privacy_v1.sql"),
  "utf8",
);

test("membership hardening additively creates and backfills status", () => {
  assert.match(migration, /add column if not exists status text/i);
  assert.match(migration, /set status = 'active'\s+where status is null/i);
  assert.match(migration, /alter column status set default 'active'/i);
  assert.match(migration, /alter column status set not null/i);
  assert.match(migration, /check \(status in \('invited', 'active', 'suspended'\)\)/i);
  assert.doesNotMatch(migration, /drop table|truncate/i);
});

test("tenant membership predicate rejects inactive and unauthenticated users", () => {
  const helper = migration.match(
    /create or replace function public\.is_shop_member[\s\S]*?\$\$;/i,
  )?.[0] || "";
  assert.match(helper, /auth\.uid\(\) is not null/i);
  assert.match(helper, /status = 'active'/i);
  assert.match(helper, /shop_id = target_shop/i);
  assert.match(helper, /user_id = auth\.uid\(\)/i);
  assert.match(helper, /security definer/i);
  assert.match(helper, /set search_path = ''/i);
  assert.match(migration, /revoke all on function public\.is_shop_member\(uuid\) from public/i);
  assert.match(migration, /revoke all on function public\.is_shop_member\(uuid\) from anon/i);
});

test("private staff table permits only active owners and managers", () => {
  const helper = migration.match(
    /create or replace function public\.is_shop_staff_manager[\s\S]*?\$\$;/i,
  )?.[0] || "";
  assert.match(helper, /auth\.uid\(\) is not null/i);
  assert.match(helper, /status = 'active'/i);
  assert.match(helper, /role in \('owner', 'manager'\)/i);
  assert.match(helper, /set search_path = ''/i);
  assert.match(migration, /revoke all on function public\.is_shop_staff_manager\(uuid\) from public/i);
  assert.match(migration, /revoke all on function public\.is_shop_staff_manager\(uuid\) from anon/i);
  assert.match(migration, /create policy "staff owner manager access" on public\.staff/i);
  assert.match(migration, /for all\s+to authenticated/i);
  assert.match(migration, /using \(public\.is_shop_staff_manager\(shop_id\)\)/i);
  assert.match(migration, /with check \(public\.is_shop_staff_manager\(shop_id\)\)/i);
  assert.match(migration, /create policy "staff time entries owner manager access" on public\.staff_time_entries/i);
});
