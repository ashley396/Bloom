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

// Mobile + copy refinement pass: the story is told in Ashley's own voice
// (first person, present-tense — she IS a florist, not "was"), not a
// third-person biography. The old opening implied she'd left the florist
// side of the business; the approved replacement makes the opposite point
// explicit.
test("Founder Story: the old third-person 'Ashley ran a flower shop' framing is completely removed", () => {
  assert.doesNotMatch(appHtml, /Before Florisyn, Ashley ran a flower shop/);
  assert.doesNotMatch(appHtml, /She built Florisyn because she knew/);
  assert.doesNotMatch(appHtml, /She wanted one system/);
});

test("Founder Story: the approved first-person copy is installed exactly, in order", () => {
  const section = appHtml.slice(appHtml.indexOf('<section class="ph-section ph-founder"'), appHtml.indexOf("</section>", appHtml.indexOf('<section class="ph-section ph-founder"')));
  const storyStart = section.indexOf('<div class="ph-founder-story">');
  assert.notEqual(storyStart, -1, "expected a dedicated ph-founder-story wrapper around the story paragraphs");
  const storyEnd = section.indexOf("</div>", storyStart);
  assert.notEqual(storyEnd, -1, "expected a closing </div> for the story wrapper");
  const story = section.slice(storyStart, storyEnd);

  const linesInOrder = [
    "Florisyn didn&rsquo;t start in a software company.",
    "It started behind the counter of my own flower shop.",
    "I know what it&rsquo;s like to design arrangements, answer phones, manage orders, watch inventory, handle deliveries, market the business, and still try to find time to grow.",
    "I built Florisyn because florists deserve technology that understands the way we actually work.",
    "One place to run the business. AI that actually helps. And more time for what made us fall in love with flowers in the first place: creating something beautiful."
  ];
  let cursor = 0;
  for (const line of linesInOrder) {
    const idx = story.indexOf(line, cursor);
    assert.ok(idx !== -1 && idx >= cursor, `expected to find, in order: "${line}"`);
    cursor = idx + line.length;
  }

  // First-person voice throughout, never third-person within the story body.
  assert.match(story, /\bI built Florisyn\b/);
  assert.doesNotMatch(story, /\bAshley\b/, "the story paragraphs speak as Ashley, never refer to her in third person");
});

test("Founder Story: the opening sentence gets subtle emphasis, not every line bolded", () => {
  const section = appHtml.slice(appHtml.indexOf('<section class="ph-section ph-founder"'), appHtml.indexOf("</section>", appHtml.indexOf('<section class="ph-section ph-founder"')));
  const strongMatches = section.match(/<strong>/g) || [];
  assert.equal(strongMatches.length, 1, "exactly one emphasized phrase — the opening sentence — never the whole section bolded");
  assert.match(section, /<strong>Florisyn didn&rsquo;t start in a software company\.<\/strong>/);
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
  // Regression guard: the <img>'s width/height HTML attributes describe the
  // desktop derivative for CLS purposes, but the <picture> swaps in a
  // differently-sized mobile <source>. Without an explicit height:auto,
  // Chromium keeps using the attribute-derived height and aspect-ratio is
  // silently ignored — the img renders at the wrong size. height:auto is
  // what makes aspect-ratio the actual source of truth in every case.
  assert.match(homepageCss, /#publicHome \.ph-founder-media img\s*\{[^}]*height:\s*auto/);
});

// Mobile + copy refinement pass (Section 3/5/6): a shorter, wider,
// face-preserving crop; body copy left-aligned while the eyebrow/headline/
// signature stay centered; tightened section spacing. The portrait image
// FILE is never touched by any of this — only its on-page CSS framing.
test("Mobile portrait: shorter aspect-ratio + top-biased crop keeps the face in frame without shrinking it", () => {
  const mobileBlock = homepageCss.slice(homepageCss.indexOf("@media (max-width: 720px)"));
  assert.match(mobileBlock, /#publicHome \.ph-founder-media img\s*\{[^}]*aspect-ratio:\s*5\s*\/\s*4/, "mobile crop must be meaningfully shorter (5/4) than the desktop 4/5 portrait crop");
  assert.match(mobileBlock, /#publicHome \.ph-founder-media img\s*\{[^}]*object-position:\s*center 12%/, "must bias toward the top of the photo — this is what keeps her face in frame and crops the desk/notebook, not her head");
});

test("Mobile body copy is left-aligned for readability; eyebrow/headline/signature/link stay centered", () => {
  const mobileBlock = homepageCss.slice(homepageCss.indexOf("@media (max-width: 720px)"));
  assert.match(mobileBlock, /#publicHome \.ph-founder-copy\s*\{[^}]*text-align:\s*center/, "eyebrow, headline, name/title, and About link remain centered");
  assert.match(mobileBlock, /#publicHome \.ph-founder-story\s*\{[^}]*text-align:\s*left/, "the actual story paragraphs are left-aligned, not centered");
});

test("HTML structure: the story paragraphs sit in a dedicated wrapper the mobile CSS can target independently of the centered eyebrow/headline/signature", () => {
  assert.match(appHtml, /<div class="ph-founder-story">[\s\S]*?<\/div>/);
});
