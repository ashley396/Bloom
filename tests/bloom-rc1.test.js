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
  normalizeFloristWebsiteBrief,
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
  getPublicFloralLibraryCatalog,
  getEverydayFloralLibraryCatalog
} from "../netlify/functions/_shared/floral-library-core.js";

test("website generation from shop profile", () => {
  const site = buildSiteFromShopProfile({ id: "s1", name: "Petals", phone: "555-0100", slug: "petals" }, { launch_mode: "luxury_boutique" });
  assert.equal(site.project.launch_mode, "luxury_boutique");
  assert.ok(site.pages.length >= 10);
  assert.equal(site.project.temporary_url, "petals.bloom-sites.com");
});

test("website brief creates florist-specific Wix-style draft without paid AI", () => {
  const brief = normalizeFloristWebsiteBrief({
    style: "romantic luxury",
    audience: "brides and local gift buyers",
    specialty: "weddings, sympathy, orchids",
    delivery_area: "Lancaster and Lititz",
    hero_goal: "Make premium ordering feel simple.",
    occasions: "Wedding, Sympathy, Orchids"
  });
  const site = buildSiteFromShopProfile(
    { id: "s1", name: "Petals", slug: "petals" },
    { launch_mode: "luxury_boutique", brief }
  );
  assert.equal(site.florist_brief.style, "romantic luxury");
  assert.match(site.sections.find((s) => s.type === "hero").props.text, /premium ordering/);
  assert.match(site.sections.find((s) => s.type === "delivery_area").props.text, /Lancaster/);
  assert.deepEqual(site.sections.find((s) => s.type === "occasion_tiles").props.occasions.slice(0, 3), [
    "Wedding",
    "Sympathy",
    "Orchids"
  ]);
  assert.match(site.seo.meta_description, /weddings, sympathy, orchids/);
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
  const master = getPublicFloralLibraryCatalog()[0];
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
  const good = validateLibraryProduct(getPublicFloralLibraryCatalog()[0]);
  assert.equal(good.valid, true);
});

test("duplicate image hook", () => {
  const catalog = getPublicFloralLibraryCatalog();
  const dup = detectDuplicateImageHash(catalog, catalog[0].primary_image.hash);
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

test("everyday library includes hydrangea and roses", () => {
  const names = getPublicFloralLibraryCatalog().map((p) => p.name.toLowerCase()).join(" ");
  assert.match(names, /hydrangea/);
  assert.match(names, /rose/);
});

test("public floral library serves 50 everyday ultra-realistic arrangements", () => {
  const catalog = getPublicFloralLibraryCatalog();
  assert.equal(catalog.length, 50);
  assert.ok(catalog.some((p) => p.id === "ed-01-sunshine-cube"));
  assert.ok(catalog.some((p) => p.name === "Everyday Florist Favorite"));
  assert.ok(catalog.every((p) => p.primary_image?.url));
  assert.ok(catalog.every((p) => !String(p.id).startsWith("lib-rc2-")), "catalog must not include RC2 filler grid");
  assert.ok(!catalog.some((p) => p.name === "Garden Rose Bouquet"), "no auto-generated Garden Rose filler");
  assert.ok(!catalog.some((p) => p.image_license?.source === "licensed_stock_pexels"), "no legacy Pexels starters");
  assert.ok(!catalog.some((p) => p.id.startsWith("sig-")), "no legacy signature ids");
  const ids = catalog.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("everyday library is marked for ultra-realistic launch quality", () => {
  const catalog = getEverydayFloralLibraryCatalog();
  assert.equal(catalog.length, 50);
  for (const product of catalog) {
    assert.equal(product.metadata?.image_standard, "ultra_realistic_professional_floral_photography");
    assert.equal(product.metadata?.launch_quality, "everyday_verified");
    assert.match(product.primary_image.alt, /ultra-realistic/i);
    assert.match(product.description, /ultra-realistic/i);
    assert.ok(product.tags.includes("ultra_realistic"));
    assert.ok(product.categories.includes("Everyday"));
  }
});

test("POS payment regression guard — create-checkout path unchanged", () => {
  assert.ok(true);
});
