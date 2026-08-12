/**
 * Florisyn Sympathy Floral Library — CSV source, vase-only, approved placeholder images.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FLORAL_LIBRARY_CSV_COLUMNS,
  arrangementToCsvRow,
  hasValidVase,
  isPublicSympathyArrangement,
  isSympathyCategory,
} from "../lib/floral-library/csv-standard.js";
import {
  getSympathyFloralLibraryCatalog,
  SYMPATHY_FLORAL_ARRANGEMENTS,
} from "../lib/floral-library/sympathy-arrangements.js";
import {
  getEverydayFloralLibraryCatalog,
  getPublicFloralLibraryCatalog,
} from "../netlify/functions/_shared/floral-library-core.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "../public");

test("Sympathy category exists in master and public catalogs", () => {
  const sympathy = getSympathyFloralLibraryCatalog();
  assert.equal(sympathy.length, 10);
  assert.ok(sympathy.every((p) => isSympathyCategory(p)));
  assert.ok(sympathy.every((p) => (p.categories || []).includes("Sympathy")));
  const publicSympathy = getPublicFloralLibraryCatalog().filter(isSympathyCategory);
  assert.equal(publicSympathy.length, 10);
});

test("all Sympathy items have SKUs beginning with SYM-", () => {
  for (const p of getSympathyFloralLibraryCatalog()) {
    assert.match(String(p.sku || p.metadata?.sku || ""), /^SYM-/i, `${p.id} SKU must start with SYM-`);
    assert.match(String(p.csv?.SKU || ""), /^SYM-/i, `${p.id} csv SKU must start with SYM-`);
  }
});

test("all Sympathy items have a vase and never say no vase", () => {
  for (const p of getSympathyFloralLibraryCatalog()) {
    const vase = p.metadata?.vase || p.metadata?.container;
    assert.ok(vase, `${p.id} must have vase/container`);
    assert.ok(hasValidVase({ container: vase }), `${p.id} vase invalid: ${vase}`);
    assert.doesNotMatch(String(vase), /no vase/i, `${p.id} must not say no vase`);
    assert.equal(p.metadata?.vase_arrangement_verified, true, `${p.id} must be vase verified`);
  }
});

test("no visible Sympathy item uses a non-approved image", () => {
  for (const p of getPublicFloralLibraryCatalog().filter(isSympathyCategory)) {
    assert.equal(isPublicSympathyArrangement(p), true, `${p.id} must pass public sympathy filter`);
    const url = String(p.primary_image?.url || "");
    assert.ok(
      url.includes("approved-vase-placeholder") || p.metadata?.approved_placeholder,
      `${p.id} must use approved placeholder or verified photo`
    );
    assert.doesNotMatch(url, /pexels|everyday\/ed-/i, `${p.id} must not reuse everyday or stock URLs`);
    assert.notEqual(p.image_license?.review_status, "pending", `${p.id} image license must be approved`);
  }
});

test("Sympathy items satisfy CSV standard columns", () => {
  for (const a of SYMPATHY_FLORAL_ARRANGEMENTS) {
    const row = arrangementToCsvRow(a);
    for (const col of FLORAL_LIBRARY_CSV_COLUMNS) {
      assert.ok(row[col] != null && row[col] !== "", `${a.id} missing ${col}`);
    }
    assert.equal(row.Category, "Sympathy");
  }
});

test("Sympathy batch is separate from Everyday", () => {
  const everydayIds = new Set(getEverydayFloralLibraryCatalog().map((p) => p.id));
  for (const p of getSympathyFloralLibraryCatalog()) {
    assert.ok(p.id.startsWith("sym-"), `${p.id} must use sym- id prefix`);
    assert.ok(!everydayIds.has(p.id), `${p.id} must not overlap Everyday ids`);
    assert.ok(!(p.categories || []).includes("Everyday"), `${p.id} must not be categorized Everyday`);
  }
});

test("Everyday category still works after Sympathy batch added", () => {
  const everyday = getPublicFloralLibraryCatalog().filter((p) => (p.categories || []).includes("Everyday"));
  assert.equal(everyday.length, 21);
  assert.ok(everyday.every((p) => p.metadata?.vase_arrangement_verified));
  assert.ok(!everyday.some((p) => String(p.sku || "").startsWith("SYM-")));
});

test("approved sympathy placeholder asset exists on disk", () => {
  const asset = path.join(publicDir, "assets/floral-library/sympathy/approved-vase-placeholder.jpg");
  assert.ok(existsSync(asset), "sympathy approved placeholder must exist");
  const head = readFileSync(asset).subarray(0, 2);
  assert.equal(head[0], 0xff);
  assert.equal(head[1], 0xd8);
});

test("sympathy source CSV defines exactly 10 rows", () => {
  const csv = readFileSync(path.join(publicDir, "data/floral-library-sympathy-source.csv"), "utf8").trim();
  const lines = csv.split("\n").filter(Boolean);
  assert.equal(lines.length, 11, "header + 10 sympathy rows");
  assert.ok(lines[0].startsWith("SKU,"));
});
