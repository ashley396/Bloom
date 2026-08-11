#!/usr/bin/env node
/**
 * Duplicate-content report for Florisyn Everyday Floral Library images.
 * Uses SHA-256 of on-disk JPEG bytes (exact file duplicates only).
 */
import { auditEverydayFloralLibraryImages } from "../lib/floral-library/image-hash-audit.js";

const report = auditEverydayFloralLibraryImages();
const out = {
  ...report,
  duplicateGroups: report.duplicateGroups.map((g) => ({
    hashPrefix: g.hashPrefix,
    arrangementIds: g.arrangementIds,
    filenames: g.filenames,
    exactContentDuplicate: g.exactContentDuplicate
  }))
};

console.log(JSON.stringify(out, null, 2));
if (report.missingFiles.length || report.duplicateHashGroupCount > 0 || report.jsonShaMismatches.length) {
  process.exitCode = 1;
}
