#!/usr/bin/env node
/**
 * Apply Community v1 + R1 migrations to local Postgres for RLS tests.
 *
 * Usage:
 *   node scripts/apply-community-migrations-local.mjs
 *   COMMUNITY_APPLY_MODE=r1-again node scripts/apply-community-migrations-local.mjs
 *
 * Modes:
 *   reset (default) — drop schemas, bootstrap, apply v1 + R1
 *   r1-again — apply R1 only onto existing DB (no schema reset; idempotency check)
 *   no-reset — apply bootstrap (if needed) + v1 + R1 without dropping schemas
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
const v1 = "supabase/migrations/20260731_florist_community_beta_v1.sql";
const r1 = "supabase/migrations/20260731_florist_community_beta_v1_r1_security.sql";

function cleanSql(sql) {
  return sql.replace(/notify pgrst,\s*'reload schema';/gi, "-- notify omitted in local apply");
}

async function applyFile(client, rel) {
  const sql = fs.readFileSync(path.join(root, rel), "utf8");
  process.stdout.write(`Applying ${rel}... `);
  await client.query(cleanSql(sql));
  console.log("ok");
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  if (mode === "r1-again") {
    await applyFile(client, r1);
    console.log("R1 re-applied successfully (no schema reset).");
  } else {
    if (mode === "reset" || mode === "fresh") {
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

    for (const rel of [bootstrap, v1, r1]) {
      await applyFile(client, rel);
    }

    // Production-shaped grants only — do NOT grant Community tables to anon.
    await client.query(`
      grant usage on schema public, auth, storage to anon, authenticated, service_role;
      grant usage on schema florisyn_internal to service_role;

      revoke all on table public.florist_community_profiles from anon;
      revoke all on table public.florist_community_posts from anon;
      revoke all on table public.florist_community_comments from anon;
      revoke all on table public.florist_community_likes from anon;
      revoke all on table public.florist_community_reports from anon;

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

      grant select, insert, update, delete on table public.shops to authenticated, service_role;
      grant select, insert, update, delete on table public.shop_members to authenticated, service_role;
      -- SELECT grant + RLS with zero policies => zero rows for user JWT (production pattern).
      grant select on table public.platform_admins to authenticated;
      grant select, insert, update, delete on table public.platform_admins to service_role;
      grant select, insert on table public.platform_admin_audit to service_role;

      grant select, insert, update, delete on all tables in schema storage to authenticated, service_role;
      revoke all on all tables in schema storage from anon;

      grant usage, select on all sequences in schema public to authenticated, service_role;
    `);

    console.log(`Community migrations applied successfully (mode=${mode}).`);
  }
} finally {
  await client.end();
}
