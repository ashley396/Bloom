import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { groupListingsForComparison } from "../netlify/functions/_shared/marketplace-products.js";

const root = process.cwd();

test("groupListingsForComparison groups by variety, sorts each group by price ascending", () => {
  const items = [
    { id: "a", shop_id: "s1", variety: "Quicksand", product_name: "Quicksand Rose", price: 3, supplier_name: "Supplier A" },
    { id: "b", shop_id: "s2", variety: "Quicksand", product_name: "Quicksand Rose", price: 2, supplier_name: "Supplier B" },
    { id: "c", shop_id: "s3", variety: "Quicksand", price: 2.5, supplier_name: "Supplier C" },
  ];
  const groups = groupListingsForComparison(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, "quicksand");
  assert.equal(groups[0].seller_count, 3);
  assert.deepEqual(groups[0].items.map((i) => i.id), ["b", "c", "a"]);
});

test("groupListingsForComparison falls back to product name when variety isn't set, and reports a real seller_count of 1 rather than hiding a single-seller result", () => {
  const groups = groupListingsForComparison([
    { id: "x", shop_id: "s1", product_name: "White Hydrangea", price: 4 },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, "white hydrangea");
  assert.equal(groups[0].seller_count, 1);
});

test("groupListingsForComparison never invents a group for an item with no name at all", () => {
  assert.deepEqual(groupListingsForComparison([{ id: "y", shop_id: "s1", price: 1 }]), []);
  assert.deepEqual(groupListingsForComparison([]), []);
});

test("marketplace-catalog.js only computes comparison groups during an active search, and only surfaces groups with more than one real seller", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  assert.match(src, /groupListingsForComparison/);
  assert.match(src, /hasActiveSearch\s*=\s*Boolean\(q \|\| varietyFilter\)/);
  assert.match(src, /filter\(\(group\) => group\.seller_count > 1\)/);
});

test("buyer marketplace UI renders a real compare-suppliers section from backend data, not a client-side fabrication", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  assert.match(js, /function compareSectionHtml/);
  assert.match(js, /state\.compare = data\.compare/);
  assert.match(js, /marketplace-compare-row/);

  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /id="marketplaceCompareSection"/);
});
