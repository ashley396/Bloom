import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function migrationSql() {
  return fs.readFileSync(
    path.join(root, "supabase/migrations/20260819280000_drop_duplicate_shop_indexes.sql"),
    "utf8"
  );
}

// Supabase's "duplicate_index" advisor flagged two tables with two
// byte-identical btree(shop_id) indexes each — a stronger safety
// guarantee than "unused_index" findings, since it isn't a
// traffic-dependent judgment call: the planner can never prefer one
// over an index with the exact same definition.

test("drops exactly the two untracked duplicate indexes, and nothing else", () => {
  const sql = migrationSql();
  const dropStatements = sql.match(/drop index[^;]+;/gi) || [];
  assert.equal(dropStatements.length, 2, "this migration should touch exactly two indexes");
  assert.match(sql, /drop index if exists public\.deliveries_shop_id_idx/);
  assert.match(sql, /drop index if exists public\.products_shop_id_idx/);
});

test("never drops the baseline-tracked twin of either pair", () => {
  const sql = migrationSql();
  assert.doesNotMatch(sql, /drop index[^;]*deliveries_shop_idx\b/i, "must keep the baseline-created deliveries_shop_idx");
  assert.doesNotMatch(sql, /drop index[^;]*products_shop_idx\b/i, "must keep the baseline-created products_shop_idx");
});

test("the kept index name in each pair is the one the greenfield baseline actually creates", () => {
  const baseline = fs.readFileSync(
    path.join(root, "supabase/migrations/20260804000000_greenfield_baseline.sql"),
    "utf8"
  );
  assert.match(baseline, /create index if not exists products_shop_idx on public\.products\(shop_id\)/);
  assert.match(baseline, /create index if not exists deliveries_shop_idx on public\.deliveries\(shop_id\)/);
});

test("migration is registered in both canonical migration-chain lists", () => {
  const snapshot = fs.readFileSync(path.join(root, "tests/florisyn-live-schema-snapshot.test.js"), "utf8");
  const chain = fs.readFileSync(path.join(root, "tests/p0-11-canonical-migration-chain.test.js"), "utf8");
  assert.match(snapshot, /20260819280000_drop_duplicate_shop_indexes\.sql/);
  assert.match(chain, /20260819280000_drop_duplicate_shop_indexes\.sql/);
});
