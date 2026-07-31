#!/usr/bin/env node
/**
 * Apply Community v1 + R1 migrations to local Postgres for RLS tests.
 * Usage:
 *   COMMUNITY_TEST_DATABASE_URL=postgres://florisyn_test:florisyn_test@127.0.0.1:5432/florisyn_community_test \
 *     node scripts/apply-community-migrations-local.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const url =
  process.env.COMMUNITY_TEST_DATABASE_URL ||
  "postgres://florisyn_test:florisyn_test@127.0.0.1:5432/florisyn_community_test";

const root = process.cwd();
const files = [
  "tests/fixtures/community-rls-bootstrap.sql",
  "supabase/migrations/20260731_florist_community_beta_v1.sql",
  "supabase/migrations/20260731_florist_community_beta_v1_r1_security.sql",
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  // Fresh schema for deterministic tests
  await client.query(`
    drop schema if exists storage cascade;
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    create schema public;
    create schema auth;
    create schema storage;
    grant all on schema public to public;
  `);
  for (const rel of files) {
    const sql = fs.readFileSync(path.join(root, rel), "utf8");
    // Strip notify that can confuse some runners; NOTIFY is fine but keep simple
    const cleaned = sql.replace(/notify pgrst,\s*'reload schema';/gi, "-- notify omitted in local apply");
    process.stdout.write(`Applying ${rel}... `);
    await client.query(cleaned);
    console.log("ok");
  }
  // Grants for tables created by migrations (bootstrap grants only cover existing tables)
  await client.query(`
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
    grant select on all tables in schema public to anon;
    grant select, insert, update, delete on all tables in schema storage to authenticated, service_role;
    grant select on all tables in schema storage to anon;
    grant select, insert, update, delete on all tables in schema auth to service_role;
    grant usage, select on all sequences in schema public to authenticated, service_role, anon;
    alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;
  `);
  console.log("Community migrations applied successfully.");
} finally {
  await client.end();
}
