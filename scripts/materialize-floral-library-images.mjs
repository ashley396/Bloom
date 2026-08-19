#!/usr/bin/env node
/**
 * @deprecated Use `node scripts/fetch-unique-everyday-images.mjs` for unique licensed photos.
 * This legacy script copies from a 10-image pool and produces duplicate thumbnails.
 * Writes real JPG copies for every everyday library arrangement.
 * Required for Netlify static deploy (symlinks 404 → SPA fallback → one broken thumbnail).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isRegularJpegFile, materializeEverydayImage } from "./floral-library-image-pool.mjs";

function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const root = process.cwd();
const publicDir = path.join(root, "public");
const batchFiles = [
  path.join(publicDir, "data/floral-library-everyday-50.json"),
  path.join(publicDir, "data/floral-library-everyday-batch-2.json")
];

let globalIndex = 0;
let count = 0;

for (const file of batchFiles) {
  if (!fs.existsSync(file)) {
    console.warn(`materialize: skip missing ${path.basename(file)}`);
    continue;
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const a of data.arrangements || []) {
    const target = path.join(publicDir, "assets/floral-library/everyday", `${a.id}.jpg`);
    const expectedSha = a.content_sha256 ? String(a.content_sha256) : "";
    if (
      expectedSha &&
      isRegularJpegFile(target) &&
      fileSha256(target) === expectedSha
    ) {
      globalIndex += 1;
      count += 1;
      continue;
    }
    const pool = materializeEverydayImage(publicDir, a, globalIndex);
    if (!isRegularJpegFile(target)) {
      throw new Error(`Failed to materialize JPEG for ${a.id} from ${pool}`);
    }
    globalIndex += 1;
    count += 1;
  }
}

console.log(`materialize-floral-library-images: wrote ${count} real JPG files`);
