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

test("featured arrangements have zero exact duplicate image file hashes", () => {
  const report = auditEverydayFloralLibraryImages({ publicDir });
  const featured = getEverydayFloralLibraryCatalog().filter((p) => !p.metadata?.needs_image_replacement);

  assert.equal(report.duplicateHashGroupCount, 0, formatDuplicateReport(report));
  assert.equal(report.uniqueImageFileHashes, report.imageFilenameCount);
  assert.equal(report.featuredUniqueHashes, featured.length);
  assert.equal(report.featuredCount, featured.length);

  const hashById = new Map();
  for (const p of featured) {
    const rel = normalizeAssetPath(p.primary_image.url);
    const hash = fileSha256Absolute(path.join(publicDir, rel));
    if (hashById.has(hash)) {
      assert.fail(
        `duplicate image hash ${hash.slice(0, 16)}… for ${p.id} and ${hashById.get(hash)} (exact file content)`
      );
    }
    hashById.set(hash, p.id);
  }
  assert.equal(hashById.size, featured.length);
});

test("public starter catalog excludes arrangements marked needs_image_replacement", () => {
  const full = getEverydayFloralLibraryCatalog();
  const pub = getPublicFloralLibraryCatalog();
  const excluded = full.filter((p) => p.metadata?.needs_image_replacement);
  assert.ok(
    pub.every((p) => !p.metadata?.needs_image_replacement),
    "public catalog must not include needs_image_replacement items"
  );
  assert.equal(pub.length, full.length - excluded.length);
});

test("public catalog is opt-in and contains only the reviewed finished vase arrangement", () => {
  const pub = getPublicFloralLibraryCatalog();
  assert.deepEqual(pub.map((p) => p.id), ["ed-39-soft-neutral-mix"]);

  const hiddenExamples = new Set([
    "ed-02-pink-meadow", // non-floral subject
    "ed-15-peachy-keen", // hand-tied bouquet without a vase
    "ed-21-modern-whites", // workbench/process photo
    "ed-33-rose-daisy-blend", // single stem
  ]);
  assert.ok(getEverydayFloralLibraryCatalog()
    .filter((p) => hiddenExamples.has(p.id))
    .every((p) => p.metadata?.needs_image_replacement));
});

test("browser collection uses the same finished-vase public allowlist", async () => {
  await import("../public/floral-library-collection.js");
  const browserCollection = globalThis.FlorisynLibraryCollection;
  assert.deepEqual(browserCollection.map((p) => p.id), ["ed-39-soft-neutral-mix"]);
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
