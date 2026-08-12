/**
 * Regression: featured Everyday Floral Library arrangements must use unique on-disk image bytes.
 * Fails when two arrangements share the exact same JPEG file hash (content duplicate).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  auditEverydayFloralLibraryImages,
  fileSha256Absolute,
  normalizeAssetPath,
  resolveEverydayImagePath
} from "../lib/floral-library/image-hash-audit.js";
import { getEverydayFloralLibraryCatalog, getPublicFloralLibraryCatalog } from "../netlify/functions/_shared/floral-library-core.js";
import {
  FLORAL_LIBRARY_CSV_COLUMNS,
  arrangementToCsvRow,
  hasValidVase,
  isPublicVaseArrangement,
  isSympathyCategory,
} from "../lib/floral-library/csv-standard.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "../public");

test("every arrangement image path resolves to an existing file (both JSON batches)", () => {
  const report = auditEverydayFloralLibraryImages({ publicDir });
  assert.equal(report.arrangementCount, 100);
  assert.equal(report.missingFiles.length, 0, `missing: ${JSON.stringify(report.missingFiles.slice(0, 5))}`);
});

test("JSON content_sha256 matches actual file bytes for every arrangement", () => {
  const report = auditEverydayFloralLibraryImages({ publicDir });
  assert.equal(
    report.jsonShaMismatches.length,
    0,
    `sha mismatches: ${JSON.stringify(report.jsonShaMismatches.slice(0, 3))}`
  );
});

test("featured visible vase arrangements have zero exact duplicate image file hashes", () => {
  const featured = getPublicFloralLibraryCatalog();
  assert.equal(featured.length, 31);

  const hashById = new Map();
  for (const p of featured) {
    if (p.metadata?.approved_placeholder) continue;
    const rel = normalizeAssetPath(p.primary_image.url);
    const hash = fileSha256Absolute(path.join(publicDir, rel));
    if (hashById.has(hash)) {
      assert.fail(
        `duplicate image hash ${hash.slice(0, 16)}… for ${p.id} and ${hashById.get(hash)} (exact file content)`
      );
    }
    hashById.set(hash, p.id);
  }
  assert.equal(hashById.size, featured.filter((p) => !p.metadata?.approved_placeholder).length);
});

test("public starter catalog excludes everyday items marked needs_image_replacement", () => {
  const everyday = getEverydayFloralLibraryCatalog();
  const pubEveryday = getPublicFloralLibraryCatalog().filter((p) => (p.categories || []).includes("Everyday"));
  const excluded = everyday.filter((p) => p.metadata?.needs_image_replacement);
  assert.ok(
    pubEveryday.every((p) => !p.metadata?.needs_image_replacement),
    "public everyday catalog must not include needs_image_replacement items"
  );
  assert.equal(getPublicFloralLibraryCatalog().length, 31);
  assert.equal(pubEveryday.length, 21);
  assert.equal(excluded.length, 79);
});

test("every visible Everyday item satisfies CSV standard with a vase field", () => {
  for (const p of getPublicFloralLibraryCatalog()) {
    assert.ok(p.metadata?.vase || p.metadata?.container, `${p.id} must have vase/container metadata`);
    assert.ok(hasValidVase({ container: p.metadata?.vase || p.metadata?.container }), `${p.id} vase invalid`);
    assert.doesNotMatch(String(p.metadata?.vase || ""), /no vase/i, `${p.id} must not say no vase`);
    assert.equal(p.metadata?.vase_arrangement_verified, true, `${p.id} must be vase-arrangement verified`);
    assert.equal(p.metadata?.image_verified, true, `${p.id} image must be verified`);
    const row = p.csv || arrangementToCsvRow({ ...p, container: p.metadata?.container, recipe: p.recipe });
    for (const col of FLORAL_LIBRARY_CSV_COLUMNS) {
      assert.ok(row[col] != null && row[col] !== "", `${p.id} missing CSV column ${col}`);
    }
  }
});

test("public everyday catalog rejects non-vase or unverified images", () => {
  const blocked = getEverydayFloralLibraryCatalog().filter((p) => !isPublicVaseArrangement(p));
  assert.equal(blocked.length, 79);
  for (const p of getPublicFloralLibraryCatalog().filter((x) => (x.categories || []).includes("Everyday"))) {
    assert.match(String(p.primary_image?.url || ""), /^\/assets\/floral-library\/everyday\/ed-/);
    assert.doesNotMatch(String(p.primary_image?.url || ""), /pexels|computer|landscape|person|single-stem|hand-tie|no-vase/i);
  }
  for (const p of getPublicFloralLibraryCatalog().filter(isSympathyCategory)) {
    assert.match(String(p.primary_image?.url || ""), /^\/assets\/floral-library\/sympathy\//);
  }
});

test("ultra-realistic label only on verified featured arrangements", () => {
  for (const p of getEverydayFloralLibraryCatalog()) {
    if (p.metadata?.needs_image_replacement) {
      assert.notEqual(p.metadata?.image_standard, "ultra_realistic_professional_floral_photography");
      assert.ok(!p.tags?.includes("ultra_realistic"), `${p.id} must not carry ultra_realistic tag`);
    } else {
      assert.equal(p.metadata?.image_standard, "ultra_realistic_professional_floral_photography");
    }
  }
});

test("primary image URLs include content hash cache bust for hard refresh", () => {
  const catalog = getEverydayFloralLibraryCatalog().slice(0, 20);
  for (const p of catalog) {
    assert.match(p.primary_image.url, /\?v=[a-f0-9]{16}$/, `${p.id} must cache-bust image URL`);
    assert.equal(p.primary_image.hash, p.primary_image.url.split("?v=")[1], `${p.id} hash must match URL bust param`);
  }
});

test("first 20 everyday cards use visually distinct image bytes", () => {
  const catalog = getEverydayFloralLibraryCatalog().slice(0, 20);
  const hashes = new Set();
  for (const p of catalog) {
    const rel = normalizeAssetPath(p.primary_image.url);
    const hash = fileSha256Absolute(path.join(publicDir, rel));
    assert.ok(!hashes.has(hash), `first-20 duplicate image for ${p.id}`);
    hashes.add(hash);
  }
  assert.equal(hashes.size, 20);
});

test("everyday image map documents all 100 arrangements", () => {
  const map = JSON.parse(readFileSync(path.join(publicDir, "data/floral-library-everyday-image-map.json"), "utf8"));
  assert.equal(Object.keys(map.arrangements || {}).length, 100);
});

test("both batch JSON files are included in hash audit scope", () => {
  const batchFiles = [
    path.join(publicDir, "data/floral-library-everyday-50.json"),
    path.join(publicDir, "data/floral-library-everyday-batch-2.json")
  ];
  for (const file of batchFiles) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    assert.ok(data.arrangements?.length >= 50, `${file} must contribute arrangements`);
    for (const a of data.arrangements) {
      const abs = resolveEverydayImagePath(publicDir, a.image);
      assert.ok(abs.includes("everyday"), `${a.id} must reference everyday asset path`);
    }
  }
  const report = auditEverydayFloralLibraryImages({ publicDir });
  assert.equal(report.arrangementCount, 100);
});

function formatDuplicateReport(report) {
  if (!report.duplicateGroups.length) return "";
  return report.duplicateGroups
    .map((g) => `${g.hashPrefix}… → ${g.arrangementIds.join(", ")}`)
    .join("\n");
}
