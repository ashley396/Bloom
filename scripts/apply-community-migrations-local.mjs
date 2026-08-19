#!/usr/bin/env node
/**
 * Apply Community migrations to local Postgres for RLS tests.
 *
 * Usage:
 *   node scripts/apply-community-migrations-local.mjs
 *   COMMUNITY_APPLY_MODE=v1-alone node scripts/apply-community-migrations-local.mjs
 *   COMMUNITY_APPLY_MODE=r1-again node scripts/apply-community-migrations-local.mjs
 *
 * Modes:
 *   reset (default) — drop schemas, bootstrap, apply v1 + R1/R2
 *   v1-alone — drop schemas, bootstrap, apply only v1 (locked state)
 *   r1-again — apply R1/R2 only onto existing DB (no schema reset)
 *   no-reset — apply bootstrap + v1 + R1 without dropping schemas
 *
 * On failure the script exits non-zero and does not continue to later files.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const url =
  process.env.COMMUNITY_TEST_DATABASE_URL ||
  "postgres://florisyn_test:florisyn_test@127.0.0.1:5432/florisyn_community_test";

const mode = String(process.env.COMMUNITY_APPLY_MODE || "reset").toLowerCase();
const root = process.cwd();

const bootstrap = "tests/fixtures/community-rls-bootstrap.sql";
const v1 = "supabase/legacy_migrations/20260731_florist_community_beta_v1.sql";
const r1 = "supabase/legacy_migrations/20260731_florist_community_beta_v1_r1_security.sql";

function cleanSql(sql) {
  return sql.replace(/notify pgrst,\s*'reload schema';/gi, "-- notify omitted in local apply");
}

async function applyFile(client, rel) {
  const sql = fs.readFileSync(path.join(root, rel), "utf8");
  process.stdout.write(`Applying ${rel}... `);
  await client.query(cleanSql(sql));
  console.log("ok");
}

async function resetSchemas(client) {
  await client.query(`
    drop schema if exists florisyn_internal cascade;
    drop schema if exists storage cascade;
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    create schema public;
    create schema auth;
    create schema storage;
    grant all on schema public to public;
  `);
}

async function grantBaseline(client, { unlockCommunity }) {
  await client.query(`
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    grant select, insert, update, delete on table public.shops to authenticated, service_role;
    grant select, insert, update, delete on table public.shop_members to authenticated, service_role;
    grant select on table public.platform_admins to authenticated;
    grant select, insert, update, delete on table public.platform_admins to service_role;
    grant select, insert on table public.platform_admin_audit to service_role;
    grant select, insert, update, delete on all tables in schema storage to authenticated, service_role;
    revoke all on all tables in schema storage from anon;
    grant usage, select on all sequences in schema public to authenticated, service_role;
  `);

  // Always revoke anon Community access.
  await client.query(`
    revoke all on table public.florist_community_profiles from anon;
    revoke all on table public.florist_community_posts from anon;
    revoke all on table public.florist_community_comments from anon;
    revoke all on table public.florist_community_likes from anon;
    revoke all on table public.florist_community_reports from anon;
  `);

  if (unlockCommunity) {
    await client.query(`
      grant usage on schema florisyn_internal to service_role;
      grant select, insert, update on table public.florist_community_profiles to authenticated;
      grant select, insert, update, delete on table public.florist_community_posts to authenticated;
      grant select, insert, update, delete on table public.florist_community_comments to authenticated;
      grant select, insert, delete on table public.florist_community_likes to authenticated;
      grant select, insert on table public.florist_community_reports to authenticated;
      grant all on table public.florist_community_profiles to service_role;
      grant all on table public.florist_community_posts to service_role;
      grant all on table public.florist_community_comments to service_role;
      grant all on table public.florist_community_likes to service_role;
      grant all on table public.florist_community_reports to service_role;
    `);
  } else {
    // v1-alone: tables exist under RLS with no policies — do not grant authenticated DML
    // beyond what ownership already implies; revoke authenticated table privileges explicitly.
    await client.query(`
      revoke all on table public.florist_community_profiles from authenticated;
      revoke all on table public.florist_community_posts from authenticated;
      revoke all on table public.florist_community_comments from authenticated;
      revoke all on table public.florist_community_likes from authenticated;
      revoke all on table public.florist_community_reports from authenticated;
      grant all on table public.florist_community_profiles to service_role;
      grant all on table public.florist_community_posts to service_role;
      grant all on table public.florist_community_comments to service_role;
      grant all on table public.florist_community_likes to service_role;
      grant all on table public.florist_community_reports to service_role;
    `);
  }
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  if (mode === "r1-again") {
    await applyFile(client, r1);
    await grantBaseline(client, { unlockCommunity: true });
    console.log("R1 re-applied successfully (no schema reset).");
  } else if (mode === "v1-alone") {
    await resetSchemas(client);
    await applyFile(client, bootstrap);
    await applyFile(client, v1);
    await grantBaseline(client, { unlockCommunity: false });
    console.log("Community v1-alone locked state applied successfully.");
  } else {
    if (mode === "reset" || mode === "fresh") {
      await resetSchemas(client);
    }
    for (const rel of [bootstrap, v1, r1]) {
      await applyFile(client, rel);
    }
    await grantBaseline(client, { unlockCommunity: true });
    console.log(`Community migrations applied successfully (mode=${mode}).`);
  }
} catch (error) {
  console.error("Community migration apply FAILED — stopping without continuing.");
  console.error(error.message || error);
  process.exitCode = 1;
} finally {
  await client.end();
}
