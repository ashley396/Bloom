#!/usr/bin/env node
/**
 * Florisyn Founder 1.0 — user-visible public HTML brand pass (safe string replaces).
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC = path.join(ROOT, "public");

const TAGLINE = "The Operating System for Modern Florists";
const MARKETING = "Where Your Passion Flowers.";

const REPLACEMENTS = [
  ["Operating system for flower shops", TAGLINE],
  ["Operating System for Flower Shops", TAGLINE],
  ["Operating system for flower shops.", TAGLINE],
  ['content="#f8edf1"', 'content="#6b8f7a"'],
  ['href="/assets/florisyn/florisyn-mark.svg"><link rel="stylesheet"', 'href="/assets/florisyn/favicon.svg" type="image/svg+xml"><link rel="stylesheet"'],
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p, out);
    else if (name.name.endsWith(".html")) out.push(p);
  }
  return out;
}

let files = 0;
for (const file of walk(PUBLIC)) {
  let text = fs.readFileSync(file, "utf8");
  let next = text;
  for (const [from, to] of REPLACEMENTS) {
    next = next.split(from).join(to);
  }
  if (next !== text) {
    fs.writeFileSync(file, next, "utf8");
    files += 1;
  }
}

console.log(`Updated ${files} HTML files under public/`);
