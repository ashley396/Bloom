import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STAGING_BOOTSTRAP_ORDER,
  EXCLUDED_FROM_BOOTSTRAP,
} from "../scripts/rehearse-staging-bootstrap-local.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("staging bootstrap order files exist on disk", () => {
  for (const step of STAGING_BOOTSTRAP_ORDER) {
    assert.ok(fs.existsSync(path.join(root, step.file)), `missing ${step.file}`);
  }
});

test("Community v1 precedes Community R1 and Floral lock follows", () => {
  const files = STAGING_BOOTSTRAP_ORDER.map((s) => s.file);
  const v1 = files.indexOf("supabase/migrations/20260731_florist_community_beta_v1.sql");
  const r1 = files.indexOf("supabase/migrations/20260731_florist_community_beta_v1_r1_security.sql");
  const floral = files.indexOf("supabase/migrations/20260801_p0_01_floral_library_schema_lock_v1.sql");
  assert.ok(v1 >= 0 && r1 >= 0 && floral >= 0);
  assert.ok(v1 < r1, "Community v1 must precede R1");
  assert.ok(r1 < floral, "Floral lock follows Community pair by chronology");
});

test("excluded migrations are not in bootstrap order", () => {
  const files = new Set(STAGING_BOOTSTRAP_ORDER.map((s) => s.file));
  for (const ex of EXCLUDED_FROM_BOOTSTRAP) {
    assert.equal(files.has(ex), false, `excluded file unexpectedly ordered: ${ex}`);
  }
});

test("local stub is marked localOnly and is first", () => {
  assert.equal(STAGING_BOOTSTRAP_ORDER[0].localOnly, true);
  assert.match(STAGING_BOOTSTRAP_ORDER[0].file, /local-supabase-compat-stub\.sql$/);
});

test("staging bootstrap plan document exists", () => {
  assert.ok(fs.existsSync(path.join(root, "docs/production/STAGING-BOOTSTRAP-PLAN.md")));
});
