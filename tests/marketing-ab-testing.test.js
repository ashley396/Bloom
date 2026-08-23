import test from "node:test";
import assert from "node:assert/strict";
import { validateExperimentBody, determineExperimentWinner, MIN_SAMPLE_PER_VARIANT } from "../netlify/functions/_shared/marketing-ab-testing.js";

const VALID_BODY = {
  hypothesis: "A warmer caption tone gets more engagement than a formal one.",
  variants: [
    { label: "Warm", content_item_id: "item-1" },
    { label: "Formal", content_item_id: "item-2" }
  ],
  metric: "likes",
  duration_days: 7
};

test("validateExperimentBody accepts a well-formed experiment", () => {
  const result = validateExperimentBody(VALID_BODY);
  assert.equal(result.valid, true);
  assert.equal(result.sanitized.variants.length, 2);
  assert.equal(result.sanitized.duration_days, 7);
});

test("validateExperimentBody rejects a missing hypothesis", () => {
  assert.equal(validateExperimentBody({ ...VALID_BODY, hypothesis: "" }).valid, false);
});

test("validateExperimentBody rejects fewer than 2 variants", () => {
  assert.equal(validateExperimentBody({ ...VALID_BODY, variants: [{ label: "Only", content_item_id: "x" }] }).valid, false);
});

test("validateExperimentBody rejects a variant missing a label or content_item_id", () => {
  assert.equal(validateExperimentBody({ ...VALID_BODY, variants: [{ label: "A" }, { label: "B", content_item_id: "x" }] }).valid, false);
  assert.equal(validateExperimentBody({ ...VALID_BODY, variants: [{ content_item_id: "x" }, { label: "B", content_item_id: "y" }] }).valid, false);
});

test("validateExperimentBody rejects duplicate variant labels — a real experiment needs distinct arms", () => {
  const result = validateExperimentBody({ ...VALID_BODY, variants: [{ label: "Same", content_item_id: "a" }, { label: "same", content_item_id: "b" }] });
  assert.equal(result.valid, false);
});

test("validateExperimentBody rejects a missing metric", () => {
  assert.equal(validateExperimentBody({ ...VALID_BODY, metric: "" }).valid, false);
});

test("validateExperimentBody defaults duration_days to 7 when omitted, and rejects an out-of-range value", () => {
  const result = validateExperimentBody({ hypothesis: VALID_BODY.hypothesis, variants: VALID_BODY.variants, metric: VALID_BODY.metric });
  assert.equal(result.valid, true);
  assert.equal(result.sanitized.duration_days, 7);
  assert.equal(validateExperimentBody({ ...VALID_BODY, duration_days: 0 }).valid, false);
  assert.equal(validateExperimentBody({ ...VALID_BODY, duration_days: 91 }).valid, false);
});

test("determineExperimentWinner: refuses to pick a winner when any variant is under the minimum real sample size", () => {
  const result = determineExperimentWinner([
    { label: "Warm", sampleSize: MIN_SAMPLE_PER_VARIANT, average: 50 },
    { label: "Formal", sampleSize: MIN_SAMPLE_PER_VARIANT - 1, average: 20 }
  ]);
  assert.equal(result.winner, null);
  assert.equal(result.reason, "insufficient_sample_size");
  assert.equal(result.shortLabel, "Formal");
});

test("determineExperimentWinner: picks the real higher-average variant once both meet the minimum sample size", () => {
  const result = determineExperimentWinner([
    { label: "Warm", sampleSize: 15, average: 50 },
    { label: "Formal", sampleSize: 20, average: 20 }
  ]);
  assert.equal(result.winner, "Warm");
  assert.equal(result.marginPct, 150);
});

test("determineExperimentWinner: fewer than 2 variants can never produce a winner", () => {
  const result = determineExperimentWinner([{ label: "Only", sampleSize: 50, average: 10 }]);
  assert.equal(result.winner, null);
  assert.equal(result.reason, "insufficient_variants");
});

test("determineExperimentWinner: a zero-average second-place variant never causes a divide-by-zero — marginPct is null instead", () => {
  const result = determineExperimentWinner([
    { label: "Warm", sampleSize: 15, average: 5 },
    { label: "Formal", sampleSize: 15, average: 0 }
  ]);
  assert.equal(result.winner, "Warm");
  assert.equal(result.marginPct, null);
});
