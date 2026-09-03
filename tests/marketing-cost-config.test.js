import test from "node:test";
import assert from "node:assert/strict";
import {
  COST_PER_UNIT_CENTS,
  estimateCostCents,
  DEFAULT_MONTHLY_ALLOWANCE,
  OPENAI_IMAGE_COST_CEILING_CENTS_BY_TIER,
  estimateOpenAiImageCostCents,
  estimateOpenAiActualCostCentsFromUsage
} from "../netlify/functions/_shared/marketing-cost-config.js";

test("estimateCostCents: image purpose multiplies unit count by the configured per-image rate", () => {
  const cost = estimateCostCents({ purpose: "image", unitType: "image", units: 3 });
  assert.equal(cost, COST_PER_UNIT_CENTS.image_standard * 3);
});

test("estimateCostCents: voice purpose bills per 1,000 characters, rounding UP a partial thousand", () => {
  const cost = estimateCostCents({ purpose: "voice", unitType: "character", units: 1500 });
  assert.equal(cost, COST_PER_UNIT_CENTS.voice_per_1000_chars * 2, "1500 chars must bill as 2 full units, not 1.5");
});

test("estimateCostCents: voice purpose with zero characters costs nothing", () => {
  const cost = estimateCostCents({ purpose: "voice", unitType: "character", units: 0 });
  assert.equal(cost, 0);
});

test("estimateCostCents: avatar_video purpose bills per second at the avatar rate, not the generic video rate", () => {
  const cost = estimateCostCents({ purpose: "avatar_video", unitType: "second", units: 10 });
  assert.equal(cost, COST_PER_UNIT_CENTS.avatar_video_second * 10);
  assert.notEqual(COST_PER_UNIT_CENTS.avatar_video_second, COST_PER_UNIT_CENTS.video_standard_second);
});

test("estimateCostCents: copy purpose always bills at least one request even if units is 0/undefined", () => {
  assert.equal(estimateCostCents({ purpose: "copy", unitType: "request", units: 0 }), COST_PER_UNIT_CENTS.copy_request);
  assert.equal(estimateCostCents({ purpose: "copy", unitType: "request" }), COST_PER_UNIT_CENTS.copy_request);
});

test("estimateCostCents: an unrecognized purpose/unitType combination returns null rather than a wrong number", () => {
  assert.equal(estimateCostCents({ purpose: "not_a_real_purpose", unitType: "second", units: 5 }), null);
});

test("DEFAULT_MONTHLY_ALLOWANCE matches the Section 9 Founding Beta target (~90 pieces/month)", () => {
  const total = DEFAULT_MONTHLY_ALLOWANCE.image_posts + DEFAULT_MONTHLY_ALLOWANCE.reels_or_shorts + DEFAULT_MONTHLY_ALLOWANCE.long_form_videos;
  assert.equal(total, 90);
});

// Hybrid Marketing Studio Batch 1, Part 6: OpenAI conservative cost model.

test("estimateOpenAiImageCostCents: never equals a hardcoded $0.053/image (5.3 cents) — Ashley's explicit instruction not to treat that figure as authoritative", () => {
  for (const tier of ["low", "medium", "high"]) {
    const result = estimateOpenAiImageCostCents({ qualityTier: tier });
    assert.notEqual(result.cents, 5.3, `tier "${tier}" must not hardcode the report's $0.053 figure`);
  }
});

test("estimateOpenAiImageCostCents: returns the named per-tier ceiling constant with cost_source metadata, and null for an unknown tier", () => {
  for (const tier of Object.keys(OPENAI_IMAGE_COST_CEILING_CENTS_BY_TIER)) {
    const result = estimateOpenAiImageCostCents({ qualityTier: tier });
    assert.equal(result.cents, OPENAI_IMAGE_COST_CEILING_CENTS_BY_TIER[tier]);
    assert.equal(result.currency, "USD");
    assert.equal(result.cost_source, "openai_conservative_ceiling_estimate");
  }
  assert.equal(estimateOpenAiImageCostCents({ qualityTier: "not_a_real_tier" }), null);
});

test("estimateOpenAiActualCostCentsFromUsage: reconciles real input/output token usage into a cost, distinct from the pre-flight ceiling", () => {
  const reconciled = estimateOpenAiActualCostCentsFromUsage({ input_tokens: 1_000_000, output_tokens: 0 });
  assert.equal(reconciled.cents, 800, "1M input tokens at $8/M must reconcile to 800 cents");
  const reconciledOutput = estimateOpenAiActualCostCentsFromUsage({ input_tokens: 0, output_tokens: 1_000_000 });
  assert.equal(reconciledOutput.cents, 3000, "1M output tokens at $30/M must reconcile to 3000 cents");
  assert.equal(reconciled.cost_source, "openai_reconciled_from_usage");
});

test("estimateOpenAiActualCostCentsFromUsage: returns null (never a fabricated figure) when no usage was reported", () => {
  assert.equal(estimateOpenAiActualCostCentsFromUsage(undefined), null);
  assert.equal(estimateOpenAiActualCostCentsFromUsage(null), null);
  assert.equal(estimateOpenAiActualCostCentsFromUsage({}), null);
});
