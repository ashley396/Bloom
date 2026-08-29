#!/usr/bin/env node
/**
 * Builds public/flyer-photo-library.js — a plain browser-loadable manifest of
 * real, verified floral photographs, grouped by the occasion categories the
 * poster layer (public/flyer-poster.js) can actually detect from a flyer's
 * own wording.
 *
 * Why this exists. Every poster this product has ever drawn, sympathy or
 * celebratory, closing notice or wedding announcement, used the exact same
 * single hardcoded photograph — FALLBACK_FLORAL_BACKGROUND in
 * flyer-renderer.js — whenever no AI-generated background existed. Ashley:
 * "it's just using the same 4 designs over and over with different flowers
 * and colors" was literally true of the photo itself: it was never different.
 *
 * A real, occasion-tagged, human-curated library already exists —
 * lib/floral-library/everyday-arrangements.js, the source for the shop's own
 * Floral Library / product catalog feature — with hundreds of real,
 * professionally-styled photographs. It was simply never wired into the
 * poster's background choice. This script is the wiring: it reads the same
 * source JSON the product catalog uses, keeps only entries with a REAL,
 * verified photograph (needs_image_replacement !== true — a placeholder pixel
 * must never be presented as a real arrangement on a customer-facing flyer),
 * confirms the file genuinely exists on disk, and groups the survivors by
 * category into a small, static, dependency-free JS file the browser can load
 * exactly the way it already loads flyer-poster.js — no fetch, no async
 * lookup, no server round-trip.
 *
 * Run this whenever the underlying floral-library-*.json data changes:
 *   node scripts/build-flyer-photo-library.mjs
 *
 * It fails loudly (non-zero exit) if any category ends up empty, or if any
 * referenced image is missing from disk — the poster's own fallback-of-last-
 * resort (the single hardcoded photo) stays in flyer-poster.js as the safety
 * net for exactly that case, but this script should never silently ship one.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "public/data");
const assetsDir = path.join(root, "public/assets/floral-library");
const outPath = path.join(root, "public/flyer-photo-library.js");

/**
 * Which source files feed which poster-facing category. Funeral and sympathy
 * are merged: the poster's own isSympathyContent treats them as one bucket
 * (a florist supplies sympathy AND funeral flowers the same way), so a finer
 * split here would be a distinction the rest of the code doesn't make.
 * "everyday" only draws from batch 1 — batch 2 is 49/50 placeholder photos
 * and would fail the verified-photo filter down to almost nothing anyway.
 */
const SOURCES = {
  sympathy: ["floral-library-funeral.json", "floral-library-sympathy.json"],
  wedding: ["floral-library-wedding.json"],
  celebration: ["floral-library-birthday.json", "floral-library-congratulations.json"],
  everyday: ["floral-library-everyday-50.json"]
};

/**
 * "needs_image_replacement" only certifies that a photo is real, not that it
 * is FIT for a customer's flyer. Every one of the ~129 verified photos was
 * opened and looked at (contact sheets, not just filenames — "fn-23-
 * standing-spray-pink-lilies-church" gave no hint it would show one) before
 * this list was written. Two real problems, found that way and nowhere else:
 *
 *  - Five funeral-catalog photos are shot with the arrangement ON a real,
 *    visible casket — church candles, brass handles, the lid itself in
 *    frame. Fine for a product page showing what a piece looks like in
 *    place; wrong for a marketing flyer a grieving family sees on Facebook,
 *    which should show the flowers, never the casket they rest on.
 *  - One everyday photo (ed-44) has solid black pillarboxing baked into the
 *    file itself — a production export artifact, not a design choice. It
 *    would read as a rendering bug on a real flyer.
 *
 * Re-run scripts/verify-flyer-photo-library.mjs after any change to the
 * source JSON or this list — it re-opens every surviving photo's dimensions
 * and scans for exactly this second class of defect (a solid border),
 * though the casket problem needs an eye, not a heuristic, and was checked
 * that way for every photo this manifest can select.
 */
const EXCLUDED = {
  "fn-17-casket-adornment": "shows a real, visible casket",
  "fn-21-casket-spray-red-white-silver": "shows a real, visible casket",
  "fn-22-casket-spray-red-white-lilies": "shows a real, visible casket",
  "fn-23-standing-spray-pink-lilies-church": "shows a real, visible casket in the background",
  "fn-24-casket-spray-lavender-purple": "shows a real, visible casket",
  "ed-44-rose-trio": "solid black pillarboxing baked into the file"
};

const library = {};
let totalEntries = 0;
let excludedCount = 0;

for (const [category, files] of Object.entries(SOURCES)) {
  const urls = [];
  for (const file of files) {
    const filePath = path.join(dataDir, file);
    if (!fs.existsSync(filePath)) {
      console.error(`missing source file: ${file}`);
      process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    for (const arrangement of data.arrangements || []) {
      // A placeholder is never real visual proof, and a flyer is customer-
      // facing — the one place this rule cannot be relaxed.
      if (arrangement.needs_image_replacement) continue;
      if (arrangement.id in EXCLUDED) { excludedCount++; continue; }
      if (!arrangement.image) continue;
      const onDisk = path.join(assetsDir, arrangement.image);
      if (!fs.existsSync(onDisk)) {
        console.error(`${file}: ${arrangement.id} points at a missing file: ${arrangement.image}`);
        process.exit(1);
      }
      urls.push(`/assets/floral-library/${arrangement.image}`);
    }
  }
  if (!urls.length) {
    console.error(`category "${category}" ended up with zero verified photos`);
    process.exit(1);
  }
  // Deterministic order — the file this script writes should not vary run to
  // run just because JSON key order or filesystem listing order shifted.
  urls.sort();
  library[category] = urls;
  totalEntries += urls.length;
}

const banner = `/**
 * Auto-generated by scripts/build-flyer-photo-library.mjs — do not hand-edit.
 * Re-run that script after changing the floral-library-*.json data files.
 *
 * A plain, static manifest of real, verified floral photographs, grouped by
 * the occasion categories public/flyer-poster.js can detect from a flyer's
 * own wording. Every URL here was checked at build time to point at a real
 * file with a genuine, non-placeholder photograph — never a stand-in pixel.
 */
`;

const body = `window.FLORISYN_PHOTO_LIBRARY = ${JSON.stringify(library, null, 2)};\n`;

fs.writeFileSync(outPath, banner + body);
console.log(`wrote ${path.relative(root, outPath)}`);
for (const [category, urls] of Object.entries(library)) {
  console.log(`  ${category.padEnd(12)} ${urls.length} photos`);
}
console.log(`${totalEntries} verified photos total (${excludedCount} excluded — see EXCLUDED above)`);
