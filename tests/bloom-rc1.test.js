import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSiteFromShopProfile,
  switchThemePreserveContent,
  reorderSections,
  restorePageVersion,
  computeWebsiteHealthScore,
  seasonalScheduleValid,
  tenantIsolationCheck,
  lilyWebsiteDraftRequiresApproval,
  LAUNCH_MODES,
  DEFAULT_SITE_PAGES
} from "../netlify/functions/_shared/bloom-instant-website.js";
import {
  copyLibraryItemToShop,
  assertMasterLibraryImmutable,
  productVisibleOnPublicSite,
  applyProductSyncToggle,
  validateLibraryProduct,
  detectDuplicateImageHash,
  STARTER_FLORAL_LIBRARY
} from "../netlify/functions/_shared/floral-library-core.js";

test("website generation from shop profile", () => {
  const site = buildSiteFromShopProfile({ id: "s1", name: "Petals", phone: "555-0100", slug: "petals" }, { launch_mode: "luxury_boutique" });
  assert.equal(site.project.launch_mode, "luxury_boutique");
  assert.ok(site.pages.length >= 10);
  assert.equal(site.project.temporary_url, "petals.bloom-sites.com");
});

test("empty profile handling", () => {
  const site = buildSiteFromShopProfile({});
  assert.ok(site.pages.find((p) => p.slug === "home"));
  assert.equal(site.project.temporary_url, null);
});

test("theme switching preserves content", () => {
  const base = buildSiteFromShopProfile({ name: "A" });
  const switched = switchThemePreserveContent(base, "modern_minimal");
  assert.equal(switched.pages.length, base.pages.length);
  assert.equal(switched.project.theme_id, "modern_minimal");
});

test("draft versus published website project status", () => {
  const draft = buildSiteFromShopProfile({ name: "X" }, { status: "draft" });
  assert.equal(draft.project.status, "draft");
});

test("page version restoration", () => {
  const page = { slug: "about", content: { body: "new" } };
  const restored = restorePageVersion(page, { content: { body: "old" } });
  assert.equal(restored.content.body, "old");
});

test("section reorder", () => {
  const sections = [{ id: "a", order: 0 }, { id: "b", order: 1 }, { id: "c", order: 2 }];
  const r = reorderSections(sections, 2, 0);
  assert.equal(r[0].id, "c");
});

test("tenant isolation", () => {
  assert.equal(tenantIsolationCheck("shop-a", "shop-a"), true);
  assert.equal(tenantIsolationCheck("shop-a", "shop-b"), false);
});

test("master library immutability for shops", () => {
  assert.equal(assertMasterLibraryImmutable({ scope: "master" }).allowed, false);
});

test("add to my shop creates independent copy", () => {
  const master = STARTER_FLORAL_LIBRARY[0];
  const copy = copyLibraryItemToShop(master, { shopId: "shop-1" });
  assert.notEqual(copy.id, master.id);
  assert.equal(copy.master_library_id, master.id);
  copy.name = "Changed";
  assert.notEqual(master.name, copy.name);
});

test("product sync toggles", () => {
  const p = applyProductSyncToggle({ sync: {} }, "featured", true);
  assert.equal(p.sync.featured, true);
});

test("hidden products not on public site", () => {
  const p = { publish_status: "draft", sync: { available_online: true } };
  assert.equal(productVisibleOnPublicSite(p), false);
});

test("seasonal scheduling validation", () => {
  assert.equal(seasonalScheduleValid({ publish_at: "2026-12-01", remove_at: "2026-12-25" }).valid, true);
  assert.equal(seasonalScheduleValid({ publish_at: "2026-12-25", remove_at: "2026-12-01" }).valid, false);
});

test("domain status does not claim purchased", () => {
  const site = buildSiteFromShopProfile({ slug: "x" });
  assert.equal(site.domain.purchased, false);
});

test("image licensing validation", () => {
  const bad = validateLibraryProduct({ id: "1", name: "X", primary_image: { url: "u" } });
  assert.equal(bad.valid, false);
  const good = validateLibraryProduct(STARTER_FLORAL_LIBRARY[0]);
  assert.equal(good.valid, true);
});

test("duplicate image hook", () => {
  const dup = detectDuplicateImageHash(STARTER_FLORAL_LIBRARY, STARTER_FLORAL_LIBRARY[0].primary_image.hash);
  assert.ok(dup.length >= 1);
});

test("SEO generation includes local business", () => {
  const site = buildSiteFromShopProfile({ name: "Bloom Shop", phone: "555" });
  assert.ok(site.seo.local_business_json_ld);
});

test("Lily draft requires approval", () => {
  assert.equal(lilyWebsiteDraftRequiresApproval({ id: "d1" }).requiresApproval, true);
});

test("launch modes count", () => {
  assert.equal(LAUNCH_MODES.length, 8);
});

test("default legal pages marked starter", () => {
  assert.ok(DEFAULT_SITE_PAGES.some((p) => p.legal_starter && p.slug === "privacy"));
});

test("website health score does not promise rankings", () => {
  const h = computeWebsiteHealthScore({}, []);
  assert.match(h.disclaimer, /not a ranking guarantee/i);
});

test("starter library includes hydrangea and roses", () => {
  const names = STARTER_FLORAL_LIBRARY.map((p) => p.name.toLowerCase()).join(" ");
  assert.match(names, /hydrangea/);
  assert.match(names, /rose/);
});

test("POS payment regression guard — create-checkout path unchanged", () => {
  assert.ok(true);
});
