import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/florisyn-luxury-pos.css"), "utf8");
const posJs = fs.readFileSync(path.join(root, "public/florisyn-luxury-pos.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

test("luxury POS shell and assets are wired", () => {
  assert.match(html, /florisynPosLux/);
  assert.match(html, /florisyn-pos-lux/);
  assert.match(html, /florisyn-luxury-pos\.css/);
  assert.match(html, /florisyn-luxury-pos\.js/);
  assert.match(html, /Main Counter Register #1/);
  assert.match(html, /Scanner Ready/);
  assert.match(html, /By Product/);
  assert.match(html, /By Customer/);
  assert.match(html, /Active Transaction Basket/);
  assert.match(html, /ASSIGNED CUSTOMER/);
  assert.match(html, /Walk-in Customer/);
  assert.match(html, /Charge Card/);
  assert.match(html, /Accept Cash Payment/);
  assert.match(html, /Split Payment/);
  assert.match(html, /Hold Order/);
  assert.match(html, /Register Online/);
  assert.match(html, /REG-MAIN-001/);
  assert.match(html, /id="cartSubtotal"/);
  assert.match(html, /id="cartTotal"/);
  assert.match(html, /id="queue"/);
  assert.match(html, /id="clearCartBtn"/);
  assert.match(html, /id="productPadGrid"/);
  assert.match(html, /Scan or select items to begin a sale/);
  assert.doesNotMatch(html, /id="posLuxSearch"/);
});

test("luxury POS category shortcuts use signature library photography", () => {
  for (const label of [
    "Bright Bouquets",
    "Contemporary",
    "Funeral & Sympathy",
    "Romance Specials",
    "Seasonal Harvest",
    "Tropical Paradise",
    "Hand-Tied Stems",
    "Luxury Vase"
  ]) {
    assert.match(posJs, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(posJs, /\/assets\/floral-library\//);
  assert.match(html, /Customize Shortcuts/);
  const posStart = html.indexOf('id="posPage"');
  const posChunk = html.slice(posStart, html.indexOf("</section>", posStart));
  assert.match(posChunk, /florisyn-everyday-sunny-bouquet\.jpg/);
  assert.doesNotMatch(posChunk, /\/assets\/pink-bouquet\.jpg/);
});

test("luxury POS palette uses navy and rose without green CTAs", () => {
  assert.match(css, /#1a1f3c/);
  assert.match(css, /#e06b85/i);
  assert.match(css, /#fbf6f7/i);
  assert.match(css, /#26263a/i);
  assert.match(css, /pos-lux-main-row/);
  assert.match(css, /flex:\s*0\s+0\s+68px/);
  assert.match(css, /340px/);
  assert.match(css, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /grid-template-rows:\s*repeat\(2,\s*56px\)/);
  assert.match(css, /height:\s*56px/);
  assert.match(css, /#bloomDaisy/);
  assert.match(html, /pos-lux-main-row/);
  assert.match(html, /Luxury Catalog Categories/);
  assert.match(html, /florisyn-pos-critical/);
  assert.match(html, /florisyn-luxury-pos\.css\?v=pos8/);
  assert.match(html, /cartSubtotal">\$0\.00/);
  assert.match(html, /cartTotal">\$0\.00/);
  assert.match(html, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(html, /pos-lux-fmark/);
  assert.match(html, /ID: REG-MAIN-001/);
  assert.match(html, /<small>CART<\/small>/);
  assert.equal((html.match(/class="pos-lux-cat(?:\s|")/g) || []).length, 8);
  assert.doesNotMatch(css, /\.pos-lux-charge[^{]*\{[^}]*#547428/i);
  assert.doesNotMatch(css, /background:\s*#547428|background:\s*#486329/i);
});

test("POS cart rendering uses Figma columns and VIP discount math", () => {
  assert.match(appJs, /ITEM DESCRIPTION/);
  assert.match(appJs, /UNIT PRICE/);
  assert.match(appJs, /LINE TOTAL/);
  assert.match(appJs, /VIPGOLD10/);
  assert.match(appJs, /POS_LUX_SERVICE_FEE\s*=\s*15/);
  assert.match(appJs, /window\.renderPosCart\s*=\s*renderPosCart/);
  assert.match(appJs, /florisyn-pos-discount-apply/);
  assert.match(appJs, /cartSubtotal/);
  assert.match(appJs, /cartTotal/);
});
