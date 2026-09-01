#!/usr/bin/env node
/**
 * Netlify build hook — writes deploy id for cache busting and visible build stamps.
 * Runs on every Netlify deploy (see netlify.toml [build].command).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildStampInfo } from "./lib/marketing-build-stamp-info.mjs";

const root = process.cwd();

const materialize = spawnSync(process.execPath, [path.join(root, "scripts/materialize-floral-library-images.mjs")], {
  stdio: "inherit"
});
if (materialize.status !== 0) {
  process.exit(materialize.status ?? 1);
}

const deployId =
  process.env.NETLIFY_DEPLOY_ID ||
  process.env.COMMIT_REF?.slice(0, 12) ||
  process.env.GITHUB_SHA?.slice(0, 12) ||
  `local-${Date.now()}`;

const stamp = String(deployId).replace(/"/g, "");

fs.writeFileSync(
  path.join(root, "public/florisyn-build.js"),
  `/** Auto-generated on deploy — do not edit. */\nwindow.FLORISYN_BUILD_ID=${JSON.stringify(stamp)};\n`
);

// Batch 6, Part D: the exact source commit/environment a given build
// actually came from, in one small, real JSON file — never a heavy
// build-info subsystem. buildStampInfo() itself lives in its own
// side-effect-free module (scripts/lib/marketing-build-stamp-info.mjs) so
// it's independently unit-testable; this is just where it gets written.
fs.writeFileSync(path.join(root, "public/florisyn-build-info.json"), JSON.stringify(buildStampInfo(), null, 2) + "\n");

const versionPath = path.join(root, "public/florisyn-version.js");
let versionSrc = fs.readFileSync(versionPath, "utf8");
if (/build:\s*"/.test(versionSrc)) {
  versionSrc = versionSrc.replace(/build:\s*"[^"]*"/, `build: ${JSON.stringify(stamp)}`);
} else {
  versionSrc = versionSrc.replace(
    /(code:\s*"[^"]+",?\n)/,
    `$1  build: ${JSON.stringify(stamp)},\n`
  );
}
fs.writeFileSync(versionPath, versionSrc);

const cacheBustTargets = [
  "public/signup.html",
  "public/admin.html",
  "public/company/pricing/index.html",
  "public/index.html",
  "public/login.html"
];

const bustedFiles = [
  "pricing.js",
  "signup.js",
  "admin.js",
  "admin-mfa.js",
  "florisyn-version.js",
  "florisyn-build.js",
  "app.js",
  "pricing-catalog.js",
  "admin-a11y-polish.css",
  "florisyn-router.js",
  "florisyn-luxury-pos.js",
  "florisyn-luxury-orders.js",
  "florisyn-luxury-business-os.js",
  "florisyn-atelier-dashboard.js",
  "floral-library-ui.js",
  "floral-library-collection.js",
  "floral-media.js"
];

for (const rel of cacheBustTargets) {
  const filePath = path.join(root, rel);
  if (!fs.existsSync(filePath)) continue;
  let html = fs.readFileSync(filePath, "utf8");
  for (const asset of bustedFiles) {
    const re = new RegExp(`(/${asset.replace(".", "\\.")})(\\?v=[^"'\\s>]*)?`, "g");
    html = html.replace(re, `$1?v=${stamp}`);
  }
  if (!html.includes("florisyn-build.js")) {
    html = html.replace(/<\/head>/i, `  <script src="/florisyn-build.js?v=${stamp}"></script>\n</head>`);
  }
  if (rel.endsWith("admin.html") && !html.includes("florisyn-version.js")) {
    html = html.replace(
      /<script src="\/admin\.js(\?v=[^"]*)?"/,
      `<script src="/florisyn-version.js?v=${stamp}" defer></script><script src="/admin.js$1"`
    );
    html = html.replace('<script src="/bloom-version.js" defer></script>', "");
  }
  fs.writeFileSync(filePath, html);
}

console.log(`stamp-build: ${stamp}`);
