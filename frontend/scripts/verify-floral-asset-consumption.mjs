#!/usr/bin/env node
/**
 * Ensures no hardcoded floral asset paths outside the catalog module.
 * Run via: npm run lint (frontend)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_ROOT = join(import.meta.dirname, "../src");
const CATALOG_ALLOWLIST = new Set([
  "lib/floristry-photo-library.ts",
]);

const PATH_PATTERN = /["'`]\/assets\/[^"'`\s]+["'`]/g;

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules") continue;
      walk(full, files);
    } else if (/\.(tsx?|jsx?)$/.test(name)) {
      files.push(full);
    }
  }
  return files;
}

let failed = false;

for (const file of walk(SRC_ROOT)) {
  const rel = relative(SRC_ROOT, file).replaceAll("\\", "/");
  if (CATALOG_ALLOWLIST.has(rel)) continue;

  const text = readFileSync(file, "utf8");
  const matches = text.match(PATH_PATTERN);
  if (!matches) continue;

  console.error(
    `[floral-asset-library] Hardcoded asset path in ${rel}:\n  ${matches.join("\n  ")}\n  → Import FloralAssetId from lib/floral-asset-library instead.`,
  );
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log("[floral-asset-library] No hardcoded /assets paths outside catalog.");
