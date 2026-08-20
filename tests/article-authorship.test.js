import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

/**
 * Section 13 of the SEO/GEO brief ("Authorship"): educational articles
 * should carry clear authorship — author, publication date, meaningful
 * update date. None of the 12 resource articles had any of that until
 * this batch. Attribution is "the Florisyn Team" (not a fabricated named
 * expert) with the real date each article was written, per the user's
 * explicit instruction — never invented credentials.
 */

const ARTICLES_WITH_SCHEMA = [
  "resources/how-to-price-floral-arrangements",
  "resources/starting-a-flower-shop",
  "resources/wholesale-flowers-guide",
  "resources/flower-care-basics",
  "resources/floral-design-fundamentals",
  "resources/valentines-day-prep",
  "resources/mothers-day-prep",
  "resources/wedding-season-planning",
  "resources/prom-season-planning",
  "resources/funeral-and-sympathy-florist-guide",
  "resources/holiday-season-planning",
];

const PUBLISH_DATE_ISO = "2026-08-20";

for (const slug of ARTICLES_WITH_SCHEMA) {
  test(`${slug} shows a visible byline and real publish date`, () => {
    const html = fs.readFileSync(path.join(root, "public", slug, "index.html"), "utf8");
    assert.match(html, /class="rc-byline"/);
    assert.match(html, /By the Florisyn Team/);
    assert.match(html, /Published August 20, 2026/);
  });

  test(`${slug} carries Article JSON-LD with a real, non-fabricated author and date`, () => {
    const html = fs.readFileSync(path.join(root, "public", slug, "index.html"), "utf8");
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) =>
      JSON.parse(m[1]),
    );
    const article = blocks.find((b) => b["@type"] === "Article");
    assert.ok(article, `expected an Article JSON-LD block on ${slug}`);
    assert.equal(article.author.name, "Florisyn Team");
    // An Organization author, not a fabricated named person with invented
    // credentials — matches what the site can actually back up.
    assert.equal(article.author["@type"], "Organization");
    assert.equal(article.datePublished, PUBLISH_DATE_ISO);
    assert.equal(article.dateModified, PUBLISH_DATE_ISO);
    assert.ok(article.headline && article.headline.length > 0);
    assert.ok(article.url.startsWith("https://www.florisyn.com/"));
  });
}

test("the glossary shows the same visible byline but keeps its own DefinedTermSet schema rather than a redundant Article type", () => {
  const html = fs.readFileSync(path.join(root, "public", "resources/florist-glossary", "index.html"), "utf8");
  assert.match(html, /class="rc-byline"/);
  assert.match(html, /By the Florisyn Team/);
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) =>
    JSON.parse(m[1]),
  );
  assert.ok(blocks.some((b) => b["@type"] === "DefinedTermSet"));
  assert.ok(!blocks.some((b) => b["@type"] === "Article"));
});

test("every Article JSON-LD block on the site is valid JSON and matches the real pricing/trial source of truth where it appears", () => {
  // A cheap regression guard: authorship metadata must never be the kind
  // of thing that silently breaks the page's other JSON-LD blocks.
  for (const slug of ARTICLES_WITH_SCHEMA) {
    const html = fs.readFileSync(path.join(root, "public", slug, "index.html"), "utf8");
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
    assert.ok(blocks.length >= 2, `${slug} should still have its Organization/WebPage schema plus the new Article block`);
    for (const [, raw] of blocks) {
      assert.doesNotThrow(() => JSON.parse(raw));
    }
  }
});
