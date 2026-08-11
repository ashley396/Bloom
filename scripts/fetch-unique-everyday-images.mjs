#!/usr/bin/env node
/**
 * Downloads one unique licensed Pexels photo per everyday library arrangement.
 * Updates JSON with content_sha256, pexels_photo_id, and image_license metadata.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EVERYDAY_PEXELS_POOL, pexelsAttribution, pexelsDownloadUrl } from "./floral-library-pexels-pool.mjs";

const root = process.cwd();
const publicDir = path.join(root, "public");
const everydayDir = path.join(publicDir, "assets/floral-library/everyday");
const batchFiles = [
  path.join(publicDir, "data/floral-library-everyday-50.json"),
  path.join(publicDir, "data/floral-library-everyday-batch-2.json")
];

async function downloadPhoto(photoId) {
  const res = await fetch(pexelsDownloadUrl(photoId), {
    headers: { "User-Agent": "Florisyn-Floral-Library/1.0" }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for Pexels ${photoId}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5000 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error(`Invalid JPEG for Pexels ${photoId}`);
  }
  return buf;
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function main() {
  fs.mkdirSync(everydayDir, { recursive: true });
  const usedHashes = new Set();
  const usedPhotoIds = new Set();
  let poolIndex = 0;
  let total = 0;
  let replaced = 0;

  async function nextUniquePhoto() {
    while (poolIndex < EVERYDAY_PEXELS_POOL.length) {
      const photoId = EVERYDAY_PEXELS_POOL[poolIndex++];
      if (usedPhotoIds.has(photoId)) continue;
      try {
        const buf = await downloadPhoto(photoId);
        const hash = sha256(buf);
        if (usedHashes.has(hash)) continue;
        usedHashes.add(hash);
        usedPhotoIds.add(photoId);
        return { photoId, buf, hash };
      } catch (err) {
        console.warn(`skip Pexels ${photoId}: ${err.message}`);
      }
    }
    return null;
  }

  for (const file of batchFiles) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const a of data.arrangements || []) {
      const target = path.join(everydayDir, `${a.id}.jpg`);
      const photo = await nextUniquePhoto();
      if (!photo) {
        a.needs_image_replacement = true;
        a.content_sha256 = null;
        a.pexels_photo_id = null;
        a.image_license = {
          source: "bloom_owned",
          attribution: "Placeholder — unique photo pending replacement",
          review_status: "needs_replacement"
        };
        console.warn(`no unique photo left for ${a.id} — marked needs_image_replacement`);
        total += 1;
        continue;
      }

      fs.writeFileSync(target, photo.buf);
      a.pexels_photo_id = photo.photoId;
      a.content_sha256 = photo.hash;
      a.needs_image_replacement = false;
      a.image_license = {
        source: "licensed_stock_pexels",
        attribution: pexelsAttribution(photo.photoId),
        review_status: "approved"
      };
      a.image = `everyday/${a.id}.jpg`;
      total += 1;
      replaced += 1;
    }
    data.generated_at = new Date().toISOString();
    data.image_source = "licensed_stock_pexels_unique";
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`updated ${path.basename(file)}`);
  }

  console.log(`fetch-unique-everyday-images: ${replaced}/${total} unique photos written`);
  if (usedHashes.size < total) {
    throw new Error(`Only ${usedHashes.size} unique hashes for ${total} arrangements`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
