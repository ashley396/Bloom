import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

/**
 * /company/compare/ and /company/case-studies/ are real, fully-built
 * pages — linked from login/signup nav and from each other — but weren't
 * reachable from the site's own footer navigation or /sitemap/ on any
 * page, so they were effectively orphaned from normal site navigation.
 * compare/index.html and case-studies/index.html also had a stripped-down
 * copyright-only footer instead of the standard site-wide footer every
 * other marketing page uses. Verifies every public marketing page's
 * footer (and the sitemap) links to both.
 */
const PUBLIC_PAGES = [
  "public/company/about/index.html",
  "public/company/become-a-florist/index.html",
  "public/company/careers/index.html",
  "public/company/compare/index.html",
  "public/company/case-studies/index.html",
  "public/company/difference/index.html",
  "public/company/feedback/index.html",
  "public/company/pricing/index.html",
  "public/company/services/index.html",
  "public/help/index.html",
  "public/help/chat/index.html",
  "public/help/contact/index.html",
  "public/help/faqs/index.html",
  "public/help/order-delivery/index.html",
  "public/legal/accessibility/index.html",
  "public/legal/cookies/index.html",
  "public/legal/privacy/index.html",
  "public/legal/terms/index.html",
  "public/legal/unsubscribe/index.html",
  "public/sitemap/index.html",
];

for (const rel of PUBLIC_PAGES) {
  test(`${rel} links to both Compare and Case Studies`, () => {
    const html = fs.readFileSync(path.join(root, rel), "utf8");
    assert.match(html, /href="\/company\/compare\/"/, `${rel} missing a link to /company/compare/`);
    assert.match(html, /href="\/company\/case-studies\/"/, `${rel} missing a link to /company/case-studies/`);
  });
}

test("compare and case-studies pages use the standard multi-column footer, not a bare copyright line", () => {
  for (const rel of ["public/company/compare/index.html", "public/company/case-studies/index.html"]) {
    const html = fs.readFileSync(path.join(root, rel), "utf8");
    assert.match(html, /<h3>Our Company<\/h3>/, `${rel} missing standard footer nav`);
    assert.match(html, /<h3>Help &amp; Support<\/h3>|<h3>Help & Support<\/h3>/, `${rel} missing Help & Support column`);
  }
});
