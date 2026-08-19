import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test("reorderPreview re-checks the seller's CURRENT verification status, not just active/availability — a seller who lost verification since the original purchase is no longer reorderable", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  const fn = src.slice(src.indexOf("async function reorderPreview"), src.indexOf("async function submitSellerReview"));
  assert.match(fn, /verifiedShopIds = await loadVerifiedSellerShopIds\(\(listings \|\| \[\]\)\.map\(\(row\) => row\.shop_id\)\)/);
  assert.match(fn, /stillAvailable\s*=\s*Boolean\(current\)\s*&&\s*current\.active\s*&&\s*current\.currently_available\s*&&\s*verifiedShopIds\.has\(current\.shop_id\)/);
});
