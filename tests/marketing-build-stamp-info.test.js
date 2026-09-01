import test from "node:test";
import assert from "node:assert/strict";
import { buildStampInfo } from "../scripts/lib/marketing-build-stamp-info.mjs";

// Batch 6 ("Preview path + CI + provider cleanup + live-readiness"), Part
// D: the exact source commit/environment a build actually came from.

// Part P #6: exact build SHA is exposed.
test("buildStampInfo: exposes the exact commit SHA and a short form of it", () => {
  const info = buildStampInfo({ COMMIT_REF: "abcdef1234567890abcdef1234567890abcdef12" });
  assert.equal(info.commitSha, "abcdef1234567890abcdef1234567890abcdef12");
  assert.equal(info.commitShaShort, "abcdef123456");
});

test("buildStampInfo: falls back to GITHUB_SHA when COMMIT_REF is absent (a CI-only environment)", () => {
  const info = buildStampInfo({ GITHUB_SHA: "1111111111111111111111111111111111111111" });
  assert.equal(info.commitSha, "1111111111111111111111111111111111111111");
});

test("buildStampInfo: an environment with no commit info at all reports null honestly, never a guess", () => {
  const info = buildStampInfo({});
  assert.equal(info.commitSha, null);
  assert.equal(info.commitShaShort, null);
});

// Part P #7: exact environment is exposed.
test("buildStampInfo: exposes the exact FLORISYN_ENV value and derives isPreview correctly", () => {
  assert.equal(buildStampInfo({ FLORISYN_ENV: "preview" }).environment, "preview");
  assert.equal(buildStampInfo({ FLORISYN_ENV: "preview" }).isPreview, true);
  assert.equal(buildStampInfo({ FLORISYN_ENV: "staging" }).isPreview, true);
  assert.equal(buildStampInfo({ FLORISYN_ENV: "production" }).isPreview, false);
  assert.equal(buildStampInfo({}).environment, null, "no environment set must never be silently reported as any particular one");
  assert.equal(buildStampInfo({}).isPreview, false);
});

test("buildStampInfo: exposes branch/ref and a real build timestamp", () => {
  const before = Date.now();
  const info = buildStampInfo({ BRANCH: "test/flyer-visual-review-preview" });
  const after = Date.now();
  assert.equal(info.branch, "test/flyer-visual-review-preview");
  const ts = new Date(info.buildTimestamp).getTime();
  assert.ok(ts >= before && ts <= after, "buildTimestamp must be a real, current timestamp");
});

test("buildStampInfo: exposes the Netlify deploy context when present", () => {
  assert.equal(buildStampInfo({ CONTEXT: "deploy-preview" }).netlifyContext, "deploy-preview");
  assert.equal(buildStampInfo({}).netlifyContext, null);
});
