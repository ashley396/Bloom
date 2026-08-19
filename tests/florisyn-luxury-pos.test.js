import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/florisyn-luxury-pos.css"), "utf8");
const posJs = fs.readFileSync(path.join(root, "public/florisyn-luxury-pos.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

// This file was rewritten 2026-08-14 against the owner-approved POS reskin
// (plain language, real product-photo tiles, no register jargon/fake demo
// chrome) — see [[florisyn-pos-redesign]] in project memory. The previous
// version of these tests asserted the *pre-redesign* markup ("Main Counter
// Register #1", "Scanner Ready", 8 decorative category images, a hardcoded
// VIPGOLD10 discount code, etc.) and had been silently failing in CI since
// that work landed, because nobody had gone back to update the fixtures.

test("luxury POS shell and assets are wired", () => {
  assert.match(html, /florisynPosLux/);
  assert.match(html, /florisyn-pos-lux/);
  assert.match(html, /florisyn-luxury-pos\.css/);
  assert.match(html, /florisyn-luxury-pos\.js/);
  // Register jargon/fake chrome from the old design must stay gone. (A
  // "Register ID: REG-MAIN-001" line legitimately still exists elsewhere,
  // in a shift/cash-drawer reconciliation panel — a real, separate
  // feature, not the register-jargon chrome this checks for.)
  assert.doesNotMatch(html, /Main Counter Register #1/);
  assert.doesNotMatch(html, /Scanner Ready/);
  assert.doesNotMatch(html, /Register Online/);
  assert.match(html, /By Product/);
  assert.match(html, /By Customer/);
  assert.match(html, />Cart</);
  assert.match(html, />CUSTOMER</);
  assert.match(html, /Walk-in Customer/);
  assert.match(html, /Charge Card/);
  assert.match(html, /Accept Cash Payment/);
  assert.match(html, /Split Payment/);
  assert.match(html, /Hold Order/);
  assert.match(html, /id="cartSubtotal"/);
  assert.match(html, /id="cartTotal"/);
  assert.match(html, /id="queue"/);
  assert.match(html, /id="clearCartBtn"/);
  assert.match(html, /id="productPadGrid"/);
  assert.match(html, /Scan or select items to begin a sale/);
  // Approved-mockup gap closed 2026-08-14: product search/lookup bar.
  assert.match(html, /id="posProductSearch"/);
  assert.match(html, /id="posCatTabs"/);
});

test("luxury POS product tiles use real local photos, not decorative category images", () => {
  // The old decorative "Luxury Catalog Categories" image grid was replaced
  // by real product-tile photography + a plain category-tab filter.
  assert.doesNotMatch(html, /Luxury Catalog Categories/);
  assert.match(html, /Customize Shortcuts/);
  assert.match(appJs, /DEFAULT_POS_TILES\s*=\s*\[/);
  assert.match(appJs, /function renderPosCatTabs/);
  assert.match(appJs, /function renderPosTiles/);
  // Tile photos are local, optimized jpgs — not the garbled-AI-text pngs
  // from the original batch, and not hotlinked externally.
  const tilesBlockMatch = appJs.match(/const DEFAULT_POS_TILES=\[[\s\S]*?\];/);
  assert.ok(tilesBlockMatch, "DEFAULT_POS_TILES array must be present");
  const tilesBlock = tilesBlockMatch[0];
  assert.doesNotMatch(tilesBlock, /\/assets\/[a-z0-9-]+\.png/i, "tile photos must not be the old garbled-text .png batch");
  assert.match(tilesBlock, /\/assets\/fresh\.jpg/);
  for (const file of ["fresh", "basket", "rose-arr", "tulips", "chocolates", "corsage", "boutonniere", "sympathy", "spray", "basket2", "plant", "orchid", "green", "dish"]) {
    assert.ok(
      fs.existsSync(path.join(root, "public/assets", `${file}.jpg`)),
      `expected public/assets/${file}.jpg to exist on disk`
    );
  }
});

test("luxury POS palette uses navy and rose without green CTAs", () => {
  assert.match(css, /#1a1f3c/);
  assert.match(css, /#e06b85/i);
  assert.match(css, /#fbf6f7/i);
  assert.match(css, /#26263a/i);
  assert.match(css, /pos-lux-main-row/);
  assert.match(css, /flex:\s*0\s+0\s+68px/);
  assert.match(css, /340px/);
  assert.match(css, /#bloomDaisy/);
  assert.match(html, /pos-lux-main-row/);
  assert.match(html, /florisyn-pos-critical/);
  // Cache-busted, but the exact version number is expected to change with
  // every real edit — assert the pattern, not a specific generation.
  assert.match(html, /florisyn-luxury-pos\.css\?v=pos\d+/);
  assert.match(html, /cartSubtotal">\$0\.00/);
  assert.match(html, /cartTotal">\$0\.00/);
  assert.match(html, /pos-lux-fmark/);
  assert.match(css, /padding:\s*0 12px 12px 0/);
  assert.match(css, /pos-lux-pay-actions/);
  assert.match(css, /flex:\s*0\s+0\s+auto/);
  assert.doesNotMatch(css, /\.pos-lux-charge[^{]*\{[^}]*#547428/i);
  assert.doesNotMatch(css, /background:\s*#547428|background:\s*#486329/i);
  // Decorative desktop chrome removed this session and confirmed gone by the
  // owner (statusbar covering the checkout button, non-functional rail
  // labels, register ID chip).
  assert.doesNotMatch(html, /ID: REG-MAIN-001/);
  assert.doesNotMatch(html, /<small>CART<\/small>/);
});

test("POS cart rendering uses the plain-language column layout with no fake demo data", () => {
  assert.match(appJs, /ITEM DESCRIPTION/);
  assert.match(appJs, /UNIT PRICE/);
  assert.match(appJs, /LINE TOTAL/);
  assert.match(appJs, /window\.renderPosCart\s*=\s*renderPosCart/);
  assert.match(appJs, /florisyn-pos-discount-apply/);
  assert.match(appJs, /cartSubtotal/);
  assert.match(appJs, /cartTotal/);
  // Demo/fake data removed (task: "Remove POS demo/fake data") must stay
  // removed — a hardcoded discount code and a fabricated service-fee
  // constant with no basis in real shop settings.
  assert.doesNotMatch(appJs, /VIPGOLD10/);
  assert.doesNotMatch(appJs, /POS_LUX_SERVICE_FEE\s*=\s*15/);
});
