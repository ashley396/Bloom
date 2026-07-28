import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOOM_VERSION_LABEL,
  BLOOM_VERSION_CODE,
  KNOWN_ISSUES_V1,
  MIGRATION_MANIFEST
} from "../netlify/functions/_shared/bloom-release.js";

test("RC1 version label matches product naming", () => {
  assert.match(BLOOM_VERSION_LABEL, /1\.0 RC1/);
  assert.equal(BLOOM_VERSION_CODE, "1.0.0-rc.1");
});

test("migration manifest includes release candidate feedback migration", () => {
  assert.ok(MIGRATION_MANIFEST.some((m) => m.file.includes("release_candidate_v1")));
});

test("known issues documents university gap", () => {
  assert.ok(KNOWN_ISSUES_V1.some((i) => i.id === "university"));
});
