import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

/**
 * The SEO/GEO brief specified one canonical brand line — "Florisyn — made
 * from the florist's side of the counter" — and explicitly said not to use
 * "Built by florists, for florists" (or close variants) as a primary
 * tagline. Two live spots still carried that older phrasing:
 * public/company/about/'s hero eyebrow and public/login.html's footer
 * credit line. A third, public/seo/florisyn-seo.js's PAGES["/company/about/"]
 * title, was already unreachable dead code (hasStaticSeo() short-circuits
 * apply() before it's ever read, since the page has a real static
 * canonical tag) but is fixed too for correctness.
 */

const PROHIBITED = /built by (a )?florists?,?\s*(designed )?for florists/i;

test("no public page states the prohibited 'Built by florists, for florists' tagline (or a close variant)", () => {
  const htmlFiles = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".html")) htmlFiles.push(full);
    }
  }
  walk(path.join(root, "public"));
  const offenders = htmlFiles.filter((f) => PROHIBITED.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(offenders, [], `prohibited tagline still present in: ${offenders.join(", ")}`);
});

test("company/about's hero eyebrow uses the canonical brand line", () => {
  const html = fs.readFileSync(path.join(root, "public/company/about/index.html"), "utf8");
  assert.match(html, /class="eyebrow">Florisyn — made from the florist's side of the counter\./);
});

test("login.html's footer no longer states the prohibited tagline", () => {
  const html = fs.readFileSync(path.join(root, "public/login.html"), "utf8");
  assert.doesNotMatch(html, PROHIBITED);
});

test("florisyn-seo.js's dead-code fallback title for /company/about/ was also cleaned up", () => {
  const src = fs.readFileSync(path.join(root, "public/seo/florisyn-seo.js"), "utf8");
  assert.doesNotMatch(src, PROHIBITED);
});
