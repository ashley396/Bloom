import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const blueprint = readFileSync(
  new URL("../docs/architecture/FLORISYN-SCALABILITY-STABILITY-BLUEPRINT.md", import.meta.url),
  "utf8",
);
const k6Script = readFileSync(new URL("../load-tests/k6/florisyn-auth-capacity.js", import.meta.url), "utf8");
const exampleUsers = readFileSync(new URL("../load-tests/k6/users.example.json", import.meta.url), "utf8");

test("scalability blueprint preserves the required A-H response contract", () => {
  for (const heading of [
    "## A. Executive Summary",
    "## B. Scalability Architecture (Netlify + Supabase)",
    "## C. Database & RLS Plan",
    "## D. Frontend Performance Plan",
    "## E. Stability & Graceful Degradation Plan",
    "## F. Load-Testing Suite",
    "## G. Infra Blueprint & Capacity Roadmap",
    "## H. Implementation Checklist (GitHub + Cursor)",
  ]) {
    assert.match(blueprint, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(blueprint, /docs\/architecture\/adr\/0001-scalability-stability-blueprint\.md/);
});

test("k6 capacity suite includes all required scenarios and thresholds", () => {
  for (const marker of [
    "baseline:",
    "burst:",
    "sustained:",
    'rate: Number(__ENV.RATE || 300)',
    'target: Number(__ENV.VUS || 10000)',
    'unexpected_errors: ["rate<0.01"]',
  ]) {
    assert.ok(k6Script.includes(marker), `missing k6 marker: ${marker}`);
  }
});

test("k6 capacity suite fails closed for accidental production targets", () => {
  assert.match(k6Script, /ALLOW_LOAD_TEST/);
  assert.match(k6Script, /Refusing non-staging target/);
  assert.match(k6Script, /ALLOW_NON_STAGING/);
});

test("load fixtures contain no real FLORISYN credentials or service keys", () => {
  assert.match(exampleUsers, /example\.invalid/);
  assert.doesNotMatch(exampleUsers, /SUPABASE_(SERVICE_ROLE|SECRET)_KEY/);
  assert.doesNotMatch(k6Script, /sb_secret_|service_role/i);
});
