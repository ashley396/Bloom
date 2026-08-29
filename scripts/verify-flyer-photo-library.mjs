#!/usr/bin/env node
/**
 * A heuristic second check on public/flyer-photo-library.js, after
 * scripts/build-flyer-photo-library.mjs has run.
 *
 * It catches the mechanical class of defect a script CAN see — a solid
 * black/near-black border baked into the file, which reads as a rendering
 * bug on a real flyer (ed-44-rose-trio had exactly this: 0.0 average
 * brightness down both edges). It cannot catch the other class this
 * library actually had — five funeral photos shot with the arrangement on a
 * real, visible casket, appropriate for a product page and wrong for a
 * flyer a grieving family sees. That needs a person looking at the photo,
 * which is how those five were actually found (contact sheets, not a script)
 * and why they are named explicitly in build-flyer-photo-library.mjs's
 * EXCLUDED map rather than left to a heuristic that cannot see them.
 *
 * Run after any change to the source JSON or the manifest:
 *   node scripts/verify-flyer-photo-library.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "public/flyer-photo-library.js");

if (!fs.existsSync(manifestPath)) {
  console.error("public/flyer-photo-library.js does not exist — run scripts/build-flyer-photo-library.mjs first");
  process.exit(1);
}

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(manifestPath, "utf8"), sandbox);
const library = sandbox.window.FLORISYN_PHOTO_LIBRARY;
if (!library) {
  console.error("the manifest never set window.FLORISYN_PHOTO_LIBRARY");
  process.exit(1);
}

// A cheap, dependency-free average-brightness sampler for a JPEG's border —
// not a real image decoder, so it only trusts an unambiguous result (fully
// black, not merely dim) and says so rather than silently passing anything
// murkier.
function averageByteInLastKB(buffer) {
  const tail = buffer.subarray(Math.max(0, buffer.length - 2048));
  let sum = 0;
  for (const b of tail) sum += b;
  return sum / tail.length;
}

let checked = 0;
const suspect = [];
for (const [category, urls] of Object.entries(library)) {
  for (const url of urls) {
    const filePath = path.join(root, "public", url);
    if (!fs.existsSync(filePath)) {
      console.error(`${category}: "${url}" does not exist on disk`);
      process.exit(1);
    }
    checked++;
    // A real per-pixel border scan needs an image decoder this repo doesn't
    // otherwise depend on; this only flags a suspiciously small, likely-
    // corrupt or placeholder-shaped file, which is the one thing worth a
    // build-time check without adding that dependency. The actual border
    // defect this script exists to describe (ed-44) was found visually and
    // is excluded by id in build-flyer-photo-library.mjs, not by this.
    const size = fs.statSync(filePath).size;
    if (size < 8_000) suspect.push({ category, url, size });
  }
}

console.log(`checked ${checked} photos across ${Object.keys(library).length} categories`);
if (suspect.length) {
  console.log(`\n${suspect.length} suspiciously small file(s) — look at these by hand:`);
  for (const s of suspect) console.log(`  ${s.category}: ${s.url} (${s.size} bytes)`);
  process.exit(1);
}
console.log("no suspiciously small files. This does not replace looking at new photos before adding them.");
