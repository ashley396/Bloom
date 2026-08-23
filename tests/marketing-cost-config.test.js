import test from "node:test";
import assert from "node:assert/strict";
import {
  COST_PER_UNIT_CENTS,
  estimateCostCents,
  DEFAULT_MONTHLY_ALLOWANCE
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
