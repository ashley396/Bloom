#!/usr/bin/env node
/**
 * Apply Florisyn Floral Library CSV + vase-arrangement standard to Everyday JSON batches.
 * Marks failed visual QA / non-vase images as needs_image_replacement (hidden from public catalog).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  arrangementToCsvRow,
  buildImagePrompt,
  hasValidVase,
  isBlockedImageSubject,
  shouldHideFromPublicLibrary,
} from "../lib/floral-library/csv-standard.js";

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const root = process.cwd();
const publicDir = path.join(root, "public");
const qaPath = path.join(publicDir, "data/floral-library-visual-qa-results.json");
const batchFiles = [
  path.join(publicDir, "data/floral-library-everyday-50.json"),
  path.join(publicDir, "data/floral-library-everyday-batch-2.json"),
];

function loadQaFailIds() {
  if (!fs.existsSync(qaPath)) return new Set();
  const qa = JSON.parse(fs.readFileSync(qaPath, "utf8"));
  return new Set(qa.filter((r) => r.verdict === "fail").map((r) => r.id));
}

function enrichArrangement(a) {
  a.sku = a.sku || String(a.id || "").toUpperCase();
  a.occasion = a.occasion || (a.categories || ["Everyday"])[0] || "Everyday";
  a.visual_notes = a.visual_notes || a.why_it_works || "";
  a.image_prompt = a.image_prompt || buildImagePrompt(a);
  a.stem_count = (a.recipe || []).reduce((s, r) => s + Number(r.qty || 0), 0);
  return a;
}

function main() {
  const qaFailIds = loadQaFailIds();
  let visible = 0;
  let hidden = 0;
  const visibleHashes = new Set();

  for (const file of batchFiles) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const a of data.arrangements || []) {
      enrichArrangement(a);
      arrangementToCsvRow(a);

      const imagePath = path.join(publicDir, "assets/floral-library", a.image);
      const fileHash = fs.existsSync(imagePath) ? sha256(fs.readFileSync(imagePath)) : null;
      if (fileHash) a.content_sha256 = fileHash;

      const qaFail = qaFailIds.has(a.id);
      let hide =
        qaFail || shouldHideFromPublicLibrary(a) || isBlockedImageSubject(a) || !hasValidVase(a);

      if (!hide && fileHash && visibleHashes.has(fileHash)) {
        hide = true;
      }

      a.needs_image_replacement = hide;
      a.vase_arrangement_verified = !hide;
      a.image_verified = !hide;
      a.image_subject = hide ? "placeholder_needs_replacement" : "floral_arrangement";

      if (!hide && fileHash) visibleHashes.add(fileHash);

      if (hide) hidden += 1;
      else visible += 1;
    }
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  }

  console.log(
    JSON.stringify({
      visible,
      hidden,
      total: visible + hidden,
      qa_fail_ids: qaFailIds.size,
      unique_visible_image_hashes: visibleHashes.size,
    })
  );
}

main();
