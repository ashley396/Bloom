import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOOM_VERSION_LABEL,
  BLOOM_VERSION_CODE,
  KNOWN_ISSUES_V1,
  MIGRATION_MANIFEST
} from "../netlify/functions/_shared/bloom-release.js";

test("Florisyn version label matches product naming", () => {
  assert.match(BLOOM_VERSION_LABEL, /Florisyn 1\.0/);
  assert.equal(BLOOM_VERSION_CODE, "founder-1.0");
});
test("migration manifest includes release candidate feedback migration", () => {
  assert.ok(MIGRATION_MANIFEST.some((m) => m.file.includes("release_candidate_v1")));
});

test("known issues documents university gap", () => {
  assert.ok(KNOWN_ISSUES_V1.some((i) => i.id === "university"));
});
