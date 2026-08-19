import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function migrationSql() {
  return fs.readFileSync(
    path.join(root, "supabase/migrations/20260819270000_marketplace_drop_redundant_index.sql"),
    "utf8"
  );
}

// Of Supabase's 27 "unused_index" advisor findings, this is the one that
// is genuinely, provably redundant regardless of traffic — a plain index
// on the exact same single column a UNIQUE constraint already indexes.
// The other 26 are either brand-new (added in the immediately prior
// migration for real FK-coverage reasons) or pre-existing indexes whose
// "unused" status is an artifact of a low-traffic staging DB, not
// evidence of genuine redundancy — dropping those is a traffic-dependent
// judgment call, not a safe blanket fix, and is deliberately left alone.

test("drops only the one provably-redundant plain index, and nothing else", () => {
  const sql = migrationSql();
  const dropStatements = sql.match(/drop index[^;]+;/gi) || [];
  assert.equal(dropStatements.length, 1, "this migration should touch exactly one index");
  assert.match(sql, /drop index if exists public\.marketplace_verification_applications_user_id_idx/);
});

test("never drops the unique constraint's own backing index", () => {
  const sql = migrationSql();
  assert.doesNotMatch(sql, /drop index[^;]*marketplace_verification_applications_user_id_key/i, "must never touch the real unique-constraint index — only the redundant plain duplicate of it");
});

test("no other marketplace index is touched — the other 26 unused_index findings are deliberately left alone", () => {
  const sql = migrationSql();
  const dropCount = (sql.match(/drop index/gi) || []).length;
  assert.equal(dropCount, 1);
});

test("migration is registered in both canonical migration-chain lists", () => {
  const snapshot = fs.readFileSync(path.join(root, "tests/florisyn-live-schema-snapshot.test.js"), "utf8");
  const chain = fs.readFileSync(path.join(root, "tests/p0-11-canonical-migration-chain.test.js"), "utf8");
  assert.match(snapshot, /20260819270000_marketplace_drop_redundant_index\.sql/);
  assert.match(chain, /20260819270000_marketplace_drop_redundant_index\.sql/);
});
