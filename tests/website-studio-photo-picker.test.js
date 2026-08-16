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
 * accidental duplicates or copy-paste IDs). A "Signature" category was
 * later added using real local photos the platform owner provided
 * directly (not stock) — those are checked against the file on disk
 * instead of the Pexels URL pattern.
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

// Two valid sources: Pexels stock photos (external, identified by numeric
// photo ID) and local assets the platform owner provided directly
// (public/assets/website-studio/hero/*.jpg — no external dependency, so
// these are checked against the actual file on disk instead).
test("every photo URL is either a well-formed unique Pexels photo URL or a real local asset", () => {
  const pics = photos(section);
  assert.ok(pics.length >= 24, "expected a substantially larger curated set than the original 12 photos");
  const seenPexelsIds = new Set();
  const seenLocalPaths = new Set();
  for (const p of pics) {
    if (p.url.startsWith("/assets/")) {
      assert.ok(!seenLocalPaths.has(p.url), `duplicate local asset ${p.url} used more than once in the picker`);
      seenLocalPaths.add(p.url);
      const filePath = path.join(process.cwd(), "public", p.url);
      assert.ok(fs.existsSync(filePath), `local asset does not exist on disk: ${p.url}`);
      continue;
    }
    assert.match(p.url, /^https:\/\/images\.pexels\.com\/photos\/\d+\/pexels-photo-\d+\.jpeg\?/, `not a well-formed Pexels photo URL: ${p.url}`);
    const id = p.url.match(/\/photos\/(\d+)\//)[1];
    assert.ok(!seenPexelsIds.has(id), `duplicate Pexels photo ID ${id} used more than once in the picker`);
    seenPexelsIds.add(id);
  }
});

test("thumbnail preview and full hero-image URL point at the same photo", () => {
  const buttons = [...section.matchAll(/data-hero-image="([^"]+)" style="background-image:url\('([^']+)'\)"/g)];
  assert.ok(buttons.length >= 24);
  for (const [, full, thumb] of buttons) {
    if (full.startsWith("/assets/")) {
      assert.equal(full, thumb, `local asset hero image and its thumbnail must be the same file: ${full} vs ${thumb}`);
      continue;
    }
    const fullId = full.match(/\/photos\/(\d+)\//)?.[1];
    const thumbId = thumb.match(/\/photos\/(\d+)\//)?.[1];
    assert.equal(fullId, thumbId, `hero image and its thumbnail reference different photo IDs: ${full} vs ${thumb}`);
  }
});
