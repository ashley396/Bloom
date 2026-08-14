import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const src = path.join(root, "node_modules/@imgly/background-removal/dist/index.mjs");
const destDir = path.join(root, "public/vendor");
const dest = path.join(destDir, "imgly-background-removal.mjs");

if (!fs.existsSync(src)) {
  console.error("Missing @imgly/background-removal — run npm install first.");
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`Synced HQ vendor bundle to ${dest}`);

// @imgly/background-removal internally does `import("onnxruntime-web")` — a
// bare module specifier. Browsers cannot resolve that without either a
// bundler or an import map, so it must be vendored too (paired with the
// importmap in index.html pointing "onnxruntime-web" at this file). Missing
// this was the root cause of the HQ removal path failing 100% of the time
// with "Failed to resolve module specifier 'onnxruntime-web'".
const ortSrc = path.join(root, "node_modules/onnxruntime-web/dist/ort.bundle.min.mjs");
const ortDestDir = path.join(root, "public/vendor/onnxruntime-web");
const ortDest = path.join(ortDestDir, "ort.bundle.min.mjs");
if (!fs.existsSync(ortSrc)) {
  console.error("Missing onnxruntime-web — run npm install first.");
  process.exit(1);
}
fs.mkdirSync(ortDestDir, { recursive: true });
fs.copyFileSync(ortSrc, ortDest);
console.log(`Synced onnxruntime-web vendor bundle to ${ortDest}`);
