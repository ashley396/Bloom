import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { restorePageVersion } from "../netlify/functions/_shared/bloom-instant-website.js";

const instantWebsite = fs.readFileSync(new URL("../netlify/functions/instant-website.js", import.meta.url), "utf8");
const editorJs = fs.readFileSync(new URL("../public/website-editor-ui.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/website-studio-v2.css", import.meta.url), "utf8");

test("restorePageVersion (pure helper) merges a snapshot's content/sections onto the current page", () => {
  const current = { slug: "home", title: "Home", content: { seo_title: "old" }, sections: [{ id: "a" }] };
  const snapshot = { content: { seo_title: "restored" }, sections: [{ id: "b" }] };
  const restored = restorePageVersion(current, snapshot);
  assert.equal(restored.content.seo_title, "restored");
  assert.deepEqual(restored.sections, [{ id: "b" }]);
  assert.equal(restored.slug, "home", "unrelated fields must be preserved, not dropped");
});

test("list_page_versions is tenant-scoped and returns the same shape the frontend renders (id, created_at, sections_count)", () => {
  const block = instantWebsite.slice(instantWebsite.indexOf('action === "list_page_versions"'), instantWebsite.indexOf('action === "restore_version"'));
  assert.match(block, /\.eq\("shop_id", shopId\)/);
  assert.match(block, /\.eq\("page_id", page\.id\)/);
  assert.match(block, /order\("created_at", \{ ascending: false \}\)/);
  assert.match(block, /sections_count:/);
});

test("restore_version actually persists to bloom_website_pages — it is not still the old pure-merge-only dead code", () => {
  const block = instantWebsite.slice(instantWebsite.indexOf('if (action === "restore_version")'), instantWebsite.indexOf('action === "health_score"'));
  assert.match(block, /\.from\("bloom_website_pages"\)\s*\n\s*\.update\(/, "must write the restored content/sections back to the live page row");
  assert.match(block, /\.eq\("shop_id", shopId\)/);
  assert.match(block, /\.eq\("id", current\.id\)/);
});

test("restoring snapshots the CURRENT state first — restoring an old version is itself undoable, never a one-way trip", () => {
  const block = instantWebsite.slice(instantWebsite.indexOf('if (action === "restore_version")'), instantWebsite.indexOf('action === "health_score"'));
  const snapshotIdx = block.indexOf('client.from("bloom_website_page_versions").insert(');
  const updateIdx = block.indexOf('.update({ content: restored');
  assert.ok(snapshotIdx >= 0, "must insert a pre-restore snapshot");
  assert.ok(updateIdx >= 0, "must then update the live page");
  assert.ok(snapshotIdx < updateIdx, "the safety snapshot must happen BEFORE the destructive update, not after");
});

test("restore requires the target version to belong to the same shop and page — cannot restore another shop's or another page's version", () => {
  const block = instantWebsite.slice(instantWebsite.indexOf('if (action === "restore_version")'), instantWebsite.indexOf('action === "health_score"'));
  assert.match(block, /\.from\("bloom_website_page_versions"\)[\s\S]{0,200}\.eq\("shop_id", shopId\)[\s\S]{0,80}\.eq\("page_id", current\.id\)/);
});

test("restore writes an audit event recording which version was restored", () => {
  const block = instantWebsite.slice(instantWebsite.indexOf('if (action === "restore_version")'), instantWebsite.indexOf('action === "health_score"'));
  assert.match(block, /eventType: "website_page_version_restored"/);
  assert.match(block, /restored_version_id: body\.version_id/);
});

// ---- Frontend ----

test("editor has a real History button and dialog, wired to list_page_versions and restore_version", () => {
  assert.match(editorJs, /id="editorHistory">History<\/button>/);
  assert.match(editorJs, /id="editorHistoryDialog"/);
  assert.match(editorJs, /api\("list_page_versions", \{ slug: activeSlug \}\)/);
  assert.match(editorJs, /api\("restore_version", \{ slug: activeSlug, version_id:/);
});

test("restoring a version requires confirmation and updates the live canvas from the server response, not a guess", () => {
  const fn = editorJs.slice(editorJs.indexOf('editorHistoryList")?.addEventListener("click"'), editorJs.indexOf('editorAddSection")?.addEventListener'));
  assert.match(fn, /confirm\(/);
  assert.match(fn, /sections = \[\.\.\.\(d\.page\.sections \|\| \[\]\)\]/, "must render what the server actually restored, not assume success");
  assert.match(fn, /history\.reset/, "undo/redo stack must reset to the restored state, not keep stale pre-restore entries");
});

test("empty version history gets an explanatory empty state, not a blank list", () => {
  assert.match(editorJs, /No earlier versions yet/);
});

test("history dialog has its own CSS, not reused from an unrelated component", () => {
  assert.match(css, /\.editor-history-dialog/);
  assert.match(css, /\.editor-history-row/);
});
