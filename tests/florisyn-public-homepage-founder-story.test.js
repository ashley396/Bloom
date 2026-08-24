import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Founder Story pass: adds Ashley's real story + approved portrait to the
// public marketing homepage (public/index.html), below the product/pricing
// story and above the FAQ/CTA close. These tests protect: the exact
// approved portrait asset stays wired in (never swapped for a placeholder
// or regenerated image), the section sits in the right place in the page
// flow, the required headline/founder identification are present, existing
// sections are untouched, and the image markup is accessible.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appHtml = fs.readFileSync(path.join(repoRoot, "public/index.html"), "utf8");
const homepageCss = fs.readFileSync(path.join(repoRoot, "public/homepage-public.css"), "utf8");

function sectionIndex(marker) {
  const i = appHtml.indexOf(marker);
  assert.notEqual(i, -1, `expected to find "${marker}" in public/index.html`);
  return i;
}

test("Founder Story: the approved portrait asset is wired in, at real files on disk", () => {
  assert.match(appHtml, /src="\/assets\/florisyn\/florisyn-founder-ashley\.webp\?v=founder1"/);
  assert.match(appHtml, /srcset="\/assets\/florisyn\/florisyn-founder-ashley-mobile\.webp\?v=founder1"/);

  const desktop = path.join(repoRoot, "public/assets/florisyn/florisyn-founder-ashley.webp");
  const mobile = path.join(repoRoot, "public/assets/florisyn/florisyn-founder-ashley-mobile.webp");
  assert.ok(fs.existsSync(desktop), "desktop founder portrait derivative must exist on disk");
  assert.ok(fs.existsSync(mobile), "mobile founder portrait derivative must exist on disk");

  // Optimized for web, not shipping a raw multi-megabyte original.
  assert.ok(fs.statSync(desktop).size < 400 * 1024, "desktop derivative should be web-optimized (<400KB)");
  assert.ok(fs.statSync(mobile).size < 200 * 1024, "mobile derivative should be web-optimized (<200KB)");
});

test("Founder Story: alt text identifies Ashley without marketing copy stuffed in", () => {
  const match = appHtml.match(/<img src="\/assets\/florisyn\/florisyn-founder-ashley\.webp[^>]*alt="([^"]*)"/);
  assert.ok(match, "founder portrait <img> must be present with an alt attribute");
  assert.equal(match[1], "Ashley Goodman, founder and CEO of Florisyn");
});

test("Founder Story: required headline and founder identification are present", () => {
  assert.match(appHtml, /<h2 id="founderHeading">Built from the florist&rsquo;s side of the counter\.<\/h2>/);
  assert.match(appHtml, /Ashley Goodman<br><span>Founder &amp; CEO, Florisyn<\/span>/);
});

test("Founder Story: copy is present, concise, and free of fabricated statistics", () => {
  const section = appHtml.slice(appHtml.indexOf('<section class="ph-section ph-founder"'), appHtml.indexOf("</section>", appHtml.indexOf('<section class="ph-section ph-founder"')));
  assert.match(section, /florist&rsquo;s side of the counter/);
  // No invented numbers ("10,000 florists", "50% faster", etc.) — this is
  // a personal story section, not a stats claim.
  assert.doesNotMatch(section, /\b\d[\d,]*\+?\s*(florists|shops|customers|%)/i);
});

test("Founder Story: section sits below the product/pricing story and above the FAQ close, not buried at the very bottom", () => {
  const pricingIdx = sectionIndex("Simple, florist-first pricing");
  const founderIdx = sectionIndex('<section class="ph-section ph-founder"');
  const faqIdx = sectionIndex("Questions florists ask");
  const ctaIdx = sectionIndex("Ready to see Florisyn in your shop?");
  assert.ok(pricingIdx < founderIdx, "founder story must come after the product/pricing story");
  assert.ok(founderIdx < faqIdx, "founder story must come before the FAQ section");
  assert.ok(faqIdx < ctaIdx, "existing FAQ -> final CTA order must be unchanged");
});

test("Founder Story: does not introduce a second <h1> or break heading hierarchy on the public homepage", () => {
  // public/index.html is the whole SPA shell (dashboard, POS, etc. all have
  // their own h1s further down) — scope this check to just the public
  // marketing homepage section this pass touched.
  const start = appHtml.indexOf('<section id="publicHome"');
  const end = appHtml.indexOf('<section id="auth"');
  assert.ok(start !== -1 && end !== -1 && start < end, "could not locate the publicHome section bounds");
  const publicHomeHtml = appHtml.slice(start, end);
  const h1Count = (publicHomeHtml.match(/<h1[ >]/g) || []).length;
  assert.equal(h1Count, 1, "the hero's h1 must remain the only h1 on the public homepage");
  const h2Count = (publicHomeHtml.match(/<h2[ >]/g) || []).length;
  assert.ok(h2Count >= 9, "every existing h2 section heading plus the new founder heading should still be present");
});

test("Existing hero, nav, and primary CTAs are unchanged by this pass", () => {
  assert.match(appHtml, /<h1>Florisyn — made from the florist&rsquo;s side of the counter\.<\/h1>/);
  assert.match(appHtml, /<a class="ph-btn-primary" href="\/signup" data-cta="hero-signup">Start Free Trial<\/a>/);
  assert.match(appHtml, /<a href="\/login">Log In<\/a>/);
  assert.match(appHtml, /<h2>Ready to see Florisyn in your shop\?<\/h2>/);
});

test("Existing pricing, FAQ, and feature-grid sections are still present and untouched", () => {
  assert.match(appHtml, /<h2>Simple, florist-first pricing<\/h2>/);
  assert.match(appHtml, /<h2>Questions florists ask<\/h2>/);
  assert.match(appHtml, /<h2>Everything your flower shop needs, in one place<\/h2>/);
  assert.match(appHtml, /<h2>Meet the Florisyn Assistants<\/h2>/);
});

test("The old about-teaser markup/CSS class is fully replaced, not left as dead duplicate markup", () => {
  assert.doesNotMatch(appHtml, /ph-about-teaser/);
  assert.doesNotMatch(homepageCss, /\.ph-about-teaser/);
});

test("Founder section CSS: responsive layout collapses to one column on mobile, no fixed layout that could overflow", () => {
  assert.match(homepageCss, /#publicHome \.ph-founder-grid\s*\{[^}]*grid-template-columns:\s*minmax\(240px, 380px\) 1fr/);
  const mobileBlock = homepageCss.slice(homepageCss.indexOf("@media (max-width: 720px)"));
  assert.match(mobileBlock, /#publicHome \.ph-founder-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
});

test("Founder portrait CSS uses an intentional aspect-ratio crop, never distorts or blindly scales the image", () => {
  assert.match(homepageCss, /#publicHome \.ph-founder-media img\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*5/);
  assert.match(homepageCss, /#publicHome \.ph-founder-media img\s*\{[^}]*object-fit:\s*cover/);
});
