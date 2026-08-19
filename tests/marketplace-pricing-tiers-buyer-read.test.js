import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function migrationSql() {
  return fs.readFileSync(
    path.join(root, "supabase/migrations/20260819310000_marketplace_pricing_tiers_buyer_read.sql"),
    "utf8"
  );
}

// marketplace_pricing_tiers has existed since the greenfield baseline with
// real seller-created rows, but its only RLS policy was shop-membership
// scoped — a buyer checking out from a different shop could never read
// the seller's own tiers. This migration adds the buyer-read policy the
// checkout tier lookup (marketplace-checkout.js) depends on.

test("adds a buyer-read policy scoped to active tiers only", () => {
  const sql = migrationSql();
  assert.match(sql, /create policy "marketplace pricing tiers buyer read" on public\.marketplace_pricing_tiers/);
  assert.match(sql, /for select to authenticated/);
  assert.match(sql, /using \(active = true\)/);
});

test("never touches the existing shop-access policy", () => {
  const sql = migrationSql();
  assert.doesNotMatch(sql, /(drop|create) policy "marketplace pricing tiers shop access"/);
});

test("migration is registered in both canonical migration-chain lists", () => {
  const snapshot = fs.readFileSync(path.join(root, "tests/florisyn-live-schema-snapshot.test.js"), "utf8");
  const chain = fs.readFileSync(path.join(root, "tests/p0-11-canonical-migration-chain.test.js"), "utf8");
  assert.match(snapshot, /20260819310000_marketplace_pricing_tiers_buyer_read\.sql/);
  assert.match(chain, /20260819310000_marketplace_pricing_tiers_buyer_read\.sql/);
});
