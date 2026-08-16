import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { getPublicFloralLibraryCatalog } from "../netlify/functions/_shared/floral-library-core.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public");
const source = readFileSync(path.join(publicDir, "floral-library-collection.js"), "utf8");

function loadCollection() {
  const sandbox = { window: {}, module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "floral-library-collection.js" });
  return sandbox.window.FlorisynLibraryCollection;
}

const COLLECTION = loadCollection();

// Mirrors the <select id="libraryCategory"> options in index.html.
const ALLOWED_CATEGORIES = new Set([
  "Hydrangeas", "Birthday", "Love & Romance", "Sympathy", "Funeral",
  "Wedding", "Everyday", "New Baby", "Get Well", "Congratulations", "Plants",
  "Luxury arrangements"
]);

test("collection is a non-empty array with unique ids", () => {
  assert.ok(Array.isArray(COLLECTION));
  // This bundle is regenerated (scripts/sync-floral-library-catalog.mjs)
  // from getPublicFloralLibraryCatalog() — the same QA-gated, served
  // catalog the server returns — specifically so this file can never
  // drift from what's actually shipped the way it used to (it previously
  // reimplemented its own mapping, which unconditionally claimed every
  // image was "bloom_owned"/"approved" and included the 74 images a real
  // visual QA audit had flagged as off-subject). 216 = 26 QA-passed
  // everyday images + 190 across the occasion-specific batches.
  assert.equal(COLLECTION.length, 216, "expected the QA-gated served library size");
  const ids = COLLECTION.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
});

test("every item has valid metadata for the renderer", () => {
  for (const p of COLLECTION) {
    assert.equal(typeof p.id, "string");
    assert.ok(p.id, "id required");
    assert.ok(p.name && typeof p.name === "string", `${p.id}: name required`);
    assert.ok(p.short_description && p.description, `${p.id}: descriptions required`);

    assert.ok(Array.isArray(p.categories) && p.categories.length, `${p.id}: categories required`);
    for (const c of p.categories) {
      assert.ok(ALLOWED_CATEGORIES.has(c), `${p.id}: category "${c}" must be a known Library category`);
    }

    const retail = p.suggested_retail?.default;
    assert.equal(typeof retail, "number");
    assert.ok(retail > 0, `${p.id}: retail must be positive`);
    assert.ok(typeof p.suggested_cost === "number" && p.suggested_cost >= 0, `${p.id}: cost must be >= 0`);
    assert.ok(p.suggested_cost < retail, `${p.id}: cost should be below retail (positive margin)`);

    assert.ok(Array.isArray(p.recipe) && p.recipe.length, `${p.id}: recipe required`);
    for (const r of p.recipe) {
      assert.ok(r.name && typeof r.name === "string", `${p.id}: recipe line needs a name`);
      assert.ok(Number(r.qty) > 0, `${p.id}: recipe qty must be positive`);
    }

    // Honest status, not a blanket claim: AI-generated images are legitimately
    // "needs_review" (the model that made them was never a human reviewer),
    // and the few real, user-provided photos are "approved". Both are valid;
    // what's not valid is every image claiming "approved" regardless of truth
    // (the bug this bundle used to have — see the count test above).
    assert.ok(
      ["approved", "needs_review"].includes(p.image_license?.review_status),
      `${p.id}: must declare a real review status`
    );
    assert.ok(p.image_license?.source, `${p.id}: must declare a real license source`);
  }
});

// The bundle is loaded client-side and preferred over the live server
// fetch by id (see floral-library-ui.js's mergeCatalog) — so if it ever
// drifts from what the server actually serves, the client-side bundle
// silently wins and the server-side fix (e.g. a QA gate) never reaches
// real users. Regenerate with `node scripts/sync-floral-library-catalog.mjs`
// whenever the served catalog changes.
test("bundle exactly matches the live served catalog (run the sync script if this fails)", () => {
  const served = getPublicFloralLibraryCatalog();
  const bundleIds = new Set(COLLECTION.map((p) => p.id));
  const servedIds = new Set(served.map((p) => p.id));
  assert.equal(bundleIds.size, servedIds.size, "bundle and server must serve the same number of items");
  for (const id of servedIds) {
    assert.ok(bundleIds.has(id), `server serves ${id} but the client bundle is missing it — bundle is stale`);
  }
  for (const id of bundleIds) {
    assert.ok(servedIds.has(id), `client bundle serves ${id} but the server no longer does — bundle is stale`);
  }
});

test("every referenced image is a local, optimized asset that exists on disk", () => {
  for (const p of COLLECTION) {
    const url = p.primary_image?.url || "";
    assert.ok(url.startsWith("/assets/floral-library/"), `${p.id}: image must be a local asset`);
    assert.ok(p.primary_image?.alt, `${p.id}: alt text required for accessibility`);
    // Image URLs carry a content-hash cache-busting query string
    // (?v=<hash>) — strip it before checking the file on disk.
    const filePath = path.join(publicDir, url.replace(/^\//, "").split("?")[0]);
    assert.ok(existsSync(filePath), `${p.id}: asset file missing on disk (${url})`);
    const head = readFileSync(filePath).subarray(0, 2);
    assert.equal(head[0], 0xff, `${p.id}: asset must be a real JPEG (not a symlink/HTML fallback)`);
    assert.equal(head[1], 0xd8, `${p.id}: asset must be a real JPEG (not a symlink/HTML fallback)`);
  }
});
