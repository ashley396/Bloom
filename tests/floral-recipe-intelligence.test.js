import test from "node:test";
import assert from "node:assert/strict";
import {
  parseVisionStemToken,
  mergeConfidence,
  buildDesignDna,
  scaleRecipe,
  suggestSubstitutes
} from "../lib/floral-library/recipe-intelligence.js";

test("parseVisionStemToken captures the vision model's own uncertainty hint instead of discarding it", () => {
  assert.deepEqual(parseVisionStemToken("possibly ranunculus"), { name: "ranunculus", confidence: "estimated" });
  assert.deepEqual(parseVisionStemToken("Freedom rose"), { name: "Freedom rose", confidence: "confirmed" });
  assert.deepEqual(parseVisionStemToken("  Possibly   Hydrangea "), { name: "Hydrangea", confidence: "estimated" });
});

test("mergeConfidence is conservative — any estimated source makes the merged result estimated", () => {
  assert.equal(mergeConfidence("confirmed", "confirmed"), "confirmed");
  assert.equal(mergeConfidence("confirmed", "estimated"), "estimated");
  assert.equal(mergeConfidence("estimated", "confirmed"), "estimated");
  assert.equal(mergeConfidence("estimated", "estimated"), "estimated");
});

test("Design DNA is computed from real ingredient data, not fabricated — same recipe always yields the same profile", () => {
  const recipe = [
    { name: "Garden rose", qty: 6, kind: "flower" },
    { name: "Peony", qty: 3, kind: "flower" },
    { name: "Israeli ruscus", qty: 4, kind: "foliage" }
  ];
  const dna = buildDesignDna(recipe);
  assert.equal(dna.stemCount, 13);
  assert.equal(dna.flowerStems, 9);
  assert.equal(dna.foliageStems, 4);
  assert.equal(dna.dominantKind, "flower");
  assert.equal(dna.focalToFoliageRatio, 69); // 9/13 rounded
  assert.deepEqual(buildDesignDna(recipe), dna);
  assert.ok(dna.styleTags.includes("romantic"), "garden rose + peony should surface a romantic tag");
});

test("Design DNA never invents a style tag for flowers with no real lexicon match", () => {
  const dna = buildDesignDna([{ name: "Xyzflowerus unknownii", qty: 5, kind: "flower" }]);
  assert.deepEqual(dna.styleTags, []);
});

test("Design DNA handles an empty recipe without throwing", () => {
  const dna = buildDesignDna([]);
  assert.equal(dna.stemCount, 0);
  assert.equal(dna.dominantKind, null);
  assert.equal(dna.focalToFoliageRatio, null);
  assert.deepEqual(dna.styleTags, []);
});

test("scaleRecipe by target stem count scales proportionally and never rounds an included ingredient to zero", () => {
  const recipe = [
    { name: "Freedom rose", qty: 6, kind: "flower" },
    { name: "Alstroemeria", qty: 2, kind: "flower" },
    { name: "Floral tape", qty: 1, kind: "supply" }
  ];
  const doubled = scaleRecipe(recipe, { targetStemCount: 16 }); // 6+2=8 stems -> 16 = 2x
  assert.equal(doubled.find((r) => r.name === "Freedom rose").qty, 12);
  assert.equal(doubled.find((r) => r.name === "Alstroemeria").qty, 4);
  assert.equal(doubled.find((r) => r.name === "Floral tape").qty, 1, "supplies are never stem-scaled");

  const shrunk = scaleRecipe(recipe, { targetStemCount: 1 });
  assert.ok(shrunk.every((r) => r.kind === "supply" || r.qty >= 1), "scaling down never drops an ingredient to 0 stems");
});

test("scaleRecipe by a plain multiplier scales directly", () => {
  const recipe = [{ name: "Hydrangea", qty: 3, kind: "flower" }];
  assert.equal(scaleRecipe(recipe, { multiplier: 3 })[0].qty, 9);
  assert.equal(scaleRecipe(recipe, { multiplier: 0.5 })[0].qty, 2);
});

test("scaleRecipe with no scaling info returns the recipe unchanged", () => {
  const recipe = [{ name: "Tulip", qty: 5, kind: "flower" }];
  assert.deepEqual(scaleRecipe(recipe, {}), recipe);
  assert.deepEqual(scaleRecipe([], { targetStemCount: 20 }), []);
});

test("suggestSubstitutes returns real curated same-kind alternatives, case-insensitively, and [] for unknowns", () => {
  assert.deepEqual(suggestSubstitutes("Peony"), ["Garden rose", "Ranunculus"]);
  assert.deepEqual(suggestSubstitutes("PEONY"), ["Garden rose", "Ranunculus"]);
  assert.deepEqual(suggestSubstitutes("  hydrangea  "), ["Snowball viburnum", "Spray rose (clustered)"]);
  assert.deepEqual(suggestSubstitutes("Some made-up flower"), []);
});
