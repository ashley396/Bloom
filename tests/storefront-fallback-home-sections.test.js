import test from "node:test";
import assert from "node:assert/strict";
import { fallbackSiteFromProfile } from "../netlify/functions/_shared/bloom-storefront-core.js";

/**
 * fallbackSiteFromProfile() builds the site a brand-new shop's customers
 * see before the florist has ever saved anything in Website Studio — the
 * default storefront experience for every new Florisyn shop. It calls
 * buildSiteFromShopProfile(), which returns the home page's hero /
 * featured-arrangements / occasion-tiles / etc. blocks as a *top-level*
 * `sections` array, a sibling of `pages` — not nested onto the home page
 * itself. storefront.js only ever reads `homePage.sections`, so those
 * blocks were silently dropped and every new shop's storefront home page
 * rendered as a bare "Welcome — browse our shop to order." instead of
 * the real generated content. instant-website.js already does this exact
 * nesting step when it first saves a real project; this fallback path
 * never did. Verifies the home page now carries its real sections.
 */
test("fallbackSiteFromProfile nests the generated sections onto the home page", () => {
  const shop = { id: "shop-1", name: "Rose & Co Florist", slug: "rose-and-co" };
  const site = fallbackSiteFromProfile(shop);

  const home = site.pages.find((p) => p.slug === "home");
  assert.ok(home, "home page must exist");
  assert.ok(Array.isArray(home.sections), "home page must carry a sections array");
  assert.ok(home.sections.length > 0, "home page sections must not be empty for a real shop profile");
  assert.ok(
    home.sections.some((s) => s.type === "hero"),
    "home page sections must include the generated hero block",
  );

  // Non-home pages should not inherit the home page's sections.
  const other = site.pages.find((p) => p.slug !== "home");
  if (other) {
    assert.deepEqual(other.sections, other.sections?.length ? other.sections : []);
    assert.ok(
      !other.sections?.some((s) => s.id === "hero-1"),
      "non-home pages must not receive the home page's sections",
    );
  }
});
