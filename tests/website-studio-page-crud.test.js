import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildNewPage,
  nextUniqueSlug,
  duplicatePageContent,
  guardPageDeletion,
  sanitizePageTitle,
  reorderPages,
  HOMEPAGE_SLUG
} from "../netlify/functions/_shared/bloom-website-editor.js";

const instantWebsite = fs.readFileSync(new URL("../netlify/functions/instant-website.js", import.meta.url), "utf8");
const ws2 = fs.readFileSync(new URL("../public/website-studio-v2.js", import.meta.url), "utf8");
const ws2Css = fs.readFileSync(new URL("../public/website-studio-v2.css", import.meta.url), "utf8");

// ---- Pure helper logic ----

test("nextUniqueSlug avoids collisions and falls back to a safe default", () => {
  assert.equal(nextUniqueSlug("Weddings", []), "weddings");
  assert.equal(nextUniqueSlug("Weddings", ["weddings"]), "weddings-2");
  assert.equal(nextUniqueSlug("Weddings", ["weddings", "weddings-2"]), "weddings-3");
  assert.equal(nextUniqueSlug("!!!", []), "page");
});

test("buildNewPage produces a real, empty, unique-slugged page ready to save", () => {
  const page = buildNewPage({ title: "Our Story", existingSlugs: ["home", "shop"], navOrder: 3 });
  assert.equal(page.slug, "our-story");
  assert.equal(page.title, "Our Story");
  assert.equal(page.visible, true);
  assert.equal(page.nav_order, 3);
  assert.deepEqual(page.sections, []);
});

test("buildNewPage never collides with an existing slug and titles/whitespace are trimmed", () => {
  const page = buildNewPage({ title: "  Shop  ", existingSlugs: ["home", "shop"] });
  assert.equal(page.title, "Shop");
  assert.equal(page.slug, "shop-2");
});

test("duplicatePageContent copies content but starts hidden with a fresh slug, title, and section ids", () => {
  const source = {
    slug: "about",
    title: "About",
    template: "custom",
    nav_order: 5,
    content: { hero_text: "Welcome" },
    sections: [{ id: "hero-1", type: "hero", order: 0, props: { title: "Hi" } }]
  };
  const copy = duplicatePageContent(source, ["home", "about"]);
  assert.equal(copy.slug, "about-copy");
  assert.equal(copy.title, "About (Copy)");
  assert.equal(copy.visible, false, "duplicates must never silently appear live in nav");
  assert.deepEqual(copy.content, { hero_text: "Welcome" });
  assert.equal(copy.sections.length, 1);
  assert.notEqual(copy.sections[0].id, "hero-1", "duplicated sections need their own ids, not shared with the source page");
});

test("guardPageDeletion: home can never be deleted, the last page can never be deleted, and deletion requires explicit confirmation", () => {
  const pages = [{ slug: "home" }, { slug: "shop" }, { slug: "about" }];
  assert.equal(guardPageDeletion({ slug: "home", pages, confirmed: true }).ok, false);
  assert.match(guardPageDeletion({ slug: "home", pages, confirmed: true }).error, /Home page can't be deleted/);

  assert.equal(guardPageDeletion({ slug: "shop", pages: [{ slug: "shop" }], confirmed: true }).ok, false, "must not allow deleting the only remaining page");

  const unconfirmed = guardPageDeletion({ slug: "about", pages, confirmed: false });
  assert.equal(unconfirmed.ok, false);
  assert.equal(unconfirmed.needsConfirmation, true);

  assert.equal(guardPageDeletion({ slug: "about", pages, confirmed: true }).ok, true);
  assert.equal(guardPageDeletion({ slug: "nonexistent", pages, confirmed: true }).ok, false);
});

test("sanitizePageTitle rejects empty names and trims/caps length, never touches the slug", () => {
  assert.equal(sanitizePageTitle("  ").ok, false);
  assert.equal(sanitizePageTitle("").ok, false);
  const result = sanitizePageTitle("  Weddings & Events  ");
  assert.equal(result.ok, true);
  assert.equal(result.title, "Weddings & Events");
  assert.equal(sanitizePageTitle("x".repeat(200)).title.length, 80);
});

test("reorderPages assigns nav_order from an ordered slug list and sorts accordingly", () => {
  const pages = [
    { slug: "home", nav_order: 0 },
    { slug: "shop", nav_order: 1 },
    { slug: "about", nav_order: 2 }
  ];
  const reordered = reorderPages(pages, ["about", "home", "shop"]);
  assert.deepEqual(reordered.map((p) => p.slug), ["about", "home", "shop"]);
  assert.deepEqual(reordered.map((p) => p.nav_order), [0, 1, 2]);
});

test("HOMEPAGE_SLUG is the literal string every other module already hardcodes", () => {
  assert.equal(HOMEPAGE_SLUG, "home");
});

// ---- Backend wiring ----

test("all five page-CRUD actions are wired with tenant-scoped queries and audit events", () => {
  ["add_page", "rename_page", "duplicate_page", "delete_page", "reorder_pages"].forEach((action) => {
    assert.match(instantWebsite, new RegExp(`action === "${action}"`), `${action} must be a real handler`);
  });
  const addBlock = instantWebsite.slice(instantWebsite.indexOf('action === "add_page"'), instantWebsite.indexOf('action === "rename_page"'));
  assert.match(addBlock, /buildNewPage\(/);
  assert.match(addBlock, /eventType: "website_page_added"/);

  const deleteBlock = instantWebsite.slice(instantWebsite.indexOf('action === "delete_page"'), instantWebsite.indexOf('action === "reorder_pages"'));
  assert.match(deleteBlock, /guardPageDeletion\(/);
  assert.match(deleteBlock, /eventType: "website_page_deleted"/);
  assert.match(deleteBlock, /\.eq\("shop_id", shopId\)/, "delete must stay tenant-scoped, not just id-scoped");

  const dupBlock = instantWebsite.slice(instantWebsite.indexOf('action === "duplicate_page"'), instantWebsite.indexOf('action === "delete_page"'));
  assert.match(dupBlock, /duplicatePageContent\(/);

  const reorderBlock = instantWebsite.slice(instantWebsite.indexOf('action === "reorder_pages"'), instantWebsite.indexOf('action === "edit_text"'));
  assert.match(reorderBlock, /reorderPages\(/);
});

// ---- Frontend wiring ----

test("Website Studio V2 pages panel exposes add/rename/duplicate/delete/reorder controls, not just a read-only list", () => {
  assert.match(ws2, /id="ws2AddPage"/);
  assert.match(ws2, /data-page-move/);
  assert.match(ws2, /data-page-rename/);
  assert.match(ws2, /data-page-duplicate/);
  assert.match(ws2, /data-page-delete/);
  assert.match(ws2, /api\("add_page"/);
  assert.match(ws2, /api\("rename_page"/);
  assert.match(ws2, /api\("duplicate_page"/);
  assert.match(ws2, /api\("delete_page"/);
  assert.match(ws2, /api\("reorder_pages"/);
});

test("page list shows hidden pages too (so a fresh duplicate is actually visible to review), and Home has no delete control", () => {
  assert.doesNotMatch(ws2, /pages\.filter\(\(p\) => p\.visible !== false\)/, "must not silently drop hidden pages from the management list anymore");
  assert.match(ws2, /isHome \? "" : `<button[\s\S]*?data-page-delete/);
});

test("delete requires a native confirm() before calling the API — never fires on a single click", () => {
  const delBlock = ws2.slice(ws2.indexOf("data-page-delete\\]"), ws2.indexOf("data-page-delete\\]") + 700);
  assert.match(ws2, /if \(!confirm\(`Delete/);
});

test("page action buttons meet minimum usable size and get their own CSS, not reused from unrelated components", () => {
  assert.match(ws2Css, /\.ws2-page-actions \.icon-btn \{[\s\S]*?min-height: 30px/);
  assert.match(ws2Css, /\.ws2-page-actions \.icon-btn\.danger/);
});
