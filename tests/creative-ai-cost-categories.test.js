import test from "node:test";
import assert from "node:assert/strict";
import {
  COST_CATEGORY,
  COST_CATEGORY_GROUP,
  QUALITY_TIER,
  categorizeCostPurpose,
  describeQualityTierOptions
} from "../netlify/functions/_shared/creative-ai/cost-categories.js";

test("categorizeCostPurpose: maps every existing marketing-cost-config purpose to a real category", () => {
  assert.deepEqual(categorizeCostPurpose("avatar_video"), { category: COST_CATEGORY.AVATAR, group: COST_CATEGORY_GROUP.GENERATION });
  assert.deepEqual(categorizeCostPurpose("voice"), { category: COST_CATEGORY.VOICE, group: COST_CATEGORY_GROUP.GENERATION });
  assert.deepEqual(categorizeCostPurpose("video"), { category: COST_CATEGORY.VIDEO, group: COST_CATEGORY_GROUP.GENERATION });
  assert.deepEqual(categorizeCostPurpose("image"), { category: COST_CATEGORY.IMAGE, group: COST_CATEGORY_GROUP.GENERATION });
  assert.deepEqual(categorizeCostPurpose("copy"), { category: COST_CATEGORY.COPY, group: COST_CATEGORY_GROUP.GENERATION });
});

test("categorizeCostPurpose: an unknown purpose returns null rather than a fabricated category", () => {
  assert.equal(categorizeCostPurpose("not_a_real_purpose"), null);
});

test("COST_CATEGORY: transformation and publishing exist as real categories distinct from generation", () => {
  assert.equal(COST_CATEGORY.TRANSFORMATION, "transformation");
  assert.equal(COST_CATEGORY.PUBLISHING, "publishing");
});

test("describeQualityTierOptions: every generation category has all three tiers described", () => {
  for (const category of [COST_CATEGORY.IMAGE, COST_CATEGORY.VIDEO, COST_CATEGORY.AVATAR, COST_CATEGORY.VOICE, COST_CATEGORY.TRANSFORMATION]) {
    const descriptions = describeQualityTierOptions(category);
    for (const tier of Object.values(QUALITY_TIER)) {
      assert.ok(descriptions[tier], `category "${category}" missing tier "${tier}"`);
      assert.equal(typeof descriptions[tier].providerNote, "string");
    }
  }
});

test("describeQualityTierOptions: rejects an unknown category rather than returning undefined silently", () => {
  assert.throws(() => describeQualityTierOptions("not_a_real_category"), /no tier descriptions/);
});

test("describeQualityTierOptions: is purely descriptive — calling it never mutates any shared state or returns a callable 'switch provider' function", () => {
  const before = JSON.stringify(describeQualityTierOptions(COST_CATEGORY.AVATAR));
  describeQualityTierOptions(COST_CATEGORY.AVATAR);
  describeQualityTierOptions(COST_CATEGORY.AVATAR);
  const after = JSON.stringify(describeQualityTierOptions(COST_CATEGORY.AVATAR));
  assert.equal(before, after);
  const descriptions = describeQualityTierOptions(COST_CATEGORY.AVATAR);
  for (const tier of Object.values(descriptions)) {
    assert.equal(typeof tier.providerNote, "string");
    assert.notEqual(typeof tier.providerNote, "function");
  }
});
