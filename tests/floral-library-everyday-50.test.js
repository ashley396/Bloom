import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getPublicFloralLibraryCatalog
} from "../netlify/functions/_shared/floral-library-core.js";
import {
  getEverydayFloralLibraryCatalog,
  EVERYDAY_FLORAL_ARRANGEMENTS
} from "../netlify/functions/_shared/floral-library-everyday-50.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(path.join(root, "../public/data/floral-library-everyday-50.json"), "utf8"));

const REQUIRED_NAMES = [
  "Sunshine Cube",
  "Pink Meadow",
  "Classic Rose Mix",
  "Cheerful Daisy Burst",
  "Everyday Hydrangea Pop",
  "Soft Blush Garden",
  "Rustic Mason Jar Mix",
  "Bright & Happy",
  "Simple Whites",
  "Everyday Elegance",
  "Morning Cheer",
  "Fresh Start",
  "Daily Delight",
  "Lavender Breeze",
  "Peachy Keen",
  "Hydrangea & Friends",
  "Rose & Mum Harmony",
  "Alstroemeria Joy",
  "Sunflower Smile",
  "Gentle Pastels",
  "Modern Whites",
  "Compact Color Pop",
  "Everyday Pink Mix",
  "Blue & White Classic",
  "Sweet & Simple",
  "Daily Sunshine",
  "Soft Spring Mix",
  "Everyday Garden Vase",
  "Bright Market Bunch",
  "Calm & Clean Whites",
  "Pink & Peach Harmony",
  "Hydrangea Trio",
  "Rose & Daisy Blend",
  "Everyday Mason Jar",
  "Simple Greens & Whites",
  "Happy Day Bouquet",
  "Classic Cylinder Mix",
  "Everyday Color Burst",
  "Soft Neutral Mix",
  "Pink Petal Jar",
  "Golden Glow",
  "Everyday Blush",
  "Daisy & Mum Mix",
  "Rose Trio",
  "Hydrangea Accent",
  "Everyday Rustic",
  "Bright Tabletop",
  "Simple Cheer",
  "Daily Pink Rose",
  "Everyday Florist Favorite"
];

const ALLOWED_FLOWERS = new Set([
  "roses",
  "carnations",
  "daisies",
  "mums",
  "alstroemeria",
  "lilies",
  "sunflowers",
  "hydrangea",
  "stock",
  "snapdragons",
  "baby's breath",
  "leatherleaf",
  "pittosporum",
  "eucalyptus"
]);

test("JSON catalog has exactly 50 named everyday arrangements", () => {
  assert.equal(data.batch_size, 50);
  assert.equal(data.arrangements.length, 50);
  const names = data.arrangements.map((a) => a.name);
  assert.deepEqual(names, REQUIRED_NAMES);
});

test("server catalog exports 50 unique master products", () => {
  const catalog = getPublicFloralLibraryCatalog();
  assert.equal(catalog.length, 50);
  const ids = catalog.map((p) => p.id);
  assert.equal(new Set(ids).size, 50);
  assert.ok(ids.every((id) => id.startsWith("ed-")), "all ids use ed- prefix");
  assert.ok(!ids.some((id) => id.startsWith("sig-") || id.startsWith("lib-")), "no legacy ids");
});

test("each arrangement includes production metadata", () => {
  for (const a of EVERYDAY_FLORAL_ARRANGEMENTS) {
    assert.ok(a.style, `${a.name}: style`);
    assert.ok(a.color_palette, `${a.name}: palette`);
    assert.ok(a.container, `${a.name}: container`);
    assert.ok(a.mechanics, `${a.name}: mechanics`);
    assert.ok(Array.isArray(a.tools) && a.tools.length, `${a.name}: tools`);
    assert.ok(Array.isArray(a.instructions) && a.instructions.length >= 2, `${a.name}: instructions`);
    assert.ok(a.why_it_works, `${a.name}: why_it_works`);
    assert.ok(Array.isArray(a.recipe) && a.recipe.length, `${a.name}: recipe`);
    for (const r of a.recipe) {
      assert.ok(Number(r.qty) > 0 && Number(r.qty) <= 15, `${a.name}: realistic stem count for ${r.name}`);
    }
  }
});

test("everyday catalog uses only approved wholesale flower types", () => {
  for (const a of EVERYDAY_FLORAL_ARRANGEMENTS) {
    for (const r of a.recipe) {
      const key = String(r.name).toLowerCase();
      const ok = [...ALLOWED_FLOWERS].some((f) => key.includes(f));
      assert.ok(ok, `${a.name}: recipe line "${r.name}" must use everyday flower list`);
    }
  }
});

test("image assets exist for all 50 arrangements", () => {
  const publicDir = path.join(root, "../public");
  for (const p of getEverydayFloralLibraryCatalog()) {
    const url = p.primary_image.url;
    assert.match(url, /^\/assets\/floral-library\/everyday\/ed-/);
    const filePath = path.join(publicDir, url.replace(/^\//, ""));
    assert.ok(existsSync(filePath), `missing image for ${p.id}`);
  }
});
