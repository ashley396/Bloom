import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Launch-readiness audit (2026-09-28): the recurring `GET /settings` 500 was
// three shop columns (pos_tiles, register_name, register_id) that
// settings.js selected but no migration in this repo ever created — they
// had only been added to one project by hand. This guards the whole
// column list, not just those three: every field settings.js reads or
// writes on public.shops must be declared by the executable migration
// chain, so no environment built from the chain can 42703 on it again.

const root = process.cwd();
const migrationsDir = path.join(root, "supabase/migrations");
const settingsSource = fs.readFileSync(path.join(root, "netlify/functions/settings.js"), "utf8");

function settingsFields() {
  const line = settingsSource.match(/const fields=\[([^\]]*)\]/)?.[1] || "";
  return [...line.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

function shopsColumnsDeclaredByMigrations() {
  const declared = new Set();
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, name), "utf8").replace(/\r\n/g, "\n");
    // create table [if not exists] public.shops ( ...columns... );
    for (const block of sql.matchAll(/create table(?: if not exists)? public\.shops\s*\(([\s\S]*?)\n\);/gi)) {
      for (const line of block[1].split("\n")) {
        const col = line.match(/^\s*"?([a-z_]+)"?\s+(?:text|jsonb|json|numeric|boolean|integer|bigint|uuid|timestamptz|timestamp|date|text\[\])/i);
        if (col) declared.add(col[1]);
      }
    }
    // alter table public.shops [add column if not exists x ..., add column ...];
    for (const stmt of sql.matchAll(/alter table public\.shops\b([\s\S]*?);/gi)) {
      for (const col of stmt[1].matchAll(/add column(?: if not exists)?\s+"?([a-z_]+)"?/gi)) declared.add(col[1]);
    }
  }
  return declared;
}

test("every shops column settings.js reads or writes is declared by the migration chain", () => {
  const fields = settingsFields();
  assert.ok(fields.length >= 30, `expected the real settings field list, got ${fields.length} fields`);
  const declared = shopsColumnsDeclaredByMigrations();
  const missing = fields.filter((field) => !declared.has(field));
  assert.deepEqual(
    missing,
    [],
    `settings.js selects public.shops columns no migration creates: ${missing.join(", ")} — add a migration under supabase/migrations/`
  );
});

test("the POS tile / register columns are created idempotently with production's exact types", () => {
  const file = path.join(migrationsDir, "20260905000000_shops_pos_register_columns.sql");
  const sql = fs.readFileSync(file, "utf8");
  assert.match(sql, /alter table public\.shops add column if not exists pos_tiles jsonb;/);
  assert.match(sql, /alter table public\.shops add column if not exists register_name text;/);
  assert.match(sql, /alter table public\.shops add column if not exists register_id text;/);
  // Production already has these columns (added by hand) as nullable with
  // no default — the migration must stay a strict no-op there.
  assert.doesNotMatch(sql, /pos_tiles jsonb\s+(not null|default)/i);
  assert.doesNotMatch(sql, /\bupdate public\.shops\b/i);
});
