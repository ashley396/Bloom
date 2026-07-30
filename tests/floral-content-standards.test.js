import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getBloomFloristCatalog,
  BLOOM_RC2_CATALOG_SIZE,
  FLORIST_CATALOG_TIERS,
} from "../netlify/functions/_shared/floral-library-catalog.js";
import { generateFloristCatalog } from "../netlify/functions/_shared/floral-catalog-generator.js";

const FORBIDDEN =
  /\b(pizza|burger|coffee|cupcake|restaurant order|grocery|sushi|taco|latte|espresso|food menu)\b/i;

describe("Floral content standards", () => {
  it("catalog contains 450 florist-specific arrangements in three tiers", () => {
    assert.equal(BLOOM_RC2_CATALOG_SIZE, 450);
    const catalog = getBloomFloristCatalog();
    assert.equal(catalog.length, 450);
    assert.deepEqual(
      FLORIST_CATALOG_TIERS.map((t) => t.count),
      [150, 150, 150],
    );
    const tiers = new Set(catalog.map((p) => p.catalog_tier));
    assert.ok(tiers.has("Everyday"));
    assert.ok(tiers.has("Budget-Friendly"));
    assert.ok(tiers.has("Premium Everyday"));
  });

  it("every arrangement has unique name and realistic florist recipe", () => {
    const catalog = getBloomFloristCatalog();
    const names = new Set(catalog.map((p) => p.name));
    assert.equal(names.size, 450);
    for (const p of catalog) {
      assert.ok(p.recipe?.length >= 2, `${p.id} needs recipe`);
      assert.ok(p.instructions?.length >= 4, `${p.id} needs build steps`);
      assert.ok(p.container, `${p.id} needs container`);
      assert.ok(p.mechanics, `${p.id} needs mechanics`);
      assert.ok(p.why_it_works, `${p.id} needs why_it_works`);
      assert.ok(p.primary_image?.url, `${p.id} needs image`);
    }
  });

  it("catalog excludes food, restaurant ordering, and generic SaaS demo content", () => {
    const catalog = getBloomFloristCatalog();
    for (const p of catalog) {
      const blob = `${p.name} ${p.description} ${(p.categories || []).join(" ")} ${p.tags?.join(" ") || ""}`;
      assert.doesNotMatch(blob, FORBIDDEN, `non-floral content in ${p.id}`);
    }
  });

  it("catalog includes hydrangea, peonies, roses, and sympathy-ready designs", () => {
    const text = getBloomFloristCatalog()
      .map((p) => `${p.name} ${p.recipe.map((r) => r.name).join(" ")} ${p.categories.join(" ")}`)
      .join(" ")
      .toLowerCase();
    assert.match(text, /hydrangea/);
    assert.match(text, /peoni/);
    assert.match(text, /rose/);
    assert.match(text, /sympathy|carnation|lily|chrysanthemum/);
  });

  it("library page load batch minimizes duplicate photos on first screen", () => {
    const batch = getBloomFloristCatalog(60);
    const urls = batch.map((p) => p.primary_image.url);
    const unique = new Set(urls);
    assert.ok(unique.size >= 45, "first 60 items should use mostly unique photos");
  });

  it("generator rejects invalid catalog sizes", () => {
    assert.throws(() => generateFloristCatalog(100), /expects 450/);
  });
});
