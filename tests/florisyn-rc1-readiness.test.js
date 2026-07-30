import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function readDoc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function docExists(rel) {
  assert.ok(fs.existsSync(path.join(ROOT, rel)), `missing: ${rel}`);
}

test("RC1 readiness documents exist", () => {
  for (const file of [
    "docs/FLORISYN_RC1_FINAL_READINESS_REPORT.md",
    "docs/FLORISYN_RC1_OWNER_DEPLOYMENT_CHECKLIST.md",
  ]) {
    docExists(file);
  }
});

test("RC1 final report includes required verdict options and no-deploy confirmation", () => {
  const doc = readDoc("docs/FLORISYN_RC1_FINAL_READINESS_REPORT.md");
  for (const phrase of [
    "BLOCKED — OWNER ACTION REQUIRED",
    "BLOCKED — ENGINEERING ISSUE",
    "READY FOR OWNER-CONTROLLED DEPLOYMENT",
    "405/405",
    "delivery-proofs",
    "Needs Owner Confirmation",
    "no deployment",
  ]) {
    assert.match(doc, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `missing: ${phrase}`);
  }
  assert.match(doc, /20260730_foundation_daily_loop_v1\.sql/);
  assert.match(doc, /20260730_delivery_proofs_storage\.sql/);
});

test("RC1 owner checklist is sequential with before/deploy/after sections", () => {
  const doc = readDoc("docs/FLORISYN_RC1_OWNER_DEPLOYMENT_CHECKLIST.md");
  for (const section of ["Before deployment", "Deployment", "After deployment"]) {
    assert.match(doc, new RegExp(section), `missing section: ${section}`);
  }
  assert.match(doc, /Run \*\*in this exact order\*\*|in this exact order/i);
  assert.match(doc, /one Netlify production deploy/i);
  assert.match(doc, /Roll back immediately/i);
});

test("governance map documentation paths resolve to real files", () => {
  const map = readDoc("docs/FLORISYN_GOVERNANCE_MAP.md");
  const refs = [
    ...map.matchAll(/`FLORISYN_[A-Z0-9_]+\.md`/g),
    ...map.matchAll(/`docs\/FLORISYN_[A-Z0-9_]+\.md`/g),
  ].map((m) => m[0].replace(/`/g, "").replace(/^docs\//, ""));
  const unique = [...new Set(refs)];
  for (const ref of unique) {
    docExists(`docs/${ref.replace(/^docs\//, "")}`);
  }
});

test("constitution docs referenced in governance hierarchy exist", () => {
  for (const file of [
    "docs/FLORISYN_MASTER_ARCHITECTURE_BIBLE.md",
    "docs/FLORISYN_GOLD_STANDARD.md",
    "docs/FLORISYN_EXPERIENCE_STANDARD.md",
    "docs/FLORISYN_DESIGN_SYSTEM.md",
    "docs/FLORISYN_ECOSYSTEM_PORTALS_STANDARD.md",
    "docs/FLORISYN_WEBSITE_STUDIO_BLUEPRINT.md",
    "docs/FLORISYN_MASTER_BUILD_CHECKLIST.md",
    "docs/FLORISYN_PORTAL_OWNERSHIP_MATRIX.md",
    "docs/FLORISYN_GOVERNANCE_MAP.md",
  ]) {
    docExists(file);
  }
});
