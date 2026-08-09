import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260804205339_p0_12_closed_beta_tenant_isolation.sql"),
  "utf8",
);
const staff = fs.readFileSync(path.join(root, "netlify/functions/staff.js"), "utf8");

test("P0-12 installs active-member policies on previously locked core tables", () => {
  for (const table of ["customers", "inventory", "expenses"]) {
    assert.match(
      migration,
      new RegExp(`create policy "${table} active shop access"[\\s\\S]*?on public\\.${table} for all to authenticated[\\s\\S]*?public\\.is_shop_member\\(shop_id\\)`, "i"),
    );
  }
});

test("P0-12 permits order reads and mutations but keeps direct inserts revoked", () => {
  for (const action of ["select", "update", "delete"]) {
    assert.match(
      migration,
      new RegExp(`create policy "orders active shop ${action}"[\\s\\S]*?on public\\.orders for ${action} to authenticated`, "i"),
    );
  }
  assert.doesNotMatch(migration, /on public\.orders for insert to authenticated/i);
  assert.match(migration, /revoke insert on table public\.orders from authenticated;/i);
  assert.match(migration, /grant select, update, delete on table public\.orders to authenticated;/i);
});

test("P0-12 explicitly removes anonymous private-table access", () => {
  assert.match(
    migration,
    /revoke all privileges on table[\s\S]*?public\.customers,[\s\S]*?public\.payments,[\s\S]*?public\.staff_time_entries,[\s\S]*?from anon;/i,
  );
});

test("P0-12 conditionally removes Data API execution from the RLS event trigger", () => {
  assert.match(migration, /to_regprocedure\('public\.rls_auto_enable\(\)'\) is not null/i);
  assert.match(
    migration,
    /revoke all privileges on function public\.rls_auto_enable\(\)[\s\S]*?from public, anon, authenticated, service_role;/i,
  );
});

test("P0-12 fail-closes sensitive staff tables from direct authenticated access", () => {
  assert.match(migration, /drop policy if exists "staff shop access" on public\.staff;/i);
  assert.match(migration, /drop policy if exists "staff time entries shop access" on public\.staff_time_entries;/i);
  assert.doesNotMatch(migration, /grant [^;]* on table public\.staff(?:_time_entries)? to authenticated/i);
  assert.match(staff, /currentUser\(event\);[\s\S]*?requireRoles\(ctx,\s*\["owner",\s*"manager"\]\);[\s\S]*?const shopId\s*=\s*ctx\.shopId;[\s\S]*?const client\s*=\s*admin\(\);/);
  assert.match(staff, /const\s*\{\s*pin_hash,\s*\.\.\.safe\s*\}\s*=\s*row/);
});

test("P0-12 grants only read access to payment ledger rows", () => {
  assert.match(migration, /grant select on table public\.payments to authenticated;/i);
  assert.doesNotMatch(migration, /grant [^;]*(?:insert|update|delete)[^;]* on table public\.payments to authenticated/i);
});
