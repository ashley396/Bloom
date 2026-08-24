import test from "node:test";
import assert from "node:assert/strict";
import { PERSONAL_BRAND_MODES, PERSONAL_BRAND_MODE_KEYS, getPersonalBrandMode } from "../netlify/functions/_shared/creative-ai/personal-brand-modes.js";
import { SUPPORTED_PLATFORMS } from "../netlify/functions/_shared/marketing-social-providers.js";

test("every mode has the required fields and only real, supported suggested platforms", () => {
  for (const key of PERSONAL_BRAND_MODE_KEYS) {
    const mode = PERSONAL_BRAND_MODES[key];
    assert.equal(typeof mode.label, "string");
    assert.equal(typeof mode.description, "string");
    assert.equal(typeof mode.promptGuidance, "string");
    assert.ok(mode.promptGuidance.length > 10);
    assert.ok(["professional", "balanced", "casual"].includes(mode.defaultBalance));
    assert.ok(Array.isArray(mode.suggestedPlatforms) && mode.suggestedPlatforms.length > 0);
    for (const platform of mode.suggestedPlatforms) {
      assert.ok(SUPPORTED_PLATFORMS.includes(platform), `mode "${key}" suggests unsupported platform "${platform}"`);
    }
  }
});

test("all ten modes from Section 7 of the directive exist", () => {
  for (const key of [
    "founder_portrait",
    "behind_the_counter",
    "floral_designer",
    "founder_story",
    "professional",
    "casual",
    "humorous_personality",
    "seasonal",
    "educational",
    "product_shop_promotion"
  ]) {
    assert.ok(PERSONAL_BRAND_MODE_KEYS.includes(key), `missing mode: ${key}`);
  }
});

test("getPersonalBrandMode returns the real mode object", () => {
  assert.equal(getPersonalBrandMode("founder_portrait").label, "Founder Portrait");
});

test("getPersonalBrandMode throws on an unknown mode rather than returning undefined", () => {
  assert.throws(() => getPersonalBrandMode("not_a_real_mode"), /unknown mode/);
});
