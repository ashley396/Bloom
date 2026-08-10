#!/usr/bin/env node
/** Generate public/robots.txt and public/sitemap.xml from lib/seo/florisyn-seo.js */
import fs from "node:fs";
import path from "node:path";
import { buildSitemapXml, robotsTxtContent, FLORISYN_SITE } from "../lib/seo/florisyn-seo.js";

const root = path.resolve(import.meta.dirname, "..");
const baseUrl = process.env.SITE_URL || process.env.URL || FLORISYN_SITE.baseUrl;

fs.writeFileSync(path.join(root, "public/robots.txt"), robotsTxtContent(baseUrl));
fs.writeFileSync(path.join(root, "public/sitemap.xml"), buildSitemapXml(baseUrl));
console.log("SEO: wrote public/robots.txt and public/sitemap.xml for", baseUrl);
