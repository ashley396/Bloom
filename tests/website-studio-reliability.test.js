import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  resolvePublishedSite,
  previewTokenSecret,
  verifyPreviewToken,
  signPreviewToken
} from "../netlify/functions/_shared/bloom-storefront-core.js";
import {
  publishRequiresApproval,
  normalizeSectionOrder,
  assertPageNotStale,
  confirmThemePersistence
} from "../netlify/functions/_shared/bloom-website-editor.js";
import { buildPublishChecklist } from "../lib/website-studio/publish-checklist.js";

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

test("editor disables save/publish while busy and sends expected_updated_at", () => {
  assert.match(editor, /function setBusy/);
  assert.match(editor, /expected_updated_at/);
  assert.match(editor, /btn\.disabled = busy/);
  assert.match(editor, /editorOpenPreview/);
  assert.match(editor, /preview_token/);
  assert.match(editor, /Draft preview could not be opened/);
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
  assert.match(instantWebsite, /assertPageNotStale/);
  assert.match(instantWebsite, /stale_draft/);
  assert.match(editor, /Draft was not saved/);
  assert.match(editor, /Website was not published/);
  assert.equal(assertPageNotStale({ expectedUpdatedAt: "a", currentUpdatedAt: "a" }).ok, true);
  assert.equal(assertPageNotStale({ expectedUpdatedAt: "a", currentUpdatedAt: "b" }).code, "stale_draft");
});

test("section order is normalized before persist and get_project is project-scoped", () => {
  const normalized = normalizeSectionOrder([
    { id: "b", order: 5 },
    { id: "a", order: 1 },
    { id: "c" }
  ]);
  assert.deepEqual(
    normalized.map((s) => s.id),
    ["a", "b", "c"]
  );
  assert.deepEqual(
    normalized.map((s) => s.order),
    [0, 1, 2]
  );
  assert.match(instantWebsite, /normalizeSectionOrder/);
  assert.match(instantWebsite, /eq\("project_id", project\.id\)/);
});

test("theme persistence confirms theme_settings as well as theme_id", () => {
  assert.match(instantWebsite, /confirmThemePersistence/);
  assert.match(instantWebsite, /theme_settings/);
  assert.equal(
    confirmThemePersistence(
      { theme_id: "classic", theme_settings: { accent: "gold" } },
      { theme_id: "classic", theme_settings: { accent: "gold" } }
    ).ok,
    true
  );
  assert.equal(
    confirmThemePersistence(
      { theme_id: "classic", theme_settings: { accent: "navy" } },
      { theme_id: "classic", theme_settings: { accent: "gold" } }
    ).ok,
    false
  );
});

test("editor keeps section order, undo\/redo restore, and mobile preview", () => {
  assert.match(editor, /\.sort\(\(a, b\) => a\.order - b\.order\)/);
  assert.match(editor, /history\.undo/);
  assert.match(editor, /history\.redo/);
  assert.match(editor, /data-preview="desktop"/);
  assert.match(editor, /dataset\.preview = mode\.toLowerCase\(\)/);
  assert.match(editor, /editorPreviewMobile/);
});

test("website builder exposes florist AI-style brief and add-section controls", () => {
  const wizard = fs.readFileSync(new URL("../public/instant-website-ui.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../public/bloom-rc1-luxury.css", import.meta.url), "utf8");
  assert.match(wizard, /Build your florist website with guided AI-style help/);
  assert.match(wizard, /instantBriefSpecialty/);
  assert.match(wizard, /instantBriefDelivery/);
  assert.match(wizard, /Build florist website draft/);
  assert.match(instantWebsite, /brief: body\.brief/);
  assert.match(editor, /editorAddSection/);
  assert.match(editor, /newSection/);
  assert.match(editor, /delivery_area/);
  assert.match(css, /florist-ai-brief/);
});

test("theme persistence action remains available on website API", () => {
  assert.match(instantWebsite, /switch_theme/);
});

test("publish is blocked by the pre-publish checklist by default, and only skips the gate with an explicit override", () => {
  // Regression guard for the commerce-safety gap found in audit: the
  // publish_checklist endpoint used to be purely informational — the real
  // Publish button never consulted it, so a florist could publish an empty
  // site with no products, no SEO, and no contact info with zero warning.
  const publishBlock = instantWebsite.slice(instantWebsite.indexOf('action === "publish"'), instantWebsite.indexOf('action === "commerce_settings"'));
  assert.match(publishBlock, /buildPublishChecklist\(/, "publish handler must run the same checklist the Launch checklist panel shows");
  assert.match(publishBlock, /if \(!body\.override_checklist\)/, "checklist must run unless explicitly overridden");
  assert.match(publishBlock, /if \(!checklist\.ready\)/);
  assert.match(publishBlock, /json\(409,/, "blocked publish must be a distinct 409, not a generic failure");
  assert.match(publishBlock, /code: "checklist_blocked"/);
  assert.match(publishBlock, /items: failing/);
  assert.match(publishBlock, /checklist_overridden: Boolean\(body\.override_checklist\)/, "override must be recorded in the audit trail, not silent");
});

test("publish button surfaces exactly what's missing and asks before publishing an unready site, never fails silently", () => {
  assert.match(editor, /e\.code === "checklist_blocked"/);
  assert.match(editor, /confirm\(/, "florist must be asked, not auto-overridden");
  assert.match(editor, /override_checklist: true/);
  assert.match(editor, /Publish stopped — nothing is live yet/, "declining must clearly state nothing published");
});

test("global api() helper forwards structured error detail (items) so callers can render specifics, not just a message string", () => {
  const appJs = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(appJs, /if\(d\.items\)err\.items=d\.items/);
});

test("buildPublishChecklist: a bare fresh project fails required items; a stocked, described shop passes", () => {
  const empty = buildPublishChecklist({ project: {}, pages: [{ slug: "home", visible: true, sections: [] }], products: [], shop: {} });
  assert.equal(empty.ready, false);
  assert.ok(empty.items.some((i) => i.id === "home_sections" && !i.pass));
  assert.ok(empty.items.some((i) => i.id === "products_online" && !i.pass));

  const ready = buildPublishChecklist({
    project: { seo_settings: { title: "Ashley's Flowers — Springfield Florist", meta_description: "Fresh local flowers delivered same-day in Springfield and nearby towns." } },
    pages: [
      { slug: "home", visible: true, sections: [{ id: "1" }, { id: "2" }, { id: "3" }] },
      { slug: "shop", visible: true, sections: [] },
      { slug: "contact", visible: true, sections: [] }
    ],
    products: [
      { publish_status: "published", sync: { available_online: true } },
      { publish_status: "published", sync: { available_online: true } },
      { publish_status: "published", sync: { available_online: true } }
    ],
    shop: { phone: "555-1234" }
  });
  assert.equal(ready.ready, true);
});
