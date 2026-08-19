import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadVerifiedSellerShopIds } from "../netlify/functions/marketplace-catalog.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

const root = process.cwd();

test("loadVerifiedSellerShopIds only includes shops whose owner has a real approved, non-expired verification application", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ id: "shop-approved", owner_user_id: "user-a" }, { id: "shop-pending", owner_user_id: "user-b" }, { id: "shop-none", owner_user_id: "user-c" }], error: null },
    { data: [{ user_id: "user-a", status: "approved" }, { user_id: "user-b", status: "submitted" }], error: null }
  ]);
  const verified = await loadVerifiedSellerShopIds(["shop-approved", "shop-pending", "shop-none"], { adminClient: client });
  assert.deepEqual([...verified], ["shop-approved"]);
});

test("loadVerifiedSellerShopIds fails closed (nothing verified) when the service-role client isn't configured, never treats everyone as authorized", async () => {
  const verified = await loadVerifiedSellerShopIds(["shop-1"], { adminClient: null });
  assert.deepEqual([...verified], []);
});

test("loadVerifiedSellerShopIds returns an empty set immediately for an empty input, without querying anything", async () => {
  let queried = false;
  const client = { from: () => { queried = true; return {}; } };
  const verified = await loadVerifiedSellerShopIds([], { adminClient: client });
  assert.deepEqual([...verified], []);
  assert.equal(queried, false);
});

test("marketplace-catalog.js gates the main browse list and the direct-listingId fallback via the one shared loadVerifiedSellerShopIds check, not a second parallel one", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  // loadVerifiedSellerShopIds itself (and the canPurchaseWithVerification
  // check it wraps) now lives in _shared/marketplace-verification.js, so
  // every consumer imports the same function rather than each function
  // file reinventing — or re-importing — the underlying check directly.
  assert.match(src, /import \{ loadVerifiedSellerShopIds \} from "\.\/_shared\/marketplace-verification\.js"/);
  assert.match(src, /loadVerifiedSellerShopIds\(\(data \|\| \[\]\)\.map\(\(row\) => row\.shop_id\)\)/);
  assert.match(src, /\.filter\(\(row\) => verifiedShopIds\.has\(row\.shop_id\)\)/);
  // The listingId fallback (for a direct/bookmarked link) must not bypass
  // the same gates the main list applies.
  assert.match(src, /verifiedShopIds\.has\(fallbackRow\.shop_id\)/);
});

test("loadVerifiedSellerShopIds lives in the shared verification module and reuses canPurchaseWithVerification rather than a second parallel check", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/_shared/marketplace-verification.js"), "utf8");
  const fn = src.slice(src.indexOf("export async function loadVerifiedSellerShopIds"));
  assert.match(fn, /canPurchaseWithVerification\(application\)\.allowed/);
});

test("canPurchaseWithVerification is documented as the one shared check for both buyer and seller authorization, not duplicated", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/_shared/marketplace-verification.js"), "utf8");
  const docblock = src.slice(src.indexOf("Same check used on both sides"), src.indexOf("export function canPurchaseWithVerification"));
  assert.match(docblock, /SUPPLIER[\s*]+VERIFICATION/);
});

test("seller dashboard explains the real consequence of verification status instead of a bare status word", () => {
  const js = fs.readFileSync(path.join(root, "public/wholesale-seller-dashboard.js"), "utf8");
  assert.match(js, /Your products are visible to buyers in the Wholesale Marketplace/);
  assert.match(js, /Buyers cannot see your products in the Wholesale Marketplace until your verification is approved/);
});
