import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

const REPLACEMENTS = [
  [/Bloom Technologies/g, "Florisyn Technologies"],
  [/Bloom Version 1\.0 RC1/g, "Florisyn Foundation"],
  [/<strong>Bloom<\/strong>/g, "<strong>Florisyn</strong>"],
  [/Sign in \| Bloom/g, "Sign in | Florisyn"],
  [/Create account \| Bloom/g, "Create account | Florisyn"],
  [/Forgot password \| Bloom/g, "Forgot password | Florisyn"],
  [/Reset password \| Bloom/g, "Reset password | Florisyn"],
  [/Set new password \| Bloom/g, "Set new password | Florisyn"],
  [/Verify email \| Bloom/g, "Verify email | Florisyn"],
  [/Bloom — Florist Operating System/g, "Florisyn — Operating System for Flower Shops"],
  [/Florist operating system/gi, "Operating system for flower shops"],
  [/Sign in to Bloom/g, "Sign in to Florisyn"],
  [/from Bloom/g, "from Florisyn"],
  [/Open the email from Bloom/g, "Open the email from Florisyn"],
  [/your Bloom workspace/g, "your Florisyn workspace"],
  [/Welcome to Bloom/g, "Welcome to Florisyn"],
  [/Let's bloom/gi, "Get started"],
  [/WELCOME TO BLOOM/g, "WELCOME TO FLORISYN"],
  [/Bloom Floral Library/g, "Floral Library"],
  [/Bloom Wholesale/g, "Florisyn Wholesale"],
  [/Bloom Business OS/g, "Florisyn Business OS"],
  [/Bloom SUBSCRIPTION/g, "FLORISYN SUBSCRIPTION"],
  [/Bloom Local AI/g, "Florisyn Local AI"],
  [/Bloom PROFIT SCORE/g, "FLORISYN PROFIT SCORE"],
  [/Bloom ORDER BUILDER/g, "FLORISYN ORDER BUILDER"],
  [/Bloom Technologies/g, "Florisyn Technologies"],
  [/Loading Bloom…/g, "Loading Florisyn…"],
  [/refresh Bloom\./g, "refresh Florisyn."],
  [/Bloom's 33%/g, "Florisyn's 33%"],
  [/Bloom will suggest/g, "Florisyn will suggest"],
  [/shopSettings\?\.name\|\|"Bloom"/g, 'shopSettings?.name||"Florisyn"'],
  [/shopSettings\?\.name \|\| "Bloom"/g, 'shopSettings?.name || "Florisyn"'],
  [/BLOOM PAYMENTS/g, "FLORISYN PAYMENTS"],
  [/Bloom Florist/g, "Florisyn Shop"],
  [/name: env\.BLOOM_EMAIL_FROM_NAME \|\| "Bloom"/g, 'name: env.BLOOM_EMAIL_FROM_NAME || "Florisyn"'],
  [/Unexpected Bloom/g, "Unexpected Florisyn"],
  [/Bloom University/g, "Florisyn University"],
  [/BloomShot Studio/g, "Florisyn Photo Studio"],
  [/Bloom v23/g, "Florisyn Studio"],
  [/BLOOM WHOLESALE/g, "FLORISYN WHOLESALE"],
  [/BLOOM v23/g, "FLORISYN STUDIO"],
  [/BLOOM LOCAL AI/g, "FLORISYN LOCAL AI"],
  [/BLOOM PROFIT/g, "FLORISYN PROFIT"],
  [/luxury florist command center/gi, "Florisyn Command Center"],
  [/Your luxury florist command center\./g, "Your Florisyn Command Center."],
  [/assets\/bloom-favicon\.svg/g, "/assets/florisyn/favicon.svg"],
  [/assets\/bloom-mark\.svg/g, "/assets/florisyn/florisyn-mark.svg"],
  [/assets\/bloom-wordmark\.svg/g, "/assets/florisyn/florisyn-wordmark.svg"],
  [/assets\/bloom-icon\.svg/g, "/assets/florisyn/florisyn-mark.svg"]
];

const SKIP = (rel) =>
  rel.includes("assets/bloom-") ||
  rel.includes("assets/daisy") ||
  rel.endsWith("florisyn-version.js") ||
  rel.includes("node_modules");

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(root, full).replace(/\\/g, "/");
    if (SKIP(rel)) continue;
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(html|webmanifest|js|css|md)$/.test(name) && rel.startsWith("public/")) out.push(full);
    else if (rel.startsWith("netlify/functions/_shared/notification-email.js")) out.push(full);
    else if (rel === "netlify/functions/_shared/bloom-release.js") out.push(full);
    else if (rel === "netlify/functions/health.js") out.push(full);
    else if (rel.startsWith("netlify/functions/_shared/production.js")) out.push(full);
    else if (rel.startsWith("tests/bloom-auth-branding.test.js")) out.push(full);
  }
  return out;
}

let filesChanged = 0;
for (const file of walk(publicDir)) {
  let text = fs.readFileSync(file, "utf8");
  let next = text;
  for (const [re, rep] of REPLACEMENTS) next = next.replace(re, rep);
  if (next !== text) {
    fs.writeFileSync(file, next, "utf8");
    filesChanged++;
  }
}

for (const extra of [
  path.join(root, "netlify/functions/_shared/notification-email.js"),
  path.join(root, "netlify/functions/_shared/bloom-release.js"),
  path.join(root, "netlify/functions/health.js"),
  path.join(root, "tests/bloom-auth-branding.test.js")
]) {
  if (!fs.existsSync(extra)) continue;
  let text = fs.readFileSync(extra, "utf8");
  let next = text;
  for (const [re, rep] of REPLACEMENTS) next = next.replace(re, rep);
  if (next !== text) {
    fs.writeFileSync(extra, next, "utf8");
    filesChanged++;
  }
}

console.log(`Florisyn copy pass: ${filesChanged} files updated`);
