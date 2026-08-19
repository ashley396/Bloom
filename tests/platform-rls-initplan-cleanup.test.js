import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function migrationSql() {
  return fs.readFileSync(
    path.join(root, "supabase/migrations/20260819290000_platform_rls_initplan_cleanup.sql"),
    "utf8"
  );
}

function stripComments(sql) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

// Platform-wide auth_rls_initplan cleanup — same pure query-plan
// optimization as the marketplace-scoped pass (PR #123), extended to the
// 29 findings the advisor flagged across 15 core tables. No policy's
// actual authorization logic should change: every auth.<fn>() call gets
// wrapped in (select ...), and nothing else.

const TOUCHED_POLICIES = [
  ["shops", "shops active member select"],
  ["shop_members", "members self or owner select"],
  ["profiles", "profiles own select"],
  ["profiles", "profiles own update"],
  ["florist_community_profiles", "community profiles insert own"],
  ["florist_community_profiles", "community profiles update own"],
  ["florist_community_posts", "community posts select"],
  ["florist_community_posts", "community posts insert"],
  ["florist_community_posts", "community posts update author content"],
  ["florist_community_posts", "community posts delete"],
  ["florist_community_comments", "community comments select"],
  ["florist_community_comments", "community comments insert"],
  ["florist_community_comments", "community comments update author content"],
  ["florist_community_comments", "community comments delete"],
  ["florist_community_likes", "community likes select"],
  ["florist_community_likes", "community likes insert"],
  ["florist_community_likes", "community likes delete"],
  ["florist_community_reports", "community reports insert"],
  ["florist_community_reports", "community reports select own or admin"],
  ["florist_community_recipes", "community recipes insert own"],
  ["florist_community_recipes", "community recipes update own"],
  ["florist_community_follows", "community follows insert"],
  ["florist_community_follows", "community follows delete"],
  ["florist_community_notifications", "community notifications select own"],
  ["florist_community_notifications", "community notifications mark read"],
  ["lily_conversations", "lily conversations owner"],
  ["lily_messages", "lily messages owner"],
  ["lily_action_audit", "lily action audit owner read"],
  ["bloom_library_duplicate_reviews", "duplicate reviews admin"],
];

// Tables in this same family that have OTHER policies the advisor did
// NOT flag (no direct auth.<fn>() call in their qual/with_check — they
// route entirely through this codebase's own is_*()/user_*() helper
// functions instead) — these must be left completely untouched.
const POLICIES_NOT_TOUCHED = [
  ["florist_community_follows", "community follows select"],
  ["florist_community_profiles", "community profiles select active florist"],
  ["florist_community_recipes", "community recipes read active"],
  ["shop_members", "members owner delete"],
  ["shop_members", "members owner insert"],
  ["shop_members", "members owner update"],
  ["shops", "shops active manager update"],
];

test("touches exactly the 29 flagged policies — one drop+create pair each, nothing more, nothing less", () => {
  const sql = migrationSql();
  const drops = sql.match(/drop policy if exists "[^"]+" on public\.\w+;/g) || [];
  const creates = sql.match(/create policy "[^"]+" on public\.\w+/g) || [];
  assert.equal(drops.length, TOUCHED_POLICIES.length);
  assert.equal(creates.length, TOUCHED_POLICIES.length);
  for (const [table, policy] of TOUCHED_POLICIES) {
    assert.match(sql, new RegExp(`drop policy if exists "${policy}" on public\\.${table};`), `${table}.${policy} must be dropped`);
    assert.match(sql, new RegExp(`create policy "${policy}" on public\\.${table}`), `${table}.${policy} must be recreated`);
  }
});

test("every direct auth.uid()/auth.role() call in a recreated policy is wrapped in (select ...)", () => {
  const sql = stripComments(migrationSql());
  // Only inspect the bodies of the CREATE POLICY statements themselves.
  const createBlocks = sql.match(/create policy "[^"]+"[\s\S]*?;/g) || [];
  assert.ok(createBlocks.length >= TOUCHED_POLICIES.length);
  for (const block of createBlocks) {
    assert.doesNotMatch(
      block,
      /(?<!\(select )auth\.(uid|role)\(\)/,
      `found an unwrapped auth.<fn>() call: ${block.slice(0, 120)}...`
    );
  }
});

test("explicitly preserves original role scope — 'to authenticated' kept where the table's policy really was authenticated-only, omitted only where the original was already public", () => {
  const sql = migrationSql();
  const authenticatedOnly = [
    "shops active member select",
    "members self or owner select",
    "profiles own select",
    "profiles own update",
    "community profiles insert own",
    "community profiles update own",
    "community posts select",
    "community posts insert",
    "community posts update author content",
    "community posts delete",
    "community comments select",
    "community comments insert",
    "community comments update author content",
    "community comments delete",
    "community likes select",
    "community likes insert",
    "community likes delete",
    "community reports insert",
    "community reports select own or admin",
    "community recipes insert own",
    "community recipes update own",
  ];
  const publicScoped = [
    "community follows insert",
    "community follows delete",
    "community notifications select own",
    "community notifications mark read",
    "lily conversations owner",
    "lily messages owner",
    "lily action audit owner read",
    "duplicate reviews admin",
  ];
  for (const policy of authenticatedOnly) {
    const start = sql.indexOf(`create policy "${policy}"`);
    assert.ok(start !== -1, `${policy} should exist`);
    const statement = sql.slice(start, sql.indexOf(";", start));
    assert.match(statement, /to authenticated/, `${policy} must explicitly keep its authenticated-only scope`);
  }
  for (const policy of publicScoped) {
    const start = sql.indexOf(`create policy "${policy}"`);
    assert.ok(start !== -1, `${policy} should exist`);
    const statement = sql.slice(start, sql.indexOf(";", start));
    assert.doesNotMatch(statement, /to authenticated/, `${policy} was already public-scoped and must stay that way, not narrow to authenticated`);
  }
});

test("never touches a policy the advisor didn't flag", () => {
  const sql = migrationSql();
  for (const [table, policy] of POLICIES_NOT_TOUCHED) {
    assert.doesNotMatch(sql, new RegExp(`(drop|create) policy "${policy}" on public\\.${table}`), `${table}.${policy} was not flagged and must not be touched`);
  }
});

test("migration is registered in both canonical migration-chain lists", () => {
  const snapshot = fs.readFileSync(path.join(root, "tests/florisyn-live-schema-snapshot.test.js"), "utf8");
  const chain = fs.readFileSync(path.join(root, "tests/p0-11-canonical-migration-chain.test.js"), "utf8");
  assert.match(snapshot, /20260819290000_platform_rls_initplan_cleanup\.sql/);
  assert.match(chain, /20260819290000_platform_rls_initplan_cleanup\.sql/);
});
