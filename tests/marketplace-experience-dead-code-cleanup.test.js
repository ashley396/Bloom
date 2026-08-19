import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// marketplace-experience.js used to carry a second, complete seller
// dashboard (loadSellerDashboard/bindSellerDashboard) mounted at
// #marketplaceSellerDashboard — but the real "Sell" tab markup in
// index.html was replaced with a stub that just links to the dedicated
// wholesaleSellerPage, so nothing ever called it. It was pure dead code:
// a second, drifted copy of the seller product/profile/CSV UI that could
// never run, easy to mistake for live functionality, and missing
// features (like Specials) the real dashboard has. This asserts it stays
// gone rather than silently creeping back in.

test("marketplace-experience.js no longer carries the unreachable duplicate seller dashboard", () => {
  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  assert.doesNotMatch(js, /function loadSellerDashboard/);
  assert.doesNotMatch(js, /function bindSellerDashboard/);
  // These ids only ever existed inside that dead function's own
  // innerHTML template — real ones live in wholesale-seller-dashboard.js
  // under different names (wholesaleProfileForm, etc.), not these.
  for (const id of ["sellerDisplayName", "sellerBio", "sellerMinOrder", "sellerCsvTemplate", "sellerCsvValidate", "sellerCsvImport"]) {
    assert.doesNotMatch(js, new RegExp(id), `${id} should no longer appear — it only existed in the removed dead code`);
  }
});

test("the Sell tab's real markup is the honest stub pointing at the dedicated wholesale seller dashboard, not a second seller UI", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const idx = html.indexOf('id="marketplaceSellerDashboard"');
  assert.ok(idx !== -1, "the stub mount point must still exist");
  const block = html.slice(idx, idx + 300);
  assert.match(block, /Manage your storefront in the dedicated seller dashboard/);
  assert.match(block, /data-page="wholesaleSellerPage"/);
});

test("the real, live seller dashboard (wholesale-seller-dashboard.js) is what the Sell tab's button actually reaches, and it has the Specials section the dead copy never had", () => {
  const js = fs.readFileSync(path.join(root, "public/wholesale-seller-dashboard.js"), "utf8");
  assert.match(js, /\['specials', 'Specials'\]/);
});
