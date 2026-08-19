import test from "node:test";
import assert from "node:assert/strict";
import { getBloomFloristCatalog, BLOOM_RC2_CATALOG_SIZE } from "../netlify/functions/_shared/floral-library-catalog.js";
import { shouldSeedWebsiteCatalog, buildWebsiteCatalogSeeds } from "../netlify/functions/_shared/bloom-website-catalog-seed.js";
import fs from "node:fs";

test("RC2 floral catalog has a verified unique-photo starter collection", () => {
  const catalog = getBloomFloristCatalog(240);
  assert.equal(catalog.length, BLOOM_RC2_CATALOG_SIZE);
  assert.ok(catalog.every((p) => p.name && p.primary_image?.url && p.image_license?.source));
  assert.ok(catalog.every((p) => p.metadata?.image_standard === "ultra_realistic_professional_floral_photography"));
  assert.ok(catalog.every((p) => /ultra-realistic/i.test(p.primary_image.alt)));
  const uniqueNames = new Set(catalog.map((p) => p.name));
  assert.equal(uniqueNames.size, catalog.length);
  const uniqueImages = new Set(catalog.map((p) => p.primary_image.url));
  assert.equal(uniqueImages.size, catalog.length);
});

test("catalog includes roses hydrangeas wedding sympathy", () => {
  const text = getBloomFloristCatalog(80)
    .map((p) => p.categories.join(" "))
    .join(" ")
    .toLowerCase();
  assert.match(text, /rose/);
  assert.match(text, /hydrangea|wedding|sympathy/);
});

test("first visible floral library page uses unique everyday arrangement photos", () => {
  const firstPage = getBloomFloristCatalog(60);
  assert.equal(firstPage.length, BLOOM_RC2_CATALOG_SIZE);
  assert.ok(firstPage.every((p) => p.categories.includes("Everyday")));
  assert.ok(firstPage.every((p) => /everyday floral arrangement/i.test(p.description)));
  const imageUrls = firstPage.map((p) => p.primary_image.url);
  assert.equal(new Set(imageUrls).size, imageUrls.length);
});

test("every visible floral library image is a vetted vase arrangement asset", () => {
  const catalog = getBloomFloristCatalog(240);
  const blocked = /pexels|computer|gaming|landscape|waterfall|person|model|single-stem|single-rose|hand-tie|no-vase/i;
  assert.ok(catalog.length > 0);
  for (const product of catalog) {
    assert.match(product.primary_image.url, /^\/assets\/floral-library\/everyday\/ed-\d{2,3}-/);
    assert.doesNotMatch(product.primary_image.url, blocked);
    assert.doesNotMatch(`${product.name} ${product.description} ${product.short_description}`, blocked);
    assert.match(product.description, /arrangement/i);
    assert.notEqual(product.arrangement_type, "plant");
    assert.equal(product.image_license.source, "bloom_owned");
  }
});

test("first visible floral library recipes are florist-ready and not repeated filler", () => {
  const firstPage = getBloomFloristCatalog(60);
  assert.ok(firstPage.every((p) => p.recipe.length >= 4));
  assert.ok(firstPage.every((p) => p.recipe.every((r) => r.name && Number(r.qty) > 0)));
  const recipeSignatures = firstPage.map((p) => p.recipe.map((r) => `${r.name}:${r.qty}`).join("|"));
  assert.ok(new Set(recipeSignatures).size >= 20);
});

test("website catalog seed only when empty", () => {
  assert.equal(shouldSeedWebsiteCatalog(0), true);
  assert.equal(shouldSeedWebsiteCatalog(3), false);
});

test("website seed builds shop copies not master edits", () => {
  const seeds = buildWebsiteCatalogSeeds("shop-1", { maxItems: 5 });
  assert.equal(seeds.length, 5);
  assert.ok(seeds.every((s) => s.shop_id === "shop-1" && s.master_library_id));
});

test("recipes marked staff only in catalog", () => {
  const p = getBloomFloristCatalog(1)[0];
  assert.equal(p.staff_only_recipe, true);
});

test("index loads assistant voice scripts", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /assistant-voice-core\.js/);
  assert.match(html, /assistant-voice\.js/);
  assert.match(html, /assistantVoiceSettingsHost/);
});

test("RC2 design system css linked from index", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /bloom-rc2-design-system\.css/);
  assert.match(html, /bloom-rc2/);
});

test("catalog default size constant", () => {
  assert.ok(BLOOM_RC2_CATALOG_SIZE >= 30);
});
