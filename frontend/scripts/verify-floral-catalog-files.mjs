#!/usr/bin/env node
/**
 * Validates on-disk files for every Floral Asset Library catalog entry.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_TS = join(ROOT, "src/lib/floristry-photo-library.ts");
const PUBLIC = join(ROOT, "public");

/** Catalog IDs allowed to ship without a file until gift UI exists. */
const OPTIONAL_FILE_IDS = new Set(["premium-chocolate-gift"]);

const catalogSource = readFileSync(CATALOG_TS, "utf8");

const entries = [];
const idBlock = catalogSource.matchAll(
  /"([a-z0-9-]+)":\s*\{\s*id:\s*"([^"]+)",\s*file:\s*(?:`\$\{floristryBase\}([^`]+)`|"(\/assets\/[^"]+)")/g,
);

for (const match of idBlock) {
  const catalogId = match[1];
  const floristryRel = match[3];
  const absoluteWebPath = match[4];
  if (!floristryRel && !absoluteWebPath) continue;

  const webPath = absoluteWebPath ?? `/assets/floristry${floristryRel}`;
  const publicPath = absoluteWebPath
    ? join(PUBLIC, absoluteWebPath.replace(/^\//, ""))
    : join(PUBLIC, "assets", "floristry", floristryRel.replace(/^\//, ""));

  entries.push({ catalogId, publicPath, webPath });
}

if (entries.length === 0) {
  console.error("[floral-catalog] Could not parse catalog entries.");
  process.exit(1);
}

let failed = false;
const hashes = new Map();

for (const { catalogId, publicPath, webPath } of entries) {
  const optional = OPTIONAL_FILE_IDS.has(catalogId);
  if (!existsSync(publicPath)) {
    if (optional) {
      console.warn(`[floral-catalog] Optional asset missing: ${catalogId} → ${webPath}`);
      continue;
    }
    console.error(`[floral-catalog] Missing file for ${catalogId}: ${publicPath}`);
    failed = true;
    continue;
  }

  const buf = readFileSync(publicPath);
  const size = statSync(publicPath).size;
  if (size < 8000) {
    console.error(`[floral-catalog] File too small for ${catalogId}: ${size} bytes`);
    failed = true;
  }
  if (buf[0] !== 0xff || buf[1] !== 0xd8) {
    console.error(`[floral-catalog] Not a JPEG: ${catalogId} → ${publicPath}`);
    failed = true;
  }

  const hash = createHash("md5").update(buf).digest("hex");
  const prior = hashes.get(hash);
  if (prior) {
    console.error(
      `[floral-catalog] Duplicate image bytes: ${catalogId} shares file with ${prior}`,
    );
    failed = true;
  } else {
    hashes.set(hash, catalogId);
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  `[floral-catalog] Verified ${entries.length} catalog entries (${OPTIONAL_FILE_IDS.size} optional may be absent).`,
);
