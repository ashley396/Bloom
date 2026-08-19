#!/usr/bin/env node
/**
 * Interim: point every everyday Floral Library arrangement at the shared
 * on-brand placeholder (public/assets/floral-library/placeholder.svg), removing
 * the incorrect stock photos from the catalog until real generated images land.
 *
 * The original .jpg files are NOT deleted. Running
 * scripts/generate-floral-library-images.mjs later restores per-arrangement
 * images. After this script, run scripts/sync-floral-library-catalog.mjs to
 * regenerate floral-library-collection.js.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const publicDir = path.join(root, "public");
const batchFiles = [
  path.join(publicDir, "data/floral-library-everyday-50.json"),
  path.join(publicDir, "data/floral-library-everyday-batch-2.json")
];

let count = 0;
for (const file of batchFiles) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const a of data.arrangements || []) {
    a.image = "placeholder.svg";
    a.content_sha256 = "placeholder";
    // Keep arrangements in the catalog (populated with the placeholder) instead
    // of filtering them out; review_status marks them as awaiting a real photo.
    a.needs_image_replacement = false;
    a.image_license = {
      source: "florisyn_placeholder",
      attribution: "Florisyn placeholder — awaiting studio photograph",
      review_status: "placeholder"
    };
    count += 1;
  }
  data.generated_at = new Date().toISOString();
  data.image_source = "florisyn_placeholder";
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`updated ${path.basename(file)}`);
}
console.log(`floral-library-set-placeholder: ${count} arrangements pointed at placeholder.svg`);
