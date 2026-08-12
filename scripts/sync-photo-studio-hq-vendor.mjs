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
