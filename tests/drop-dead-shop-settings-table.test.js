import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function migrationSql() {
  return fs.readFileSync(
    path.join(root, "supabase/migrations/20260820010000_drop_dead_shop_settings_table.sql"),
    "utf8"
  );
}

// shop_settings was provably dead: zero application code ever read or
// wrote it (confirmed by grep across every Netlify function and frontend
// file), a prior migration (p0-13) had already revoked all authenticated
// privileges on it, and its columns were fully superseded by equivalent
// columns already on public.shops. The only remaining activity was
// complete_florist_onboarding() inserting one throwaway row per signup
// that nothing ever read back. This migration drops that insert and the
// table itself.

test("the redefined RPC no longer inserts into shop_settings", () => {
  const sql = migrationSql();
  assert.doesNotMatch(sql, /insert into public\.shop_settings/);
});

test("every other insert the RPC made (shops, members, profiles, subscription, ai profile, hours, audit) is preserved unchanged", () => {
  const sql = migrationSql();
  assert.match(sql, /insert into public\.shops \(/);
  assert.match(sql, /insert into public\.shop_members \(/);
  assert.match(sql, /insert into public\.profiles \(/);
  assert.match(sql, /insert into public\.shop_subscriptions \(/);
  assert.match(sql, /insert into public\.ai_shop_profiles \(/);
  assert.match(sql, /insert into public\.shop_hours \(/);
  assert.match(sql, /insert into public\.audit_events \(/);
});

test("the update-existing-shop branch still updates every field it did before (receipt_header included)", () => {
  const sql = migrationSql();
  const branchStart = sql.indexOf("update public.shops");
  const branchEnd = sql.indexOf("where id = v_shop_id;", branchStart);
  const branch = sql.slice(branchStart, branchEnd);
  for (const field of ["name", "phone", "email", "website", "tax_rate", "default_delivery_fee", "receipt_header"]) {
    assert.match(branch, new RegExp(`${field}\\s*=`), `update branch must still set ${field}`);
  }
});

test("the table itself is actually dropped", () => {
  const sql = migrationSql();
  assert.match(sql, /drop table if exists public\.shop_settings/);
});

test("migration is registered in both canonical migration-chain lists", () => {
  const snapshot = fs.readFileSync(path.join(root, "tests/florisyn-live-schema-snapshot.test.js"), "utf8");
  const chain = fs.readFileSync(path.join(root, "tests/p0-11-canonical-migration-chain.test.js"), "utf8");
  assert.match(snapshot, /20260820010000_drop_dead_shop_settings_table\.sql/);
  assert.match(chain, /20260820010000_drop_dead_shop_settings_table\.sql/);
});

test("no application code references shop_settings anywhere (the precondition for dropping it)", () => {
  const searchRoots = ["netlify/functions", "public"];
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (entry.name.endsWith(".js") || entry.name.endsWith(".html")) {
        const text = fs.readFileSync(full, "utf8");
        if (text.includes("shop_settings")) hits.push(full);
      }
    }
  };
  for (const r of searchRoots) walk(path.join(root, r));
  assert.deepEqual(hits, [], `shop_settings must not be referenced in application code: ${hits.join(", ")}`);
});
