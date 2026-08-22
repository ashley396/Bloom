import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

/**
 * Section 17 of the SEO/GEO brief: a glossary "only if it improves the
 * site." Built to tie together terminology already scattered across the
 * pricing, inventory, delivery, flower-care, and wedding content this
 * initiative already shipped, with real DefinedTermSet/DefinedTerm
 * structured data and cross-links in both directions.
 */

const TERMS = [
  "AOV (Average Order Value)", "COGS (Cost of Goods Sold)", "Delivery zone",
  "Event order", "Markup", "Online ordering", "POS (Point of Sale)",
  "Recipe costing", "Shrink / waste", "Standing order", "Stem count",
  "Substitution", "Vase life", "Wedding proposal", "Wire service",
];

test("the glossary page exists and defines every term from the brief", () => {
  const html = fs.readFileSync(path.join(root, "public/resources/florist-glossary/index.html"), "utf8");
  for (const term of TERMS) {
    assert.match(html, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing term: ${term}`);
  }
});

test("the glossary carries real DefinedTermSet structured data, not just an FAQ", () => {
  const html = fs.readFileSync(path.join(root, "public/resources/florist-glossary/index.html"), "utf8");
  const block = html.match(/<script type="application\/ld\+json">(\{"@context": "https:\/\/schema\.org", "@type": "DefinedTermSet".*?)<\/script>/s);
  assert.ok(block, "expected a DefinedTermSet JSON-LD block");
  const parsed = JSON.parse(block[1]);
  assert.equal(parsed.hasDefinedTerm.length, TERMS.length);
});

test("Florisyn's standing-order feature is described accurately, not conflated with a customer-facing feature it doesn't have", () => {
  const html = fs.readFileSync(path.join(root, "public/resources/florist-glossary/index.html"), "utf8");
  assert.match(html, /wholesale-buying side of the marketplace/);
  assert.match(html, /not yet a customer-facing recurring-delivery feature/);
});

test("the /resources hub links to the glossary", () => {
  const html = fs.readFileSync(path.join(root, "public/resources/index.html"), "utf8");
  assert.match(html, /href="\/resources\/florist-glossary\/">Florist Business Glossary</);
});

test("real content pages link back to the glossary, not just the glossary linking out", () => {
  const files = [
    "public/resources/how-to-price-floral-arrangements/index.html",
    "public/floral-inventory-software/index.html",
    "public/florist-delivery-software/index.html",
    "public/resources/flower-care-basics/index.html",
    "public/wedding-florist-software/index.html",
    "public/florist-pos/index.html",
    "public/online-flower-shop/index.html",
    "public/resources/wedding-season-planning/index.html",
  ];
  for (const f of files) {
    const html = fs.readFileSync(path.join(root, f), "utf8");
    assert.match(html, /href="\/resources\/florist-glossary\/"/, `${f} should link to the glossary`);
  }
});

test("sitemap.xml includes the glossary", () => {
  const xml = fs.readFileSync(path.join(root, "public/sitemap.xml"), "utf8");
  assert.match(xml, /https:\/\/www\.florisyn\.com\/resources\/florist-glossary\//);
});
