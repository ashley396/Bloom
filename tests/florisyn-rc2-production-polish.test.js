import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PUBLIC = join(ROOT, "public");

const FORBIDDEN =
  /\b(pizza|burger|coffee|cupcake|restaurant order|grocery|sushi|taco|latte|espresso|lorem ipsum|john doe|acme inc)\b/i;
const VAGUE_RECIPE = /\b(mixed flowers|seasonal blooms)\b/i;

function extractLibraryBlock(source) {
  const start = source.indexOf("const LIBRARY=[");
  assert.ok(start >= 0, "LIBRARY fallback must exist");
  const end = source.indexOf("];", start);
  return source.slice(start, end + 2);
}

describe("Florisyn RC2 production polish", () => {
  it("LIBRARY fallback uses florist-specific names and recipes", () => {
    const app = readFileSync(join(PUBLIC, "app.js"), "utf8");
    const block = extractLibraryBlock(app);
    assert.doesNotMatch(block, FORBIDDEN);
    assert.doesNotMatch(block, /Garden Harmony/);
    assert.doesNotMatch(block, VAGUE_RECIPE);
    assert.match(block, /Classic Hydrangea Cube/);
    assert.match(block, /White Standing Spray/);
    assert.match(block, /Leatherleaf/);
  });

  it("LIBRARY fallback avoids duplicate arrangement photos", () => {
    const app = readFileSync(join(PUBLIC, "app.js"), "utf8");
    const urls = [...app.matchAll(/https:\/\/images\.pexels\.com\/photos\/\d+/g)].map((m) => m[0]);
    const libStart = app.indexOf("const LIBRARY=[");
    const libEnd = app.indexOf("];", libStart);
    const libUrls = [...app.slice(libStart, libEnd).matchAll(/https:\/\/images\.pexels\.com\/photos\/\d+/g)].map(
      (m) => m[0],
    );
    assert.equal(new Set(libUrls).size, libUrls.length, "duplicate photos in LIBRARY fallback");
    assert.ok(urls.length >= libUrls.length);
  });

  it("Website Studio copy uses licensed floral photography wording", () => {
    const html = readFileSync(join(PUBLIC, "index.html"), "utf8");
    assert.match(html, /Licensed floral photography/);
    assert.doesNotMatch(html, /Stock placeholders are served/);
    assert.doesNotMatch(html, /Professional stock placeholders/i);
  });

  it("floral library UI guards against duplicate search listeners", () => {
    const ui = readFileSync(join(PUBLIC, "floral-library-ui.js"), "utf8");
    assert.match(ui, /libraryUiBound/);
    assert.match(ui, /if \(!libraryUiBound\)/);
  });

  it("wholesale CSV sample uses florist grower naming", () => {
    const csv = readFileSync(join(ROOT, "netlify/functions/_shared/marketplace-csv.js"), "utf8");
    assert.match(csv, /Sunrise Rose Farms/);
    assert.doesNotMatch(csv, /Acme Growers/);
  });
});
