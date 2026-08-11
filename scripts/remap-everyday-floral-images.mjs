#!/usr/bin/env node
/**
 * Recipe-aware remapping using ONLY verified florist arrangement photos.
 * Keeps visual-QA pass assets unchanged; replaces fail cards from verified pool.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import verifiedConfig from "../public/data/floral-library-verified-pexels.json" with { type: "json" };
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
const mapOutPath = path.join(publicDir, "data/floral-library-everyday-image-map.json");
const batchFiles = [
  path.join(publicDir, "data/floral-library-everyday-50.json"),
  path.join(publicDir, "data/floral-library-everyday-batch-2.json")
];

const BLACKLIST = new Set(verifiedConfig.blacklist || []);
const VERIFIED_IDS = [...new Set(verifiedConfig.verified || [])].filter((id) => !BLACKLIST.has(id));

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function downloadPhoto(photoId) {
  const res = await fetch(pexelsDownloadUrl(photoId), {
    headers: { "User-Agent": "Florisyn-Floral-Library/1.0" }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for Pexels ${photoId}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 25000 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error(`Invalid JPEG for Pexels ${photoId} (${buf.length} bytes)`);
  }
  return buf;
}

function arrangementKeywords(a) {
  return [
    a.name,
    a.style,
    a.color_palette,
    a.container,
    a.arrangement_type,
    ...(a.categories || []),
    ...(a.recipe || []).map((r) => r.name)
  ]
    .join(" ")
    .toLowerCase();
}

function scoreMatch(arrangement, photoId) {
  const text = arrangementKeywords(arrangement);
  let score = 0;
  const rules = [
    [/sunflower|sunshine|golden|yellow|bright|citrus/, ["sunflower", "yellow", "bright", "6913095", "6913101"]],
    [/hydrangea|blue, white|blue and white/, ["hydrangea", "blue", "white", "931168", "34638178"]],
    [/daisy|mum|cheerful/, ["daisy", "mum", "cheerful", "16434315", "36312278"]],
    [/rose|romance|pink meadow|classic rose/, ["rose", "pink", "romance", "27952001", "6913075"]],
    [/lavender|purple|pastel|blush|feminine|peach/, ["lavender", "purple", "pastel", "blush", "6913081", "931173"]],
    [/white|sympathy|calm|clean|simple white|modern white/, ["white", "sympathy", "6913091", "6913090", "16434315"]],
    [/rustic|mason|jar|market|wildflower/, ["rustic", "mason", "jar", "37320544", "931174"]],
    [/lily|elegance|luxury|ceramic/, ["lily", "elegance", "36306211", "28739008"]],
    [/alstroemeria|mixed brights|color pop|color burst/, ["alstroemeria", "bright", "19300878", "6913086"]],
    [/garden|medley|everyday|tabletop/, ["garden", "everyday", "8211577", "35001312"]]
  ];
  for (const [pattern, boost] of rules) {
    if (pattern.test(text)) {
      for (const tag of boost) {
        if (String(photoId).includes(tag) || text.includes(tag)) score += 3;
      }
    }
  }
  if (/cube|cylinder|vase|pitcher|jar/.test(text) && /69130|8211577|16434315|28739008/.test(String(photoId))) score += 2;
  return score;
}

function loadQa() {
  const qa = JSON.parse(fs.readFileSync(qaPath, "utf8"));
  return {
    passIds: new Set(qa.filter((r) => r.verdict === "pass").map((r) => r.id)),
    failIds: new Set(qa.filter((r) => r.verdict === "fail").map((r) => r.id))
  };
}

async function main() {
  const { passIds, failIds } = loadQa();
  fs.mkdirSync(everydayDir, { recursive: true });

  const photoCache = new Map();
  async function getPhoto(photoId) {
    if (!photoCache.has(photoId)) {
      photoCache.set(photoId, { buf: await downloadPhoto(photoId), hash: null });
      photoCache.get(photoId).hash = sha256(photoCache.get(photoId).buf);
    }
    return photoCache.get(photoId);
  }

  const usedHashes = new Set();
  const usedPexels = new Set();
  const imageMap = {};
  let kept = 0;

  for (const file of batchFiles) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const a of data.arrangements || []) {
      if (!passIds.has(a.id)) continue;
      const target = path.join(everydayDir, `${a.id}.jpg`);
      if (fs.existsSync(target)) usedHashes.add(sha256(fs.readFileSync(target)));
      if (a.pexels_photo_id) usedPexels.add(String(a.pexels_photo_id));
      imageMap[a.id] = { pexels_photo_id: a.pexels_photo_id, source: "visual_qa_pass", kept: true };
      kept += 1;
    }
  }

  let remapped = 0;
  let pending = 0;

  async function assignLocal(arrangement) {
    const ranked = FLORISYN_ARRANGEMENT_SOURCES.map((source) => ({
      source,
      score: scoreLocalMatch(arrangement, source)
    })).sort((x, y) => y.score - x.score);

    for (const { source } of ranked) {
      const filePath = path.join(publicDir, source.file);
      if (!fs.existsSync(filePath)) continue;
      const buf = fs.readFileSync(filePath);
      const hash = sha256(buf);
      if (usedHashes.has(hash)) continue;
      usedHashes.add(hash);
      return {
        buf,
        hash,
        pexels_photo_id: null,
        image_license: {
          source: "bloom_owned",
          attribution: `Florisyn arrangement photography — ${path.basename(source.file)}`,
          review_status: "approved"
        },
        score: 0
      };
    }
    return null;
  }

  for (const file of batchFiles) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const a of data.arrangements || []) {
      if (passIds.has(a.id) || !failIds.has(a.id)) continue;

      const ranked = VERIFIED_IDS.filter((id) => !usedPexels.has(id))
        .map((id) => ({ id, score: scoreMatch(a, id) }))
        .sort((x, y) => y.score - x.score || Number(y.id) - Number(x.id));

      let photo = null;
      for (const pick of ranked) {
        try {
          const downloaded = await getPhoto(pick.id);
          if (usedHashes.has(downloaded.hash)) continue;
          usedPexels.add(pick.id);
          usedHashes.add(downloaded.hash);
          photo = {
            buf: downloaded.buf,
            hash: downloaded.hash,
            pexels_photo_id: pick.id,
            image_license: {
              source: "licensed_stock_pexels",
              attribution: pexelsAttribution(pick.id),
              review_status: "approved"
            },
            score: pick.score
          };
          break;
        } catch {
          /* try next */
        }
      }

      if (!photo) photo = await assignLocal(a);

      if (!photo) {
        a.needs_image_replacement = true;
        a.pexels_photo_id = null;
        a.content_sha256 = null;
        imageMap[a.id] = { source: "pending", kept: false };
        pending += 1;
        console.warn(`pending: ${a.id}`);
        continue;
      }

      fs.writeFileSync(path.join(everydayDir, `${a.id}.jpg`), photo.buf);
      a.pexels_photo_id = photo.pexels_photo_id;
      a.content_sha256 = photo.hash;
      a.needs_image_replacement = false;
      a.image = `everyday/${a.id}.jpg`;
      a.image_license = photo.image_license;
      imageMap[a.id] = {
        pexels_photo_id: photo.pexels_photo_id,
        source: photo.pexels_photo_id ? "verified_pexels" : "bloom_owned",
        match_score: photo.score,
        kept: false
      };
      remapped += 1;
    }
    data.generated_at = new Date().toISOString();
    data.image_source = "verified_florist_pexels_v2";
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }

  fs.writeFileSync(
    mapOutPath,
    `${JSON.stringify({ version: 2, generated_at: new Date().toISOString(), arrangements: imageMap }, null, 2)}\n`
  );

  console.log(`remap-everyday-floral-images: kept ${kept}, remapped ${remapped}, pending ${pending}`);
  if (pending > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
