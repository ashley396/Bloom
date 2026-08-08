import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/florisyn-luxury-library.css"), "utf8");
const js = fs.readFileSync(path.join(root, "public/florisyn-luxury-library.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

const NAMES = [
  "Everyday Rose Mix",
  "Sunshine Daisy Vase",
  "Hydrangea Breeze",
  "Everyday Carnation Bundle",
  "Stock & Rose Garden",
  "Alstroemeria Everyday Mix",
  "Sunflower Smile",
  "Mini Mum Cube",
  "Everyday Mixed Vase",
  "Lavender Stock Jar",
  "Everyday Tulip Bundle",
  "Peach Rose Posy",
  "Everyday Garden Mix",
  "Daisy & Carnation Cheer",
  "Everyday Orchid Stem",
  "Everyday Basket Mix",
  "Pink Mum & Rose Cube",
  "Everyday Green & White",
  "Everyday Mixed Wrap",
  "Mini Rose Jar",
  "Spring Spray Bucket"
];

test("floral library page shell and assets are wired", () => {
  assert.match(html, /id="libraryPage"/);
  assert.match(html, /florisyn-lux-library/);
  assert.match(html, /florisyn-luxury-library\.css\?v=lib2/);
  assert.match(html, /florisyn-luxury-library\.js\?v=lib2/);
  assert.match(html, /Browse and add pre-designed recipes/);
  assert.match(html, /All Arrangements/);
  assert.match(html, /id="librarySearch"/);
  assert.match(html, /id="libraryList"/);
  assert.match(html, /Search library\.\.\./);
  assert.match(html, /Sort: Popular/);
  assert.match(appJs, /FlorisynLuxuryLibrary\?\.boot/);
});

test("catalog includes all 21 Figma arrangements", () => {
  for (const name of NAMES) {
    assert.match(js, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal((js.match(/id:\s*"/g) || []).length, 21);
  assert.match(js, /Add to My Shop/);
  assert.match(js, /Add as Draft/);
  assert.match(js, /\/images\/library\/everyday-rose-mix\.jpg/);
  assert.ok(fs.existsSync(path.join(root, "public/images/library/everyday-rose-mix.jpg")));
  assert.ok(fs.existsSync(path.join(root, "public/images/library/spring-spray-bucket.jpg")));
});

test("library palette uses navy and rose CTAs without green primary buttons", () => {
  assert.match(css, /#1a1f3c/);
  assert.match(css, /#e06b85/i);
  assert.match(css, /lux-lib-grid/);
  assert.match(css, /repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.lux-lib-add/);
  assert.match(css, /\.lux-lib-draft/);
  assert.match(css, /\.lux-lib-body/);
  assert.match(css, /display:\s*flex\s*!important/);
  assert.match(css, /aside#atelierSidebarDrawer/);
  assert.doesNotMatch(css, /\.lux-lib-add[^{]*\{[^}]*#547428/i);
  assert.doesNotMatch(css, /background:\s*#547428|background:\s*#486329/i);
});

test("every catalog card image file exists and sources are documented", () => {
  const dir = path.join(root, "public/images/library");
  const sources = fs.readFileSync(path.join(dir, "UNSPLASH_SOURCES.txt"), "utf8");
  assert.match(sources, /unsplash\.com/);
  for (const name of NAMES) {
    const slug = name
      .toLowerCase()
      .replace(/&/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const file = path.join(dir, `${slug}.jpg`);
    assert.ok(fs.existsSync(file), `missing ${slug}.jpg`);
    assert.ok(fs.statSync(file).size > 8000, `${slug}.jpg too small`);
    assert.match(sources, new RegExp(`${slug}\\.jpg`));
  }
});
