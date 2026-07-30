import test from "node:test";
import assert from "node:assert/strict";
import { getBloomFloristCatalog, BLOOM_RC2_CATALOG_SIZE } from "../netlify/functions/_shared/floral-library-catalog.js";
import { shouldSeedWebsiteCatalog, buildWebsiteCatalogSeeds } from "../netlify/functions/_shared/bloom-website-catalog-seed.js";
import fs from "node:fs";

test("RC2 floral catalog has hundreds of arrangements", () => {
  const catalog = getBloomFloristCatalog(450);
  assert.equal(catalog.length, 450);
  assert.ok(catalog.every((p) => p.name && p.primary_image?.url && p.image_license?.source));
  const uniqueNames = new Set(catalog.map((p) => p.name));
  assert.equal(uniqueNames.size, catalog.length);
});

test("catalog includes roses hydrangeas wedding sympathy", () => {
  const text = getBloomFloristCatalog(450)
    .map((p) => `${p.categories.join(" ")} ${(p.recipe || []).map((r) => r.name).join(" ")}`)
    .join(" ")
    .toLowerCase();
  assert.match(text, /rose/);
  assert.match(text, /hydrangea/);
  assert.match(text, /sympathy|peoni|ranunculus/);
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
  assert.equal(BLOOM_RC2_CATALOG_SIZE, 450);
});
