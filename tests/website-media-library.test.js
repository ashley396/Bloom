import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { validateWebsiteMediaUpload, findMediaUsage, WEBSITE_MEDIA_BUCKET, WEBSITE_MEDIA_MAX_BYTES } from "../netlify/functions/_shared/website-media.js";

const instantWebsite = fs.readFileSync(new URL("../netlify/functions/instant-website.js", import.meta.url), "utf8");
const mediaLibraryJs = fs.readFileSync(new URL("../public/website-media-library.js", import.meta.url), "utf8");
const editorJs = fs.readFileSync(new URL("../public/website-editor-ui.js", import.meta.url), "utf8");
const ws2Js = fs.readFileSync(new URL("../public/website-studio-v2.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260815000000_website_media_library.sql", import.meta.url), "utf8");

function tinyPngDataUrl() {
  // 1x1 transparent PNG, well-formed base64 — real bytes, not a placeholder string.
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
}

// ---- Pure validation / usage logic ----

test("validateWebsiteMediaUpload accepts a well-formed image data URL and rejects garbage", () => {
  const ok = validateWebsiteMediaUpload({ dataUrl: tinyPngDataUrl() });
  assert.equal(ok.valid, true);
  assert.equal(ok.mime, "image/png");

  assert.equal(validateWebsiteMediaUpload({ dataUrl: "not-a-data-url" }).valid, false);
  assert.equal(validateWebsiteMediaUpload({ dataUrl: "data:text/plain;base64,aGVsbG8=" }).valid, false, "must reject non-image mimes");
});

test("validateWebsiteMediaUpload rejects oversized payloads", () => {
  const bigBase64 = Buffer.alloc(WEBSITE_MEDIA_MAX_BYTES + 1024, 1).toString("base64");
  const result = validateWebsiteMediaUpload({ dataUrl: `data:image/png;base64,${bigBase64}` });
  assert.equal(result.valid, false);
  assert.match(result.error, /8 MB/);
});

test("findMediaUsage finds every page/section that references a given storage path, at any nesting depth", () => {
  const pages = [
    {
      slug: "home",
      title: "Home",
      sections: [
        { id: "hero-1", type: "hero", props: { image: { url: "https://cdn.example.com/abc/hero.jpg" } } },
        { id: "grid-1", type: "featured_arrangements", props: { items: [{ photo: { url: "https://cdn.example.com/abc/other.jpg" } }] } }
      ]
    },
    { slug: "about", title: "About", sections: [{ id: "about-1", type: "about_florist", props: { image: { url: "https://cdn.example.com/xyz/team.jpg" } } }] }
  ];
  const usage = findMediaUsage(pages, "abc/hero.jpg");
  assert.equal(usage.length, 1);
  assert.equal(usage[0].slug, "home");
  assert.equal(usage[0].section_id, "hero-1");

  assert.equal(findMediaUsage(pages, "nowhere.jpg").length, 0);
});

// ---- Backend wiring ----

test("all four media actions are wired, tenant-scoped, and audited", () => {
  ["upload_media", "list_media", "update_media", "delete_media"].forEach((action) => {
    assert.match(instantWebsite, new RegExp(`action === "${action}"`), `${action} must be a real handler`);
  });
  const uploadBlock = instantWebsite.slice(instantWebsite.indexOf('action === "upload_media"'), instantWebsite.indexOf('action === "list_media"'));
  assert.match(uploadBlock, /uploadWebsiteMedia\(/);
  assert.match(uploadBlock, /eventType: "website_media_uploaded"/);
  assert.match(uploadBlock, /shop_id: shopId/);

  const listBlock = instantWebsite.slice(instantWebsite.indexOf('action === "list_media"'), instantWebsite.indexOf('action === "update_media"'));
  assert.match(listBlock, /\.eq\("shop_id", shopId\)/);
  assert.match(listBlock, /findMediaUsage\(/, "list must annotate usage so the library can warn before delete");

  const deleteBlock = instantWebsite.slice(instantWebsite.indexOf('action === "delete_media"'), instantWebsite.length);
  assert.match(deleteBlock, /if \(!body\.confirmed\)/);
  assert.match(deleteBlock, /needsConfirmation: true/);
  assert.match(deleteBlock, /findMediaUsage\(/, "delete must check usage and warn, not just delete blindly");
  assert.match(deleteBlock, /eventType: "website_media_deleted"/);
});

// ---- Storage bucket / migration regression guard ----

test("website-media bucket is public (storefront is unauthenticated) and authenticated grants are present — regression guard for the P0 missing-grants class of bug", () => {
  assert.match(migration, /'website-media',\s*\n\s*'website-media',\s*\n\s*true,/, "bucket must be public=true");
  assert.match(migration, /grant select, insert, update, delete on public\.website_media to authenticated/);
  assert.match(migration, /is_shop_member\(shop_id\)/);
  assert.match(migration, /to public\s*\nusing \(bucket_id = 'website-media'\)/, "storage read policy must allow public, not just authenticated");
});

// ---- Frontend: media library dialog ----

test("media library dialog supports real upload (file input + drag/drop), not a URL prompt", () => {
  assert.match(mediaLibraryJs, /accept="image\/jpeg,image\/png,image\/webp,image\/gif"/);
  assert.match(mediaLibraryJs, /addEventListener\("drop"/);
  assert.match(mediaLibraryJs, /addEventListener\("change"/);
  assert.match(mediaLibraryJs, /FileReader/);
  assert.doesNotMatch(mediaLibraryJs, /window\.prompt\("Image URL/);
});

test("media library exposes both browse (manage) and picker (select) modes from one dialog", () => {
  assert.match(mediaLibraryJs, /function openBrowse/);
  assert.match(mediaLibraryJs, /function openPicker/);
  assert.match(mediaLibraryJs, /window\.BloomWebsiteMedia\s*=\s*\{\s*openBrowse,\s*openPicker\s*\}/);
});

test("alt text is editable per image and missing alt text is visibly flagged, not silently allowed", () => {
  assert.match(mediaLibraryJs, /data-edit-alt/);
  assert.match(mediaLibraryJs, /api\("update_media"/);
  assert.match(mediaLibraryJs, /media-alt-missing/);
});

test("deleting an in-use image warns with where it's used before requiring a second confirm — never deletes silently", () => {
  assert.match(mediaLibraryJs, /data-delete-media/);
  assert.match(mediaLibraryJs, /used on \$\{where\}/);
  assert.match(mediaLibraryJs, /confirmed: true/);
});

// ---- Frontend: editor wiring (replaces the old prompt() flow) ----

test("editor's Change photo control opens the real media picker instead of a raw URL prompt", () => {
  assert.match(editorJs, /data-image="\$\{esc\(s\.id\)\}"/, "a real, rendered trigger must exist — the old code had the handler but nothing ever rendered the button");
  assert.doesNotMatch(editorJs, /prompt\("Image URL/);
  assert.match(editorJs, /window\.BloomWebsiteMedia\.openPicker/);
  assert.match(editorJs, /media: \{ url: item\.url, alt: item\.alt_text/);
});

test("editor gracefully degrades if the media library script somehow failed to load, rather than throwing", () => {
  assert.match(editorJs, /if \(!window\.BloomWebsiteMedia\?\.openPicker\)/);
});

// ---- Frontend: entry point from the pages panel ----

test("Website Studio V2 has a persistent Media library entry point", () => {
  assert.match(ws2Js, /id="ws2OpenMediaLibrary"/);
  assert.match(ws2Js, /BloomWebsiteMedia\?\.openBrowse\?\.\(\)/);
});
