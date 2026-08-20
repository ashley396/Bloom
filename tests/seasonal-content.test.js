import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

/**
 * Section 18 of the SEO/GEO brief called for real seasonal-authority
 * content (Valentine's Day, Mother's Day, Wedding Season, Prom,
 * Funeral/Sympathy, Holiday planning) with "practical operational
 * advice, not just promotional" — none of it existed anywhere on the
 * public site until this batch.
 */

const ARTICLES = [
  ["resources/valentines-day-prep", "Valentine's Day Prep"],
  ["resources/mothers-day-prep", "Mother's Day Prep"],
  ["resources/wedding-season-planning", "Wedding Season Planning"],
  ["resources/prom-season-planning", "Prom Season Planning"],
  ["resources/funeral-and-sympathy-florist-guide", "Funeral & Sympathy Guide"],
  ["resources/holiday-season-planning", "Holiday Season Planning"],
];

for (const [slug, titleFragment] of ARTICLES) {
  test(`${slug} exists, gives operational guidance (steps/checklist), and isn't just promotional`, () => {
    const html = fs.readFileSync(path.join(root, "public", slug, "index.html"), "utf8");
    assert.match(html, new RegExp(titleFragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // Real operational structure — a timeline (rc-steps) and/or a
    // checklist (rc-checklist), not just prose promoting Florisyn.
    const hasSteps = /class="rc-step"/.test(html);
    const hasChecklist = /class="rc-checklist"/.test(html);
    assert.ok(hasSteps || hasChecklist, "expected a real steps/checklist structure, not just prose");
    // FAQ schema present and matches the standard pattern used across
    // this initiative.
    assert.match(html, /"@type": "FAQPage"/);
    assert.match(html, /"@type": "BreadcrumbList"/);
  });
}

test("the /resources hub has a Seasonal Florist Planning category linking to all 6 seasonal articles", () => {
  const html = fs.readFileSync(path.join(root, "public/resources/index.html"), "utf8");
  assert.match(html, /<h3>Seasonal Florist Planning<\/h3>/);
  for (const [slug] of ARTICLES) {
    assert.match(html, new RegExp(`href="/${slug}/"`));
  }
});

test("sitemap.xml includes all 6 seasonal article URLs", () => {
  const xml = fs.readFileSync(path.join(root, "public/sitemap.xml"), "utf8");
  for (const [slug] of ARTICLES) {
    assert.match(xml, new RegExp(`<loc>https://www\\.florisyn\\.com/${slug}/</loc>`));
  }
});
