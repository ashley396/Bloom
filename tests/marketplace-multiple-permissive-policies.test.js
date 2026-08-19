import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function migrationSql() {
  return fs.readFileSync(
    path.join(root, "supabase/migrations/20260819260000_marketplace_multiple_permissive_policies.sql"),
    "utf8"
  );
}

// Supabase's advisor flagged 31 "multiple permissive policies" findings
// that collapse to 8 distinct policy pairs. For PERMISSIVE policies,
// Postgres always ORs every applicable policy together for a given
// role+command — so merging two permissive policies covering the SAME
// command scope into one OR'd policy is mathematically identical, a pure
// performance win. But that's only true when both policies really do
// cover the same command scope. Only 1 of the 8 pairs does.

test("the one safe merge: marketplace_verification_applications' owner-access and service-role-access policies (both FOR ALL, same command scope) become one OR'd policy", () => {
  const sql = migrationSql();
  assert.match(sql, /drop policy if exists "marketplace applications owner access"/);
  assert.match(sql, /drop policy if exists "marketplace applications service role access"/);
  assert.match(sql, /create policy "marketplace applications owner or service role access"/);
  const start = sql.indexOf('create policy "marketplace applications owner or service role access"');
  const block = sql.slice(start, start + 400);
  assert.match(block, /for all using/);
  // Exactly the same two conditions as before, just OR'd into one
  // policy instead of living in two separate ones — never a third,
  // different condition slipped in.
  assert.match(block, /\(select auth\.uid\(\)\) = user_id/);
  assert.match(block, /\(select auth\.role\(\)\) = 'service_role'/);
  assert.match(block, /\bor\b/);
});

test("the other 7 pairs are deliberately left unmerged, and the migration explains why in enough detail that a future edit can't 'fix' them into a regression", () => {
  const sql = migrationSql();
  for (const table of [
    "marketplace_listing_images",
    "marketplace_listing_variants",
    "marketplace_listings",
    "marketplace_promotions",
    "marketplace_seller_categories",
    "marketplace_seller_profiles",
    "marketplace_wholesale_orders",
  ]) {
    assert.match(sql, new RegExp(table), `${table}'s pair should at least be named in the explanation`);
  }
  // The two concrete failure modes a naive merge would hit — both must
  // be spelled out, not just asserted "trust me".
  assert.match(sql, /privilege escalation/i);
  assert.match(sql, /regression/i);
  // No DROP/CREATE POLICY statements for any of these 7 pairs' policy
  // names — this migration only touches the one safe pair.
  for (const policy of [
    "marketplace listing images browse",
    "marketplace listing images shop access",
    "marketplace listing variants browse",
    "marketplace listing variants shop access",
    "marketplace active listings browse",
    "marketplace shop access",
    "marketplace promotions buyer read",
    "marketplace promotions shop access",
    "marketplace seller categories read",
    "marketplace seller categories shop access",
    "marketplace seller profile public read",
    "marketplace seller profile shop access",
    "marketplace wholesale orders buyer read",
    "marketplace wholesale orders seller access",
  ]) {
    assert.doesNotMatch(sql, new RegExp(`(drop|create) policy "${policy}"`), `${policy} must not be touched by this migration`);
  }
});

test("migration is registered in both canonical migration-chain lists", () => {
  const snapshot = fs.readFileSync(path.join(root, "tests/florisyn-live-schema-snapshot.test.js"), "utf8");
  const chain = fs.readFileSync(path.join(root, "tests/p0-11-canonical-migration-chain.test.js"), "utf8");
  assert.match(snapshot, /20260819260000_marketplace_multiple_permissive_policies\.sql/);
  assert.match(chain, /20260819260000_marketplace_multiple_permissive_policies\.sql/);
});
