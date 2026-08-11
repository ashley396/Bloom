#!/usr/bin/env node
/**
 * Assigns unique photos per everyday library item.
 * Uses Florisyn-owned arrangement JPGs + visually verified Pexels vase/bouquet IDs only.
 * Remaining slots get labeled placeholders (needs_image_replacement) — never random stock.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import verifiedPexelsIds from "./floral-library-arrangement-ids.json" with { type: "json" };
import {
  FLORISYN_ARRANGEMENT_SOURCES,
  pexelsAttribution,
  pexelsDownloadUrl,
  scoreLocalMatch
} from "./floral-library-pexels-pool.mjs";

const root = process.cwd();
const publicDir = path.join(root, "public");
const everydayDir = path.join(publicDir, "assets/floral-library/everyday");
const batchFiles = [
  path.join(publicDir, "data/floral-library-everyday-50.json"),
  path.join(publicDir, "data/floral-library-everyday-batch-2.json")
];

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function downloadPhoto(photoId) {
  const res = await fetch(pexelsDownloadUrl(photoId), {
    headers: { "User-Agent": "Florisyn-Floral-Library/1.0" }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for Pexels ${photoId}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 10000 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error(`Invalid JPEG for Pexels ${photoId}`);
  }
  return buf;
}

async function makePlaceholder(arrangement) {
  const svg = `<svg width="1200" height="900" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f5f0eb"/>
    <rect x="80" y="80" width="1040" height="740" rx="24" fill="#fff" stroke="#c9b8a8" stroke-width="4"/>
    <text x="600" y="340" text-anchor="middle" font-family="Georgia, serif" font-size="38" fill="#5c4a42">Arrangement photo pending</text>
    <text x="600" y="400" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#8a7568">Unique florist photography needed</text>
    <text x="600" y="480" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#a89488">${arrangement.name.replace(/&/g, "&amp;")}</text>
    <text x="600" y="530" text-anchor="middle" font-family="monospace" font-size="16" fill="#b0a090">${arrangement.id}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

async function main() {
  fs.mkdirSync(everydayDir, { recursive: true });
  const usedHashes = new Set();
  const usedPexelsIds = new Set();
  const usedLocalFiles = new Set();
  let globalIndex = 0;
  let pexelsIndex = 0;
  let realPhotos = 0;
  let placeholders = 0;

  async function nextLocal(arrangement) {
    const ranked = FLORISYN_ARRANGEMENT_SOURCES.map((source) => ({
      source,
      score: scoreLocalMatch(arrangement, source)
    }))
      .filter(({ source }) => !usedLocalFiles.has(source.file))
      .sort((a, b) => b.score - a.score);

    for (const { source } of ranked) {
      const filePath = path.join(publicDir, source.file);
      if (!fs.existsSync(filePath)) continue;
      const buf = fs.readFileSync(filePath);
      const hash = sha256(buf);
      if (usedHashes.has(hash)) continue;
      usedHashes.add(hash);
      usedLocalFiles.add(source.file);
      return {
        buf,
        hash,
        license: {
          source: "bloom_owned",
          attribution: `Florisyn arrangement photography — ${path.basename(source.file)}`,
          review_status: "approved"
        },
        pexels_photo_id: null,
        image_subject: "floral_arrangement",
        needs_image_replacement: false
      };
    }
    return null;
  }

  async function nextVerifiedPexels() {
    while (pexelsIndex < verifiedPexelsIds.length) {
      const photoId = verifiedPexelsIds[pexelsIndex++];
      if (usedPexelsIds.has(photoId)) continue;
      try {
        const buf = await downloadPhoto(photoId);
        const hash = sha256(buf);
        if (usedHashes.has(hash)) continue;
        usedHashes.add(hash);
        usedPexelsIds.add(photoId);
        return {
          buf,
          hash,
          license: {
            source: "licensed_stock_pexels",
            attribution: pexelsAttribution(photoId),
            review_status: "approved"
          },
          pexels_photo_id: photoId,
          image_subject: "floral_arrangement",
          needs_image_replacement: false
        };
      } catch (err) {
        console.warn(`skip verified Pexels ${photoId}: ${err.message}`);
      }
    }
    return null;
  }

  for (const file of batchFiles) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const a of data.arrangements || []) {
      let photo = (await nextLocal(a)) || (await nextVerifiedPexels());

      if (!photo) {
        const buf = await makePlaceholder(a);
        const hash = sha256(buf);
        usedHashes.add(hash);
        photo = {
          buf,
          hash,
          license: {
            source: "bloom_owned",
            attribution: "Placeholder — unique arrangement photo pending replacement",
            review_status: "needs_replacement"
          },
          pexels_photo_id: null,
          image_subject: "placeholder_needs_replacement",
          needs_image_replacement: true
        };
        placeholders += 1;
      } else {
        realPhotos += 1;
      }

      fs.writeFileSync(path.join(everydayDir, `${a.id}.jpg`), photo.buf);
      a.pexels_photo_id = photo.pexels_photo_id;
      a.content_sha256 = photo.hash;
      a.image_subject = photo.image_subject;
      a.image_license = photo.license;
      a.needs_image_replacement = photo.needs_image_replacement;
      a.image = `everyday/${a.id}.jpg`;
      globalIndex += 1;
    }
    data.generated_at = new Date().toISOString();
    data.image_source = "florisyn_verified_arrangements_plus_placeholders";
    data.verified_arrangement_count = realPhotos;
    data.placeholder_count = placeholders;
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`updated ${path.basename(file)}`);
  }

  console.log(`fetch-unique-everyday-images: ${realPhotos} verified arrangements, ${placeholders} placeholders`);
  if (usedHashes.size !== globalIndex || globalIndex !== 100) {
    throw new Error(`Expected 100 unique hashes, got ${usedHashes.size} hashes for ${globalIndex} arrangements`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
