import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Website Studio V2 assets are wired", () => {
  const index = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(index, /website-studio-v2\.js/);
  assert.match(index, /website-studio-v2\.css/);
  const v2 = fs.readFileSync(new URL("../public/website-studio-v2.js", import.meta.url), "utf8");
  assert.match(v2, /publish_checklist/);
  assert.match(v2, /update_seo/);
});

test("instant-website API exposes SEO and checklist actions", () => {
  const src = fs.readFileSync(new URL("../netlify/functions/instant-website.js", import.meta.url), "utf8");
  assert.match(src, /publish_checklist/);
  assert.match(src, /update_page_seo/);
  assert.match(src, /buildPublishedSeoBundle/);
});

test("storefront sitemap and robots redirects exist", () => {
  const toml = fs.readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  assert.match(toml, /sitemap\.xml/);
  assert.match(toml, /robots\.txt/);
});
