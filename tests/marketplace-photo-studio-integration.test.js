import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// Wholesale Marketplace vision: "Photo Studio integration." Before this
// phase, Photo Studio only ever wrote into a florist's own retail
// products table (or Community, or a download) — a wholesale SELLER
// editing an arrangement photo had no path from Photo Studio into a real
// marketplace_listings row, and a seller looking at their own listing had
// no path back into Photo Studio to touch it up. Both directions mirror
// the existing, already-shipped Community <-> Photo Studio handoff
// (window.BloomShotLoadImage / fetchPostImageDataUrl) rather than
// inventing a second pattern.

// --- Photo Studio -> Marketplace ------------------------------------

test("the bloomshot 'Post to' block offers a real Wholesale Marketplace destination, honestly labeled as a draft", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const idx = html.indexOf("shotPostWebsite");
  const block = html.slice(idx, idx + 600);
  assert.match(block, /id="shotPostMarketplace"/);
  assert.match(block, /saved as a draft listing for you to review/i);
});

test("shotSaveToMarketplace reuses the real save-product action (never a second write path) and ALWAYS saves as a draft, regardless of the Website/Community destinations going live immediately", () => {
  const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const fn = js.slice(js.indexOf("async function shotSaveToMarketplace"), js.indexOf("async function shotSaveToMarketplace") + 900);
  assert.match(fn, /action:"save-product"/);
  assert.match(fn, /marketplace-seller/);
  assert.match(fn, /publish_status:"draft"/);
  assert.doesNotMatch(fn, /publish_status:"published"/, "must never silently publish a wholesale listing straight to buyers");
  assert.match(fn, /if\(!name\)throw new Error/, "a real product name is required, same as the existing retail-product save");
});

test("shotSaveToMarketplace edits the SAME draft listing on a repeat Post click instead of creating a duplicate every time", () => {
  const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(js, /shotSavedListingId=null/, "a fresh photo must reset the tracked listing id");
  const fn = js.slice(js.indexOf("async function shotSaveToMarketplace"), js.indexOf("async function shotSaveToMarketplace") + 900);
  assert.match(fn, /id:shotSavedListingId\|\|undefined/);
  assert.match(fn, /if\(product\?\.id\)shotSavedListingId=product\.id/);
});

test("shotSavedListingId is reset alongside shotSavedProductId at every 'new photo' point — file upload, remove-photo, and handoff load — never left stale from a previous listing", () => {
  const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const resets = js.match(/shotSavedProductId=null;shotSavedListingId=null;/g) || [];
  // file upload handler, handoff loader (loadShotImageFromDataUrl), remove-photo handler, and the saved-draft restore-on-load path.
  assert.ok(resets.length >= 4, `expected at least 4 reset sites, found ${resets.length}`);
});

test("the marketplace checkbox is included in the 'choose at least one destination' guard and the done/failed reporting, not silently ignored", () => {
  const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const fn = js.slice(js.indexOf('$("#shotPost")?.addEventListener'), js.indexOf('$("#shotPost")?.addEventListener') + 2200);
  assert.match(fn, /toMarketplace=\$\("#shotPostMarketplace"\)\?\.checked/);
  assert.match(fn, /!toWebsite&&!toCommunity&&!toMarketplace&&!toSocial/);
  assert.match(fn, /if\(toMarketplace\)\{try\{await shotSaveToMarketplace\(\)/);
  assert.match(fn, /done\.push\("Wholesale Marketplace \(draft\)"\)/);
  assert.match(fn, /failed\.push\(`Wholesale Marketplace/);
});

// --- Marketplace -> Photo Studio ------------------------------------

test("a seller's listing card offers a real 'Edit in Photo Studio' action only when the listing actually has a photo", () => {
  const js = fs.readFileSync(path.join(root, "public/wholesale-seller-dashboard.js"), "utf8");
  const fn = js.slice(js.indexOf("function renderProducts"), js.indexOf("function renderProducts") + 1600);
  assert.match(fn, /p\.image_url \? `<button type="button" class="secondary" data-wholesale-edit-in-studio="\$\{hooks\.esc\(p\.id\)\}">/);
});

test("Edit in Photo Studio reuses the SAME window.BloomShotLoadImage hook Community already uses — not a second, divergent handoff mechanism", () => {
  const js = fs.readFileSync(path.join(root, "public/wholesale-seller-dashboard.js"), "utf8");
  const start = js.indexOf("[data-wholesale-edit-in-studio]");
  const fn = js.slice(start, start + 1500);
  assert.match(fn, /window\.BloomShotLoadImage/);
  assert.match(fn, /window\.showPage\?\.\('bloomshotPage'\)/);
  assert.match(fn, /fetchListingImageDataUrl\(product\.image_url\)/);
});

test("fetchListingImageDataUrl handles both an already-data: URL (fast path) and a real hosted URL (fetch+convert, capped at 2MB) — mirrors Community's fetchPostImageDataUrl exactly", () => {
  const js = fs.readFileSync(path.join(root, "public/wholesale-seller-dashboard.js"), "utf8");
  const fn = js.slice(js.indexOf("async function fetchListingImageDataUrl"), js.indexOf("function floralMetaLine"));
  assert.match(fn, /trimmed\.startsWith\('data:'\)/);
  assert.match(fn, /blob\.size > 2 \* 1024 \* 1024/);
  assert.match(fn, /readAsDataURL\(blob\)/);
});
