import test from "node:test";
import assert from "node:assert/strict";
import { parseMarketplaceCsv, marketplaceCsvTemplate } from "../netlify/functions/_shared/marketplace-csv.js";

// marketplace-csv.js had only 75.3% coverage despite being the actual
// parser behind a wholesaler's real bulk-catalog upload — a quoting bug
// here silently drops or mangles rows the seller thinks they uploaded.

test("parseMarketplaceCsv: a well-formed CSV with required columns parses cleanly with no errors", () => {
  const csv = "product_name,price\nGarden Rose,24.50\nTulip Bunch,12.00";
  const result = parseMarketplaceCsv(csv);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].product_name, "Garden Rose");
  assert.equal(result.rows[0].price, "24.50");
});

test("parseMarketplaceCsv: header matching is case-insensitive", () => {
  const csv = "Product_Name,PRICE\nRose,10";
  const result = parseMarketplaceCsv(csv);
  assert.equal(result.valid, true);
});

test("parseMarketplaceCsv: empty input is rejected with a clear error, not an empty-but-'valid' result", () => {
  assert.deepEqual(parseMarketplaceCsv(""), { valid: false, errors: ["CSV is empty."], headers: [], rows: [] });
  assert.deepEqual(parseMarketplaceCsv(), { valid: false, errors: ["CSV is empty."], headers: [], rows: [] });
});

test("parseMarketplaceCsv: missing a required column is caught before any row is even parsed", () => {
  const result = parseMarketplaceCsv("supplier_name,sku\nAcme,SKU-1");
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /Missing required columns: product_name, price/);
  assert.deepEqual(result.rows, []);
});

test("parseMarketplaceCsv: a row missing product_name or with a bad price is flagged by row number, not silently dropped", () => {
  const csv = "product_name,price\n,10\nRose,-5\nTulip,not-a-number";
  const result = parseMarketplaceCsv(csv);
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors[0], /^Row 2:.*product_name is required/);
  assert.match(result.errors[1], /^Row 3:.*non-negative/);
  assert.match(result.errors[2], /^Row 4:.*non-negative/);
});

test("parseMarketplaceCsv: a zero price is valid (not treated as missing/falsy)", () => {
  const result = parseMarketplaceCsv("product_name,price\nFree Sample,0");
  assert.equal(result.valid, true);
});

test("parseMarketplaceCsv: quoted fields with embedded commas and escaped quotes are parsed correctly, not split apart", () => {
  const csv = 'product_name,price,description\n"Roses, Mixed",15,"She said ""wow""."';
  const result = parseMarketplaceCsv(csv);
  assert.equal(result.valid, true);
  assert.equal(result.rows[0].product_name, "Roses, Mixed");
  assert.equal(result.rows[0].description, 'She said "wow".');
});

test("parseMarketplaceCsv: blank lines (including trailing ones) are ignored, not parsed as empty rows", () => {
  const csv = "product_name,price\n\nRose,10\n\n\n";
  const result = parseMarketplaceCsv(csv);
  assert.equal(result.rows.length, 1);
});

test("parseMarketplaceCsv: a present category column is normalized alongside the raw value", () => {
  const csv = "product_name,price,category\nRose,10,fresh flowers";
  const result = parseMarketplaceCsv(csv);
  assert.equal(result.rows[0].category, "fresh flowers");
  assert.ok(result.rows[0].category_normalized, "a normalized category must be attached when category is present");
});

test("parseMarketplaceCsv: no category column means no category_normalized is fabricated", () => {
  const csv = "product_name,price\nRose,10";
  const result = parseMarketplaceCsv(csv);
  assert.equal(result.rows[0].category_normalized, undefined);
});

test("marketplaceCsvTemplate: is itself a valid CSV that would round-trip through the parser cleanly", () => {
  const template = marketplaceCsvTemplate();
  const result = parseMarketplaceCsv(template);
  assert.equal(result.valid, true, `the shipped template must itself pass validation: ${result.errors.join(", ")}`);
  assert.equal(result.rows.length, 1);
});
