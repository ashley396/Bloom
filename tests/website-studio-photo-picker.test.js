/**
 * Regression guard for the Website Studio hero-photo picker
 * (public/index.html, `.image-picker.photo-gallery`). Two real problems
 * surfaced in this same picker before: (1) it only had 12 photos across 4
 * categories, and (2) an earlier curation pass mixed in photos that didn't
 * match their category or weren't clean flower/vase product shots
 * (people, food, unrelated stock). This locks in the structural
 * invariants that keep the picker honest without re-verifying every photo
 * by hand each time: every filter chip has a real category of matching
 * photos, every photo declares a category that has a chip, and every
 * photo URL is a well-formed Pexels photo URL with a unique ID (no
 * accidental duplicates or copy-paste IDs).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const html = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");

function extractPickerSection(source) {
  const start = source.indexOf('<div class="photo-category-chips">');
  assert.ok(start >= 0, "expected to find the photo-category-chips block");
  const end = source.indexOf("photo-license-note", start);
  assert.ok(end >= 0, "expected to find the photo-license-note paragraph after the gallery");
  return source.slice(start, end);
}

const section = extractPickerSection(html);

function chips(source) {
  return [...source.matchAll(/data-gallery-filter="([a-z-]+)"/g)].map((m) => m[1]);
}

function photos(source) {
  return [...source.matchAll(/data-category="([a-z-]+)" data-hero-image="([^"]+)"/g)].map((m) => ({
    category: m[1],
    url: m[2],
  }));
}

test("every category chip (besides 'all') has at least 2 real photos", () => {
  const categoryChips = chips(section).filter((c) => c !== "all");
  assert.ok(categoryChips.length >= 6, "expected a meaningfully broad set of occasion categories, not just a handful");
  const pics = photos(section);
  for (const cat of categoryChips) {
    const count = pics.filter((p) => p.category === cat).length;
    assert.ok(count >= 2, `category "${cat}" has a filter chip but only ${count} photo(s) — every chip needs real photos behind it`);
  }
});

test("every photo declares a category that has a matching filter chip", () => {
  const categoryChips = new Set(chips(section));
  for (const p of photos(section)) {
    assert.ok(categoryChips.has(p.category), `photo ${p.url} uses category "${p.category}" with no matching filter chip`);
  }
});

test("every photo URL is a well-formed, unique Pexels photo URL", () => {
  const pics = photos(section);
  assert.ok(pics.length >= 24, "expected a substantially larger curated set than the original 12 photos");
  const seen = new Set();
  for (const p of pics) {
    assert.match(p.url, /^https:\/\/images\.pexels\.com\/photos\/\d+\/pexels-photo-\d+\.jpeg\?/, `not a well-formed Pexels photo URL: ${p.url}`);
    const idMatch = p.url.match(/\/photos\/(\d+)\//);
    const id = idMatch[1];
    assert.ok(!seen.has(id), `duplicate photo ID ${id} used more than once in the picker`);
    seen.add(id);
  }
});

test("thumbnail preview and full hero-image URL point at the same photo", () => {
  const buttons = [...section.matchAll(/data-hero-image="([^"]+)" style="background-image:url\('([^']+)'\)"/g)];
  assert.ok(buttons.length >= 24);
  for (const [, full, thumb] of buttons) {
    const fullId = full.match(/\/photos\/(\d+)\//)?.[1];
    const thumbId = thumb.match(/\/photos\/(\d+)\//)?.[1];
    assert.equal(fullId, thumbId, `hero image and its thumbnail reference different photo IDs: ${full} vs ${thumb}`);
  }
});
