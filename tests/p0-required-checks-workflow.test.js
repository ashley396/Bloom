/**
 * P0-03 — Required PR CI workflow source regression.
 * Proves workflow shape and safety constraints without claiming a live run passed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const WORKFLOW_PATH = path.join(process.cwd(), ".github/workflows/p0-required-checks.yml");

function loadWorkflow() {
  assert.ok(fs.existsSync(WORKFLOW_PATH), "workflow file must exist");
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

test("P0 required-checks workflow triggers on pull_request to main", () => {
  const src = loadWorkflow();
  assert.match(src, /\bon:\s*\n\s*pull_request:/);
  assert.match(src, /pull_request:[\s\S]*branches:[\s\S]*-\s*main/);
  assert.match(src, /\bworkflow_dispatch:\s*$/m);
  assert.doesNotMatch(src, /\bpull_request_target\b/);
});

test("P0 required-checks workflow is contents:read only", () => {
  const src = loadWorkflow();
  assert.match(src, /permissions:\s*\n\s*contents:\s*read\s*$/m);
  assert.doesNotMatch(src, /permissions:[\s\S]*\b(write|contents:\s*write)\b/);
  assert.doesNotMatch(src, /\b(id-token|packages|pull-requests|actions):\s*write\b/);
});

test("P0 required-checks workflow uses Node.js 22", () => {
  const src = loadWorkflow();
  assert.match(src, /NODE_VERSION:\s*"22"/);
  assert.match(src, /node-version:\s*\$\{\{\s*env\.NODE_VERSION\s*\}\}/);
});

test("P0 required-checks workflow provides PostgreSQL 16 and both RLS suites", () => {
  const src = loadWorkflow();
  assert.match(src, /image:\s*postgres:16/);
  assert.match(src, /npm run test:community-rls/);
  assert.match(src, /npm run test:floral-library-rls/);
  assert.match(src, /COMMUNITY_TEST_DATABASE_URL:/);
  assert.match(src, /FLORAL_LIBRARY_TEST_DATABASE_URL:/);
  assert.match(src, /CREATE ROLE florisyn_test/);
  assert.match(src, /Require both RLS suites to pass/);
});

test("P0 required-checks workflow has no deploy or production credentials", () => {
  const src = loadWorkflow();
  assert.doesNotMatch(src, /\b(netlify deploy|npm run deploy|wrangler deploy|vercel deploy)\b/i);
  assert.doesNotMatch(src, /\b(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|STRIPE_SECRET_KEY|NETLIFY_AUTH_TOKEN)\b/);
  assert.doesNotMatch(src, /\bsecrets\.[A-Z0-9_]+\b/);
  assert.doesNotMatch(src, /\b(production|staging)\s+migration\b/i);
});

test("P0 required-checks pins official actions to commit SHAs with version comments", () => {
  const src = loadWorkflow();
  assert.match(
    src,
    /uses:\s*actions\/checkout@[0-9a-f]{40}\s*#\s*v[\d.]+/
  );
  assert.match(
    src,
    /uses:\s*actions\/setup-node@[0-9a-f]{40}\s*#\s*v[\d.]+/
  );
  assert.match(src, /concurrency:[\s\S]*cancel-in-progress:\s*true/);
});
