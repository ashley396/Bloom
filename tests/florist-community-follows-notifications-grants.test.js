import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function migrationSql() {
  return fs.readFileSync(
    path.join(root, "supabase/migrations/20260819320000_florist_community_follows_notifications_grants.sql"),
    "utf8"
  );
}

// 20260819160000 created florist_community_follows and
// florist_community_notifications with RLS enabled and real policies, but
// never granted the underlying table privileges to authenticated or
// service_role. RLS never substitutes for the base GRANT — without it,
// every query throws "permission denied for table ...", which
// florist-community.js's missingRelation() does not recognize (it only
// catches 42P01/"does not exist"), so the error propagated all the way up
// to a 500 on every Community feed load, because loadFollowingSet() runs
// unconditionally on GET ?action=feed. This surfaced live as "Unexpected
// Florisyn error. Try again or contact support." for every florist.

test("grants authenticated exactly the privileges its RLS policies allow on follows", () => {
  const sql = migrationSql();
  assert.match(sql, /grant select, insert, delete on table public\.florist_community_follows to authenticated/);
  // No update policy exists on this table, so no update grant either.
  assert.doesNotMatch(sql, /grant[^;]*update[^;]*florist_community_follows to authenticated/i);
});

test("grants authenticated exactly the privileges its RLS policies allow on notifications", () => {
  const sql = migrationSql();
  assert.match(sql, /grant select, update on table public\.florist_community_notifications to authenticated/);
  // No insert policy exists — notifications are only ever written
  // server-side via the service-role client.
  assert.doesNotMatch(sql, /grant[^;]*insert[^;]*florist_community_notifications to authenticated/i);
});

test("grants service_role full access to both tables for server-side writes", () => {
  const sql = migrationSql();
  assert.match(sql, /grant all on table public\.florist_community_follows to service_role/);
  assert.match(sql, /grant all on table public\.florist_community_notifications to service_role/);
});

test("migration is registered in both canonical migration-chain lists", () => {
  const snapshot = fs.readFileSync(path.join(root, "tests/florisyn-live-schema-snapshot.test.js"), "utf8");
  const chain = fs.readFileSync(path.join(root, "tests/p0-11-canonical-migration-chain.test.js"), "utf8");
  assert.match(snapshot, /20260819320000_florist_community_follows_notifications_grants\.sql/);
  assert.match(chain, /20260819320000_florist_community_follows_notifications_grants\.sql/);
});
