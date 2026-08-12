import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

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
  assert.equal(COLLECTION.length, 21, "expected 21 visible vase everyday designs");
  const ids = COLLECTION.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
  assert.ok(ids.every((id) => id.startsWith("ed-")), "everyday batch ids");
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

    assert.equal(p.image_license?.review_status, "approved", `${p.id}: image must be review-approved`);
  }
});

test("every referenced image is a local, optimized asset that exists on disk", () => {
  for (const p of COLLECTION) {
    const url = p.primary_image?.url || "";
    assert.ok(url.startsWith("/assets/floral-library/"), `${p.id}: image must be a local asset`);
    assert.ok(p.primary_image?.alt, `${p.id}: alt text required for accessibility`);
    const filePath = path.join(publicDir, url.replace(/^\//, ""));
    assert.ok(existsSync(filePath), `${p.id}: asset file missing on disk (${url})`);
    const head = readFileSync(filePath).subarray(0, 2);
    assert.equal(head[0], 0xff, `${p.id}: asset must be a real JPEG (not a symlink/HTML fallback)`);
    assert.equal(head[1], 0xd8, `${p.id}: asset must be a real JPEG (not a symlink/HTML fallback)`);
  }
});
