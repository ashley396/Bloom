/**
 * Floral Library everyday image duplicate-content audit (file SHA-256, not URL/filename).
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import batch1 from "../../public/data/floral-library-everyday-50.json" with { type: "json" };
import batch2 from "../../public/data/floral-library-everyday-batch-2.json" with { type: "json" };

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const EVERYDAY_BATCH_FILES = [
  "public/data/floral-library-everyday-50.json",
  "public/data/floral-library-everyday-batch-2.json"
];

export function normalizeAssetPath(urlOrPath) {
  return String(urlOrPath || "").replace(/^\//, "").split("?")[0];
}

export function fileSha256Absolute(filePath) {
  const buf = readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

export function resolveEverydayImagePath(publicDir, imageRelative) {
  return path.join(publicDir, "assets/floral-library", imageRelative);
}

/**
 * @param {{ publicDir?: string, batches?: Array<{ arrangements?: object[] }> }} [opts]
 */
export function auditEverydayFloralLibraryImages(opts = {}) {
  const publicDir = opts.publicDir || path.join(repoRoot, "public");
  const batches = opts.batches || [batch1, batch2];
  const arrangements = batches.flatMap((b) => b.arrangements || []);

  const hashToArrangements = new Map();
  const hashToFilenames = new Map();
  const missingFiles = [];
  const jsonShaMismatches = [];
  const needsReplacement = [];

  for (const a of arrangements) {
    if (a.needs_image_replacement) needsReplacement.push(a.id);

    const rel = `assets/floral-library/${a.image}`;
    const abs = path.join(publicDir, rel);
    if (!existsSync(abs)) {
      missingFiles.push({ id: a.id, path: rel });
      continue;
    }

    const fileHash = fileSha256Absolute(abs);
    if (a.content_sha256 && a.content_sha256 !== fileHash) {
      jsonShaMismatches.push({ id: a.id, json: a.content_sha256, file: fileHash });
    }

    if (!hashToArrangements.has(fileHash)) {
      hashToArrangements.set(fileHash, []);
      hashToFilenames.set(fileHash, []);
    }
    hashToArrangements.get(fileHash).push(a.id);
    hashToFilenames.get(fileHash).push(path.basename(a.image));
  }

  const duplicateGroups = [...hashToArrangements.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([hash, arrangementIds]) => ({
      hash,
      hashPrefix: hash.slice(0, 16),
      arrangementIds,
      filenames: hashToFilenames.get(hash),
      exactContentDuplicate: true
    }));

  const featured = arrangements.filter((a) => !a.needs_image_replacement);

  return {
    arrangementCount: arrangements.length,
    featuredCount: featured.length,
    imageFilenameCount: arrangements.length,
    uniqueImageFileHashes: hashToArrangements.size,
    duplicateHashGroupCount: duplicateGroups.length,
    duplicateGroups,
    missingFiles,
    jsonShaMismatches,
    needsReplacementIds: needsReplacement,
    featuredUniqueHashes: featured.length
      ? new Set(
          featured.map((a) => {
            const abs = resolveEverydayImagePath(publicDir, a.image);
            return fileSha256Absolute(abs);
          })
        ).size
      : 0
  };
}
