import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function migrationSql() {
  return fs.readFileSync(
    path.join(root, "supabase/migrations/20260819250000_marketplace_rls_performance_cleanup.sql"),
    "utf8"
  );
}

// Supabase's advisors flagged 12 marketplace RLS policies that
// re-evaluate auth.uid()/auth.role() once per row instead of once per
// statement (auth_rls_initplan) and 17 unindexed foreign keys. This
// migration is meant to be a pure query-plan optimization for all of
// that — same authorization outcome, cheaper to evaluate — with exactly
// one deliberate exception (the seller-reviews-buyer-insert logic bug),
// called out on its own below.

test("every rewritten policy wraps auth.uid()/auth.role() in a scalar subselect, never a bare call", () => {
  // Strip SQL line-comments first — the migration's own prose explains
  // auth.uid()/auth.role() by name, which would otherwise false-positive
  // as a "bare call" in the actual executable SQL.
  const sqlOnly = migrationSql()
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  // A bare, unwrapped auth.uid()/auth.role() anywhere in real SQL would
  // mean a policy was missed or reverted to the slow form.
  assert.doesNotMatch(sqlOnly, /(?<!\(select )auth\.uid\(\)/, "found a bare auth.uid() not wrapped in (select ...)");
  assert.doesNotMatch(sqlOnly, /(?<!\(select )auth\.role\(\)/, "found a bare auth.role() not wrapped in (select ...)");
  assert.match(sqlOnly, /\(select auth\.uid\(\)\)/);
  assert.match(sqlOnly, /\(select auth\.role\(\)\)/);
});

test("all 12 flagged policies are present and dropped-and-recreated by name, not silently skipped", () => {
  const sql = migrationSql();
  for (const policy of [
    "marketplace applications owner access",
    "marketplace applications service role access",
    "marketplace verification tax secrets service role",
    "marketplace verification audit service role",
    "marketplace verification email service role",
    "marketplace favorites owner access",
    "marketplace wholesale orders buyer read",
    "marketplace notifications select own",
    "marketplace notifications mark read",
    "marketplace seller reviews public read",
    "marketplace seller reviews buyer insert",
    "marketplace standing orders buyer access",
  ]) {
    assert.match(sql, new RegExp(`drop policy if exists "${policy}"`), `missing drop for: ${policy}`);
    assert.match(sql, new RegExp(`create policy "${policy}"`), `missing create for: ${policy}`);
  }
});

test("the perf-only policies keep their exact original predicate shape — only the auth.<fn>() wrapping changed", () => {
  const sql = migrationSql();
  // Spot-check a representative sample against their known original
  // qual/with_check text (minus the (select ...) wrapping) so a future
  // edit can't quietly change what these policies actually allow while
  // claiming to be "just" a performance pass.
  assert.match(sql, /for all using \(\(select auth\.uid\(\)\) = user_id\) with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(sql, /for select using \(buyer_user_id = \(select auth\.uid\(\)\)\)/);
  assert.match(sql, /for update using \(recipient_user_id = \(select auth\.uid\(\)\)\) with check \(recipient_user_id = \(select auth\.uid\(\)\)\)/);
  assert.match(sql, /for all using \(buyer_user_id = \(select auth\.uid\(\)\)\) with check \(buyer_user_id = \(select auth\.uid\(\)\)\)/);
});

test("the seller-reviews-buyer-insert fix closes the real shadowing bug: seller_shop_id is now fully qualified against the review row, not the correlated order subquery", () => {
  const sql = migrationSql();
  const start = sql.indexOf('create policy "marketplace seller reviews buyer insert"');
  const block = sql.slice(start, start + 700);
  // The old, broken text compared the order's own column to itself.
  assert.doesNotMatch(block, /o\.seller_shop_id\s*=\s*seller_shop_id/, "must not reintroduce the unqualified reference that shadowed into a tautology");
  assert.match(block, /o\.seller_shop_id\s*=\s*marketplace_seller_reviews\.seller_shop_id/);
  // The rest of the real authorization logic must survive unchanged.
  assert.match(block, /buyer_user_id = \(select auth\.uid\(\)\)/);
  assert.match(block, /o\.buyer_user_id = \(select auth\.uid\(\)\)/);
  assert.match(block, /o\.status in \('paid', 'fulfilled', 'completed'\)/);
});

test("every one of the 17 advisor-flagged foreign keys gets a real, purely additive covering index", () => {
  const sql = migrationSql();
  const expected = [
    ["marketplace_favorites", "listing_id"],
    ["marketplace_listing_images", "shop_id"],
    ["marketplace_notifications", "listing_id"],
    ["marketplace_notifications", "order_id"],
    ["marketplace_seller_categories", "category_slug"],
    ["marketplace_seller_reviews", "buyer_shop_id"],
    ["marketplace_seller_reviews", "buyer_user_id"],
    ["marketplace_standing_orders", "buyer_shop_id"],
    ["marketplace_standing_orders", "seller_shop_id"],
    ["marketplace_verification_audit_events", "actor_user_id"],
    ["marketplace_verification_email_outbox", "application_id"],
    ["marketplace_verification_email_outbox", "user_id"],
    ["marketplace_verification_tax_secrets", "user_id"],
    ["marketplace_wholesale_orders", "buyer_shop_id"],
    ["marketplace_wholesale_orders", "customer_id"],
    ["marketplace_wholesale_orders", "listing_id"],
    ["marketplace_wholesale_orders", "shipping_profile_id"],
  ];
  for (const [table, column] of expected) {
    assert.match(
      sql,
      new RegExp(`create index if not exists \\S+ on public\\.${table} \\(${column}\\)`),
      `missing covering index for ${table}.${column}`
    );
  }
  assert.doesNotMatch(sql, /drop index/i, "this pass only adds indexes, never drops one");
  assert.doesNotMatch(sql, /drop table|truncate|delete from/i, "purely additive/definitional — no data-touching statements");
});

test("migration is registered in both canonical migration-chain lists", () => {
  const snapshot = fs.readFileSync(path.join(root, "tests/florisyn-live-schema-snapshot.test.js"), "utf8");
  const chain = fs.readFileSync(path.join(root, "tests/p0-11-canonical-migration-chain.test.js"), "utf8");
  assert.match(snapshot, /20260819250000_marketplace_rls_performance_cleanup\.sql/);
  assert.match(chain, /20260819250000_marketplace_rls_performance_cleanup\.sql/);
});
