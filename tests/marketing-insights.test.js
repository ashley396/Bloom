import test from "node:test";
import assert from "node:assert/strict";
import { classifyInsight, groupMetricsByDimension, INSIGHT_KINDS } from "../netlify/functions/_shared/marketing-insights.js";

test("classifyInsight: zero sample size has no insight kind at all", () => {
  assert.equal(classifyInsight({ sampleSize: 0 }), null);
  assert.equal(classifyInsight({ sampleSize: undefined }), null);
});

test("classifyInsight: a small sample is only ever 'observation', no matter how dramatic the average looks", () => {
  assert.equal(classifyInsight({ sampleSize: 1 }), "observation");
  assert.equal(classifyInsight({ sampleSize: 9 }), "observation");
});

test("classifyInsight: a mid-size sample is 'correlation'", () => {
  assert.equal(classifyInsight({ sampleSize: 10 }), "correlation");
  assert.equal(classifyInsight({ sampleSize: 29 }), "correlation");
});

test("classifyInsight: only a real, larger sample earns 'recommendation'", () => {
  assert.equal(classifyInsight({ sampleSize: 30 }), "recommendation");
  assert.equal(classifyInsight({ sampleSize: 1000 }), "recommendation");
});

test("classifyInsight never returns a kind outside the documented closed set", () => {
  for (const n of [1, 5, 10, 20, 30, 100]) {
    assert.ok(INSIGHT_KINDS.includes(classifyInsight({ sampleSize: n })));
  }
});

test("groupMetricsByDimension: groups by the given key and computes a real average per group", () => {
  const rows = [
    { platform: "facebook", value: 10 },
    { platform: "facebook", value: 20 },
    { platform: "instagram", value: 100 }
  ];
  const groups = groupMetricsByDimension(rows, "platform");
  const fb = groups.find((g) => g.key === "facebook");
  const ig = groups.find((g) => g.key === "instagram");
  assert.equal(fb.sampleSize, 2);
  assert.equal(fb.average, 15);
  assert.equal(ig.sampleSize, 1);
  assert.equal(ig.average, 100);
});

test("groupMetricsByDimension: sorts groups highest-average-first", () => {
  const rows = [{ platform: "a", value: 1 }, { platform: "b", value: 100 }, { platform: "c", value: 50 }];
  const groups = groupMetricsByDimension(rows, "platform");
  assert.deepEqual(groups.map((g) => g.key), ["b", "c", "a"]);
});

test("groupMetricsByDimension: rows with a missing dimension key or non-numeric value are skipped, never counted as zero", () => {
  const rows = [{ platform: null, value: 10 }, { platform: "facebook", value: "not a number" }, { platform: "facebook", value: 5 }];
  const groups = groupMetricsByDimension(rows, "platform");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sampleSize, 1);
  assert.equal(groups[0].average, 5);
});

test("groupMetricsByDimension: each group carries the same honest sample-size-driven classification as classifyInsight", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ platform: "facebook", value: i }));
  const groups = groupMetricsByDimension(rows, "platform");
  assert.equal(groups[0].sampleSize, 12);
  assert.equal(groups[0].kind, "correlation");
});

test("groupMetricsByDimension: an empty input returns an empty list, not an error", () => {
  assert.deepEqual(groupMetricsByDimension([], "platform"), []);
  assert.deepEqual(groupMetricsByDimension(undefined, "platform"), []);
});
