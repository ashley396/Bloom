#!/usr/bin/env node
/** Inject Florisyn SEO script into all public marketing HTML pages. */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "public");
const SEO_TAG = '<script src="/seo/florisyn-seo.js"></script>';

const files = [
  "login.html",
  "signup.html",
  "company/about/index.html",
  "company/services/index.html",
  "company/become-a-florist/index.html",
  "company/difference/index.html",
  "company/careers/index.html",
  "company/feedback/index.html",
  "help/index.html",
  "help/faqs/index.html",
  "help/order-delivery/index.html",
  "help/chat/index.html",
  "help/contact/index.html",
  "legal/privacy/index.html",
  "legal/terms/index.html",
  "legal/cookies/index.html",
  "legal/accessibility/index.html",
  "legal/unsubscribe/index.html",
  "sitemap/index.html",
];

let updated = 0;
for (const rel of files) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  let html = fs.readFileSync(file, "utf8");
  if (html.includes("/seo/florisyn-seo.js")) continue;
  if (html.includes("<head>")) {
    html = html.replace("<head>", `<head>${SEO_TAG}`);
  } else if (html.includes("<head ")) {
    html = html.replace(/<head[^>]*>/, (m) => `${m}${SEO_TAG}`);
  } else {
    continue;
  }
  fs.writeFileSync(file, html);
  updated++;
  console.log("injected SEO:", rel);
}
console.log(`SEO inject complete (${updated} files).`);
