import test from "node:test";
import assert from "node:assert/strict";
import {
  parseVisionStemToken,
  mergeConfidence,
  buildDesignDna,
  scaleRecipe,
  suggestSubstitutes,
  matchRecipeToInventory
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

test("matchRecipeToInventory attaches the importing shop's own real cost for an exact match", () => {
  const recipe = [{ name: "Freedom rose", qty: 6, kind: "flower" }];
  const inventory = [{ id: "inv-1", name: "Freedom rose", cost: 1.25 }];
  const result = matchRecipeToInventory(recipe, inventory);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.totalCount, 1);
  assert.deepEqual(result.unmatchedNames, []);
  assert.equal(result.recipe[0].matched, true);
  assert.equal(result.recipe[0].matched_inventory_id, "inv-1");
  assert.equal(result.recipe[0].unit_cost, 1.25);
  assert.equal(result.estimatedCost, 7.5); // 6 * 1.25
});

test("matchRecipeToInventory matches a shorter inventory name against a longer recipe name, and vice versa", () => {
  const shortInventory = matchRecipeToInventory(
    [{ name: "Freedom rose", qty: 4, kind: "flower" }],
    [{ id: "i1", name: "Rose", cost: 2 }]
  );
  assert.equal(shortInventory.recipe[0].matched, true);
  assert.equal(shortInventory.recipe[0].unit_cost, 2);

  const shortRecipe = matchRecipeToInventory(
    [{ name: "Rose", qty: 4, kind: "flower" }],
    [{ id: "i2", name: "Freedom rose", cost: 3 }]
  );
  assert.equal(shortRecipe.recipe[0].matched, true);
  assert.equal(shortRecipe.recipe[0].unit_cost, 3);
});

test("matchRecipeToInventory leaves an unmatched ingredient at 0 cost and lists it as unmatched — never a wrong guess", () => {
  const result = matchRecipeToInventory(
    [
      { name: "Peony", qty: 3, kind: "flower" },
      { name: "Israeli ruscus", qty: 4, kind: "foliage" },
    ],
    [{ id: "i1", name: "Peony", cost: 4 }]
  );
  assert.equal(result.matchedCount, 1);
  assert.equal(result.totalCount, 2);
  assert.deepEqual(result.unmatchedNames, ["Israeli ruscus"]);
  const ruscus = result.recipe.find((r) => r.name === "Israeli ruscus");
  assert.equal(ruscus.matched, false);
  assert.equal(ruscus.unit_cost, 0);
  assert.equal(ruscus.matched_inventory_id, null);
});

test("matchRecipeToInventory handles empty recipe or empty inventory without throwing", () => {
  assert.deepEqual(matchRecipeToInventory([], []), {
    recipe: [],
    matchedCount: 0,
    totalCount: 0,
    unmatchedNames: [],
    estimatedCost: 0,
  });
  const result = matchRecipeToInventory([{ name: "Rose", qty: 5, kind: "flower" }], []);
  assert.equal(result.matchedCount, 0);
  assert.equal(result.unmatchedNames.length, 1);
});

test("suggestSubstitutes returns real curated same-kind alternatives, case-insensitively, and [] for unknowns", () => {
  assert.deepEqual(suggestSubstitutes("Peony"), ["Garden rose", "Ranunculus"]);
  assert.deepEqual(suggestSubstitutes("PEONY"), ["Garden rose", "Ranunculus"]);
  assert.deepEqual(suggestSubstitutes("  hydrangea  "), ["Snowball viburnum", "Spray rose (clustered)"]);
  assert.deepEqual(suggestSubstitutes("Some made-up flower"), []);
});
