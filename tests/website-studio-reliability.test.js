import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  resolvePublishedSite,
  previewTokenSecret,
  verifyPreviewToken,
  signPreviewToken
} from "../netlify/functions/_shared/bloom-storefront-core.js";
import { publishRequiresApproval } from "../netlify/functions/_shared/bloom-website-editor.js";

const editor = fs.readFileSync(new URL("../public/website-editor-ui.js", import.meta.url), "utf8");
const storefrontPublic = fs.readFileSync(
  new URL("../netlify/functions/storefront-public.js", import.meta.url),
  "utf8"
);
const instantWebsite = fs.readFileSync(
  new URL("../netlify/functions/instant-website.js", import.meta.url),
  "utf8"
);

test("editor keeps draft on save failure and stops publish on unconfirmed save", () => {
  assert.match(editor, /Your changes remain in the editor/);
  assert.match(editor, /Publishing was stopped/);
  assert.match(editor, /Your saved draft is safe/);
  assert.ok(editor.indexOf('api("save_page"') < editor.indexOf('api("publish"'));
  assert.match(editor, /if \(!saved\?\.saved \|\| !saved\?\.page\?\.id\) throw/);
});

test("editor surfaces empty, loading, and load-error states", () => {
  assert.match(editor, /Loading website draft/);
  assert.match(editor, /No website sections yet/);
  assert.match(editor, /Website draft could not be loaded/);
  assert.match(editor, /Unpublished drafts never appear/);
});

test("unpublished drafts never resolve as public storefront content", () => {
  const pages = [{ slug: "home", visible: true }];
  const draft = resolvePublishedSite({ status: "draft" }, pages, { name: "Petals" });
  assert.equal(draft.allowed, false);
  assert.equal(draft.error, "Site not published.");
  const published = resolvePublishedSite({ status: "published" }, pages, { name: "Petals" });
  assert.equal(published.allowed, true);
});

test("preview fails closed without secret and rejects wrong shop or expired token", () => {
  assert.equal(previewTokenSecret({}), null);
  const now = Date.now();
  const token = signPreviewToken("shop-a", now + 60_000, "test-secret");
  assert.equal(verifyPreviewToken(token, "shop-b", now, "test-secret").error, "Token shop mismatch.");
  const expired = signPreviewToken("shop-a", now - 1, "test-secret");
  assert.equal(verifyPreviewToken(expired, "shop-a", now, "test-secret").error, "Preview token expired.");
});

test("public storefront page reads stay scoped to selected project/shop", () => {
  assert.match(
    storefrontPublic,
    /\.from\("bloom_website_pages"\)[\s\S]{0,220}\.eq\("shop_id", shopId\)[\s\S]{0,120}\.eq\("project_id", project\.id\)/
  );
  assert.match(storefrontPublic, /resolvePublishedSite/);
  assert.match(storefrontPublic, /if \(!resolved\.allowed\) return json\(404/);
});

test("cross-shop website edits are denied and publish stays approval-gated", () => {
  assert.match(instantWebsite, /Cross-shop edit denied/);
  assert.match(instantWebsite, /tenantIsolationCheck/);
  assert.equal(publishRequiresApproval({ lilyDraft: false, approved: false, saved: true }).ok, false);
  assert.equal(publishRequiresApproval({ lilyDraft: false, approved: true, saved: false }).ok, false);
  assert.equal(publishRequiresApproval({ lilyDraft: false, approved: true, saved: true }).ok, true);
});

test("stale draft / publish confirmation failure modes stay explicit", () => {
  assert.match(instantWebsite, /Website publish could not be confirmed\. Your draft remains safe/);
  assert.match(instantWebsite, /Create and save a website draft before publishing/);
  assert.match(editor, /Draft was not saved/);
  assert.match(editor, /Website was not published/);
});

test("editor keeps section order, undo\/redo restore, and mobile preview", () => {
  assert.match(editor, /\.sort\(\(a, b\) => a\.order - b\.order\)/);
  assert.match(editor, /history\.undo/);
  assert.match(editor, /history\.redo/);
  assert.match(editor, /data-preview="desktop"/);
  assert.match(editor, /dataset\.preview = mode\.toLowerCase\(\)/);
  assert.match(editor, /editorPreviewMobile/);
});

test("theme persistence action remains available on website API", () => {
  assert.match(instantWebsite, /switch_theme/);
});
