#!/usr/bin/env node
/**
 * Apply Floral Library P0-01 schema lock to local Postgres for RLS tests.
 *
 * Usage:
 *   node scripts/apply-floral-library-rls-local.mjs
 *   FLORAL_LIBRARY_APPLY_MODE=lock-again node scripts/apply-floral-library-rls-local.mjs
 *
 * Modes:
 *   reset (default) — drop schemas, bootstrap, apply P0-01 lock
 *   lock-again — re-apply P0-01 only (no schema reset)
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const url =
  process.env.FLORAL_LIBRARY_TEST_DATABASE_URL ||
  process.env.COMMUNITY_TEST_DATABASE_URL ||
  "postgres://florisyn_test:florisyn_test@127.0.0.1:5432/florisyn_community_test";

const mode = String(process.env.FLORAL_LIBRARY_APPLY_MODE || "reset").toLowerCase();
const root = process.cwd();

const bootstrap = "tests/fixtures/floral-library-rls-bootstrap.sql";
const lock = "supabase/migrations/20260801_p0_01_floral_library_schema_lock_v1.sql";

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
    create schema public;
    create schema auth;
    grant all on schema public to public;
  `);
}

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    if (mode === "lock-again") {
      await applyFile(client, lock);
      console.log("P0-01 floral library lock re-applied successfully (no schema reset).");
      return;
    }

    if (mode !== "reset" && mode !== "no-reset") {
      throw new Error(`Unknown FLORAL_LIBRARY_APPLY_MODE=${mode}`);
    }

    if (mode === "reset") {
      await resetSchemas(client);
    }
    await applyFile(client, bootstrap);
    await applyFile(client, lock);
    console.log(`Floral library P0-01 migrations applied successfully (mode=${mode}).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exitCode = 1;
});
