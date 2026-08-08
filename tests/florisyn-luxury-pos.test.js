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
  assert.match(html, /VIP GOLD/);
  assert.match(html, /Clara Kensington/);
  assert.match(html, /4,300 pts/);
  assert.match(html, /VIPGOLD10/);
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
});

test("luxury POS category shortcuts match Figma labels", () => {
  for (const label of [
    "Bright Bouquets",
    "Contemporary",
    "Funeral & Sympathy",
    "Romance Specials",
    "Seasonal Harvest",
    "Tropical Paradise",
    "Hand-Tied Stems",
    "Luxury Vase",
    "Wedding Bouquets",
    "Dried & Preserved",
    "Gifts & Add-ons",
    "Custom Mix"
  ]) {
    assert.match(posJs, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(html, /Customize Shortcuts/);
});

test("luxury POS palette uses navy and rose without green CTAs", () => {
  assert.match(css, /#1a1f3c/);
  assert.match(css, /#e06b85/i);
  assert.match(css, /#fbf6f7/i);
  assert.match(css, /#26263a/i);
  assert.match(css, /pos-lux-main-row/);
  assert.match(css, /flex:\s*0\s+0\s+52px/);
  assert.match(css, /340px/);
  assert.match(css, /grid-template-columns:\s*repeat\(4,\s*1fr\)/);
  assert.match(css, /height:\s*56px/);
  assert.match(css, /#bloomDaisy/);
  assert.match(html, /pos-lux-main-row/);
  assert.match(html, /Luxury Catalog Categories/);
  assert.doesNotMatch(css, /\.pos-lux-charge[^{]*\{[^}]*#547428/i);
  assert.doesNotMatch(css, /background:\s*#547428|background:\s*#486329/i);
});

test("POS cart rendering uses Figma columns and VIP discount math", () => {
  assert.match(appJs, /ITEM DESCRIPTION/);
  assert.match(appJs, /UNIT PRICE/);
  assert.match(appJs, /LINE TOTAL/);
  assert.match(appJs, /VIPGOLD10/);
  assert.match(appJs, /POS_LUX_SERVICE_FEE\s*=\s*15/);
  assert.match(appJs, /Blush Serenity Bouquet/);
  assert.match(appJs, /window\.renderPosCart\s*=\s*renderPosCart/);
  assert.match(appJs, /florisyn-pos-discount-apply/);
  assert.match(appJs, /cartSubtotal/);
  assert.match(appJs, /cartTotal/);
});
