#!/usr/bin/env node
/**
 * One-off local verification for supabase/migrations/20260829000000_marketing_content_revision.sql
 * (the ai_generated_assets.asset_type CHECK constraint fix). Runs the REAL,
 * verbatim DDL statements extracted from the real migration files — in the
 * real order — against a scratch local Postgres database. Minimal stub
 * tables are created only to satisfy foreign keys ai_generated_assets
 * itself declares (shops/auth.users/ai_execution_jobs/marketing_campaigns/
 * website_media) — same pattern scripts/apply-community-migrations-local.mjs
 * already uses for its own local RLS testing. Never run against production;
 * connects to a local scratch database only.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const root = process.cwd();
const url = process.env.VERIFY_DATABASE_URL || "postgres://florisyn_test:florisyn_test@127.0.0.1:5432/florisyn_community_test";

function extractCreateTable(file, tableName) {
  const sql = fs.readFileSync(path.join(root, file), "utf8");
  const startMarker = `create table if not exists public.${tableName} (`;
  const start = sql.indexOf(startMarker);
  if (start === -1) throw new Error(`CREATE TABLE for ${tableName} not found in ${file}`);
  // Find the matching closing ");" for this statement by counting parens.
  let depth = 0;
  let i = start + startMarker.length - 1; // at the opening '('
  for (; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  const end = sql.indexOf(";", i) + 1;
  return sql.slice(start, end);
}

function extractAssetTypeConstraintBlock(file) {
  const sql = fs.readFileSync(path.join(root, file), "utf8");
  const marker = "ai_generated_assets_asset_type_check";
  const firstIdx = sql.indexOf(marker);
  if (firstIdx === -1) return null; // this file doesn't touch the constraint
  // The real files always emit: drop constraint if exists ...; \n\n alter
  // table ... add constraint ... check (...); — capture from the "drop
  // constraint" line through the closing ");" of the "add constraint" call.
  const dropStart = sql.lastIndexOf("alter table public.ai_generated_assets", firstIdx);
  const addConstraintIdx = sql.indexOf("add constraint ai_generated_assets_asset_type_check", firstIdx);
  const checkParenStart = sql.indexOf("(", sql.indexOf("check (", addConstraintIdx));
  let depth = 0;
  let i = checkParenStart;
  for (; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  const end = sql.indexOf(";", i) + 1;
  return sql.slice(dropStart, end);
}

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    console.log("Resetting scratch schema...");
    await client.query(`
      drop schema if exists public cascade;
      drop schema if exists auth cascade;
      create schema public;
      create schema auth;
      create extension if not exists pgcrypto;
    `);

    console.log("Creating minimal FK-target stubs (shops, auth.users, ai_execution_jobs, marketing_campaigns, website_media)...");
    await client.query(`
      create table auth.users (id uuid primary key default gen_random_uuid());
      create table public.shops (id uuid primary key default gen_random_uuid());
      create table public.ai_execution_jobs (id uuid primary key default gen_random_uuid());
      create table public.marketing_campaigns (id uuid primary key default gen_random_uuid());
      create table public.website_media (id uuid primary key default gen_random_uuid());
    `);

    console.log("Applying the REAL ai_generated_assets CREATE TABLE from 20260820020000_ai_operating_system_v1.sql...");
    const createTableSql = extractCreateTable("supabase/migrations/20260820020000_ai_operating_system_v1.sql", "ai_generated_assets");
    await client.query(createTableSql);

    const chain = [
      "supabase/migrations/20260822000000_lily_visual_creation_studio.sql",
      "supabase/migrations/20260824000000_creative_ai_webhook_disclosure_media.sql",
      "supabase/migrations/20260825000000_personal_brand_studio.sql",
      "supabase/migrations/20260829000000_marketing_content_revision.sql"
    ];
    const seenAssetTypes = [];
    for (const file of chain) {
      const block = extractAssetTypeConstraintBlock(file);
      if (!block) {
        console.log(`(${file} does not touch the asset_type constraint — skipping, matches static audit)`);
        continue;
      }
      console.log(`Applying REAL constraint block from ${path.basename(file)}...`);
      await client.query(block);
      const m = block.match(/asset_type in \(([\s\S]*?)\)/);
      const values = m ? m[1].match(/'[a-z_]+'/g).map((s) => s.slice(1, -1)) : [];
      seenAssetTypes.push({ file: path.basename(file), values });
    }

    console.log("\n=== Constraint evolution actually executed (real DDL, real Postgres) ===");
    for (const step of seenAssetTypes) console.log(`${step.file}: [${step.values.join(", ")}]`);

    await client.query(`insert into public.shops default values`);

    console.log("\n=== TEST 1: every value from the PRE-existing (20260825000000) constraint still inserts successfully ===");
    const priorValues = seenAssetTypes.find((s) => s.file.startsWith("20260825000000")).values;
    for (const v of priorValues) {
      await client.query(
        `insert into public.ai_generated_assets (shop_id, asset_type, model) values ((select id from public.shops limit 1), $1, 'test-model')`,
        [v]
      );
      console.log(`  OK  asset_type='${v}' accepted (pre-existing value)`);
    }

    console.log("\n=== TEST 2: the NEW value 'social_copy' is now accepted ===");
    await client.query(`insert into public.shops default values`);
    await client.query(
      `insert into public.ai_generated_assets (shop_id, asset_type, model) values ((select id from public.shops order by id desc limit 1), 'social_copy', 'test-model')`
    );
    console.log("  OK  asset_type='social_copy' accepted");

    console.log("\n=== TEST 3: an obviously invalid asset_type is still rejected ===");
    try {
      await client.query(
        `insert into public.ai_generated_assets (shop_id, asset_type, model) values ((select id from public.shops limit 1), 'totally_bogus_type', 'test-model')`
      );
      console.log("  FAIL — an invalid asset_type was accepted! Constraint is broken.");
      process.exitCode = 1;
    } catch (error) {
      if (/check constraint.*asset_type/i.test(error.message) || /violates check constraint/i.test(error.message)) {
        console.log(`  OK  rejected as expected: ${error.message}`);
      } else {
        throw error;
      }
    }

    const finalCount = await client.query(`select count(*)::int as n from public.ai_generated_assets`);
    console.log(`\nTotal rows in scratch table after all tests: ${finalCount.rows[0].n} (${priorValues.length} pre-existing values + 1 social_copy row)`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
