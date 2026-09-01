#!/usr/bin/env node
/**
 * Apply the Marketing Studio schema + RLS to local Postgres for RLS
 * tests (Batch 6, Part I).
 *
 * Usage:
 *   node scripts/apply-marketing-rls-local.mjs
 *   npm run test:marketing-rls
 *
 * Applies, in order:
 *   1. tests/fixtures/marketing-rls-bootstrap.sql — roles, auth.uid(),
 *      shops/shop_members (current, post-R1 shape) + is_shop_member(),
 *      and two minimal stub tables (marketing_campaigns, website_media)
 *      Marketing's own real migrations reference by foreign key.
 *   2. supabase/migrations/20260820020000_ai_operating_system_v1.sql —
 *      the REAL production migration file, applied verbatim (creates
 *      ai_execution_jobs + ai_generated_assets and their RLS).
 *   3. supabase/migrations/20260823000000_marketing_studio_foundation_v1.sql
 *      — the REAL production migration file, applied verbatim (creates
 *      marketing_content_items, marketing_platform_variants,
 *      marketing_generation_usage, and the rest of the Marketing Studio
 *      foundation, all with their real RLS).
 *   4. supabase/migrations/20260901000000_marketing_generation_usage_ledger_extension.sql
 *      — the REAL Batch 2 migration, applied verbatim (Part R: "The
 *      existing Batch 2 migration must be included in... disposable
 *      Postgres tests").
 *
 * Never applied to production by this script's existence — same
 * governing constraint as every other local-apply script in this repo.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const url =
  process.env.MARKETING_TEST_DATABASE_URL ||
  process.env.COMMUNITY_TEST_DATABASE_URL ||
  "postgres://florisyn_test:florisyn_test@127.0.0.1:5432/florisyn_community_test";

const root = process.cwd();

const bootstrap = "tests/fixtures/marketing-rls-bootstrap.sql";
const realMigrations = [
  "supabase/migrations/20260820020000_ai_operating_system_v1.sql",
  "supabase/migrations/20260823000000_marketing_studio_foundation_v1.sql",
  "supabase/migrations/20260901000000_marketing_generation_usage_ledger_extension.sql"
];

async function applyFile(client, rel) {
  const sql = fs.readFileSync(path.join(root, rel), "utf8");
  process.stdout.write(`Applying ${rel}... `);
  await client.query(sql);
  console.log("ok");
}

async function resetSchemas(client) {
  await client.query(`
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    drop schema if exists storage cascade;
    create schema public;
    grant all on schema public to public;
  `);
}

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await resetSchemas(client);
    await applyFile(client, bootstrap);
    for (const migration of realMigrations) {
      await applyFile(client, migration);
    }
    console.log("Marketing Studio RLS schema applied successfully (real migration files, verbatim).");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exitCode = 1;
});
