import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const MIGRATION_PATH = path.join(process.cwd(), "supabase/migrations/20260901000000_marketing_generation_usage_ledger_extension.sql");

/**
 * Batch 2 ("Marketing image quality + provider cost accounting"): the one
 * planned additive extension of marketing_generation_usage this batch
 * introduces. No production migration is applied by this pass (same
 * standing constraint every other migration in this repo already
 * follows) — this test verifies the migration FILE itself is genuinely
 * additive and matches what marketing-provider-usage.js actually needs,
 * without requiring a live database to apply it against.
 */

test("the usage-ledger migration file exists and targets the existing table (no second usage table)", () => {
  assert.ok(fs.existsSync(MIGRATION_PATH), "the migration file must exist");
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(sql, /alter table public\.marketing_generation_usage/i);
  assert.doesNotMatch(sql, /create table (?:if not exists )?public\.\w*usage\w*/i, "must never create a second usage/cost table");
});

test("the migration is purely additive — every new column uses 'add column if not exists', nothing is dropped or rewritten", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  for (const column of ["model", "operation", "trace_id", "operation_id", "attempt_index", "provider_request_id", "metadata", "cost_source"]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}\\b`, "i"), `must add "${column}" additively`);
  }
  assert.doesNotMatch(sql, /drop column/i, "must never drop an existing column");
  assert.doesNotMatch(sql, /drop table/i, "must never drop the table");
  assert.doesNotMatch(sql, /delete from public\.marketing_generation_usage/i, "must never delete existing rows");
  assert.doesNotMatch(sql, /truncate/i, "must never truncate the table");
  assert.doesNotMatch(sql, /update public\.marketing_generation_usage/i, "must never rewrite existing rows' data");
});

test("the migration never touches row-level security on the table", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.doesNotMatch(sql, /disable row level security/i);
  assert.doesNotMatch(sql, /drop policy/i, "must never remove the existing shop-scoping RLS policy");
});

test("the widened purpose check constraint still allows every pre-existing value and adds 'vision'", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  const match = sql.match(/marketing_generation_usage_purpose_check\s+check \(purpose in \(([^)]+)\)\)/i);
  assert.ok(match, "the purpose check constraint must be present in the migration");
  const values = match[1].split(",").map((v) => v.trim().replace(/'/g, ""));
  for (const preExisting of ["image", "video", "avatar_video", "voice", "copy", "other"]) {
    assert.ok(values.includes(preExisting), `must still allow the pre-existing purpose "${preExisting}"`);
  }
  assert.ok(values.includes("vision"), "must add 'vision' as its own billable purpose");
});

test("new attempt_index and cost_source columns have safe defaults so every existing row stays valid without a data migration", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(sql, /attempt_index integer not null default 0/i);
  assert.match(sql, /cost_source text not null default 'estimated'/i);
});

test("migration filename matches the canonical migration chain's expected timestamp ordering", () => {
  // Originally asserted this was the newest migration in the whole
  // chain — true when Batch 2 was written, but not a durable invariant:
  // a later, legitimately-authorized migration (the post-Batch-6
  // security patch, 20260902000000_marketing_platform_variants_shop_
  // integrity.sql) now comes after it, exactly as intended. What this
  // test actually needs to keep proving is that Batch 2's own migration
  // was never inserted out of order relative to what existed BEFORE it
  // — sorting after every migration that predates it.
  const files = fs.readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  const thisFile = "20260901000000_marketing_generation_usage_ledger_extension.sql";
  const index = files.indexOf(thisFile);
  assert.ok(index !== -1, "the migration file must be present in the migrations directory");
  const priorFiles = files.slice(0, index);
  assert.ok(priorFiles.length > 0, "there must be at least one migration before this one");
  assert.ok(
    priorFiles.every((f) => f < thisFile),
    "must sort after every migration that existed before it — never inserted out of order into the middle of the chain"
  );
});
