#!/usr/bin/env node
/**
 * Replaces failed Visual Realism QA images only.
 * Keeps passing arrangement files unchanged. Uses Florisyn-owned JPGs + verified Pexels pool.
 * Marks needs_image_replacement when no unique realistic photo is available.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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
const qaPath = path.join(publicDir, "data/floral-library-visual-qa-results.json");
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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 15000 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error(`Invalid JPEG (${buf.length} bytes)`);
  }
  return buf;
}

function loadQa() {
  if (!fs.existsSync(qaPath)) throw new Error(`Missing ${qaPath}`);
  const qa = JSON.parse(fs.readFileSync(qaPath, "utf8"));
  const failIds = new Set(qa.filter((r) => r.verdict === "fail").map((r) => r.id));
  const passIds = new Set(qa.filter((r) => r.verdict === "pass").map((r) => r.id));
  return { failIds, passIds };
}

async function main() {
  const { failIds, passIds } = loadQa();
  fs.mkdirSync(everydayDir, { recursive: true });

  const usedHashes = new Set();
  const usedPexels = new Set();
  const usedLocal = new Set();
  let pexelsIndex = 0;
  let replaced = 0;
  let pending = 0;

  for (const file of batchFiles) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const a of data.arrangements || []) {
      const target = path.join(everydayDir, `${a.id}.jpg`);
      if (passIds.has(a.id)) {
        if (fs.existsSync(target)) {
          usedHashes.add(sha256(fs.readFileSync(target)));
        }
        if (a.pexels_photo_id) usedPexels.add(String(a.pexels_photo_id));
        continue;
      }
      if (!failIds.has(a.id)) continue;

      async function nextLocal() {
        const ranked = FLORISYN_ARRANGEMENT_SOURCES.map((source) => ({
          source,
          score: scoreLocalMatch(a, source)
        }))
          .filter(({ source }) => !usedLocal.has(source.file))
          .sort((x, y) => y.score - x.score);

        for (const { source } of ranked) {
          const filePath = path.join(publicDir, source.file);
          if (!fs.existsSync(filePath)) continue;
          const buf = fs.readFileSync(filePath);
          const hash = sha256(buf);
          if (usedHashes.has(hash)) continue;
          usedHashes.add(hash);
          usedLocal.add(source.file);
          return {
            buf,
            hash,
            pexels_photo_id: null,
            image_license: {
              source: "bloom_owned",
              attribution: `Florisyn arrangement photography — ${path.basename(source.file)}`,
              review_status: "approved"
            },
            needs_image_replacement: false,
            image_subject: "floral_arrangement"
          };
        }
        return null;
      }

      async function nextPexels() {
        while (pexelsIndex < verifiedPexelsIds.length) {
          const photoId = verifiedPexelsIds[pexelsIndex++];
          if (usedPexels.has(photoId)) continue;
          try {
            const buf = await downloadPhoto(photoId);
            const hash = sha256(buf);
            if (usedHashes.has(hash)) continue;
            usedHashes.add(hash);
            usedPexels.add(photoId);
            return {
              buf,
              hash,
              pexels_photo_id: photoId,
              image_license: {
                source: "licensed_stock_pexels",
                attribution: pexelsAttribution(photoId),
                review_status: "approved"
              },
              needs_image_replacement: false,
              image_subject: "floral_arrangement"
            };
          } catch {
            /* try next id */
          }
        }
        return null;
      }

      const photo = (await nextLocal()) || (await nextPexels());
      if (!photo) {
        a.needs_image_replacement = true;
        a.pexels_photo_id = null;
        a.content_sha256 = null;
        a.image_subject = "placeholder_needs_replacement";
        a.image_license = {
          source: "bloom_owned",
          attribution: "Unique florist photography pending — excluded from public starter",
          review_status: "needs_replacement"
        };
        pending += 1;
        console.warn(`pending replacement: ${a.id}`);
        continue;
      }

      fs.writeFileSync(target, photo.buf);
      a.pexels_photo_id = photo.pexels_photo_id;
      a.content_sha256 = photo.hash;
      a.needs_image_replacement = false;
      a.image_subject = photo.image_subject;
      a.image_license = photo.image_license;
      a.image = `everyday/${a.id}.jpg`;
      replaced += 1;
    }
    data.generated_at = new Date().toISOString();
    data.image_source = "visual_qa_verified_replacement";
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }

  console.log(`replace-failed-floral-library-images: ${replaced} replaced, ${pending} pending, ${passIds.size} kept`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
