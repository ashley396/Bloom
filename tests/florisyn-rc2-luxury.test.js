import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

describe("Florisyn RC2 luxury experience", () => {
  it("canonical design tokens file maps legacy variables", () => {
    const css = readFileSync(join(ROOT, "public/florisyn-rc2-tokens.css"), "utf8");
    assert.match(css, /--rc2-champagne-gold/);
    assert.match(css, /--pink: var\(--rc2-sage-deep\)/);
    assert.match(css, /--brand-primary: var\(--rc2-sage-deep\)/);
    assert.match(css, /--rc2-space-8: 64px/);
  });

  it("production luxury CSS exists and defines core tokens", () => {
    const cssPath = join(ROOT, "public/florisyn-rc2-luxury-experience.css");
    assert.ok(existsSync(cssPath), "luxury CSS file must exist");
    const css = readFileSync(cssPath, "utf8");
    assert.match(css, /florisyn-rc2-luxury/);
    assert.match(css, /--rc2-champagne-gold/);
    assert.match(css, /prefers-reduced-motion/);
  });

  it("unified luxury CSS covers navigation, dialogs, forms, and mobile", () => {
    const css = readFileSync(join(ROOT, "public/florisyn-rc2-luxury-unified.css"), "utf8");
    assert.match(css, /\.shell > aside/);
    assert.match(css, /dialog::backdrop/);
    assert.match(css, /\.order-board-column/);
    assert.match(css, /\.mobile-nav/);
    assert.match(css, /\.payment-tile/);
  });

  it("modules CSS neutralizes v13 pink and covers all page types", () => {
    const css = readFileSync(join(ROOT, "public/florisyn-rc2-luxury-modules.css"), "utf8");
    assert.match(css, /\.order-builder-head/);
    assert.match(css, /\.website-studio-layout/);
    assert.match(css, /\.lily-panel/);
    assert.match(css, /\.ph-provider-card/);
    assert.match(css, /\.pos-welcome-row/);
    assert.match(css, /font-family: var\(--rc2-font-display\)/);
  });

  it("luxury init script exists with no secrets", () => {
    const js = readFileSync(join(ROOT, "public/florisyn-rc2-luxury-init.js"), "utf8");
    assert.match(js, /enhanceDialogs/);
    assert.match(js, /florisyn-rc2-luxury/);
    assert.doesNotMatch(js, /password|secret|api_key/i);
  });

  it("auth, public, admin, and storefront luxury overlays exist", () => {
    for (const file of [
      "florisyn-rc2-luxury-auth.css",
      "florisyn-rc2-luxury-public.css",
      "florisyn-rc2-luxury-admin.css",
      "florisyn-rc2-luxury-storefront.css",
    ]) {
      assert.ok(existsSync(join(ROOT, "public", file)), `${file} must exist`);
    }
  });

  it("index.html wires complete RC2 luxury stack", () => {
    const html = readFileSync(join(ROOT, "public/index.html"), "utf8");
    assert.match(html, /florisyn-rc2-tokens\.css/);
    assert.match(html, /florisyn-rc2-luxury-experience\.css/);
    assert.match(html, /florisyn-rc2-luxury-unified\.css/);
    assert.match(html, /florisyn-rc2-luxury-modules\.css/);
    assert.match(html, /florisyn-rc2-orders-pos\.css/);
    assert.match(html, /florisyn-rc2-luxury-init\.js/);
    assert.match(html, /florisyn-rc2-orders-pos\.js/);
    assert.match(html, /onboarding\.css/);
    assert.match(html, /florisyn-rc2-luxury/);
  });

  it("Phase 2 orders-pos module exists with views and quick actions", () => {
    const css = readFileSync(join(ROOT, "public/florisyn-rc2-orders-pos.css"), "utf8");
    assert.match(css, /rc2-stationery-card/);
    assert.match(css, /rc2-quick-actions/);
    assert.match(css, /rc2-view-switcher/);
    assert.match(css, /prefers-reduced-motion/);

    const js = readFileSync(join(ROOT, "public/florisyn-rc2-orders-pos.js"), "utf8");
    assert.match(js, /FlorisynRC2Orders/);
    assert.match(js, /data-rc2-view/);
    assert.match(js, /data-rc2-action/);
    assert.match(js, /statusUpdateInFlight/);
    assert.match(js, /stripCardEnhancement/);
    assert.match(js, /workspaceMounted/);
    assert.match(js, /readCheckoutDisplayTotals/);
    assert.match(js, /case "advance"/);
    assert.doesNotMatch(js, /password|secret|api_key/i);
  });

  it("no placeholder React module pages remain", () => {
    assert.ok(!existsSync(join(ROOT, "frontend/src/pages/LuxuryModulePages.tsx")));
    const router = readFileSync(join(ROOT, "frontend/src/routes/AppRouter.tsx"), "utf8");
    assert.doesNotMatch(router, /LuxuryModulePages/);
    assert.doesNotMatch(router, /PlaceholderPage/);
    assert.doesNotMatch(router, /runs in production/i);
  });

  it("satellite pages activate RC2 overlays via body classes", () => {
    const admin = readFileSync(join(ROOT, "public/admin.html"), "utf8");
    assert.match(admin, /body class="florisyn-rc2-luxury-admin"/);

    const pay = readFileSync(join(ROOT, "public/pay.html"), "utf8");
    assert.match(pay, /florisyn-rc2-tokens\.css/);
    assert.match(pay, /body class="[^"]*florisyn-rc2-luxury/);

    const storefront = readFileSync(join(ROOT, "public/storefront/index.html"), "utf8");
    assert.match(storefront, /florisyn-rc2-luxury-storefront/);

    const about = readFileSync(join(ROOT, "public/company/about/index.html"), "utf8");
    assert.match(about, /body class="florisyn-rc2-luxury-public"/);
    assert.doesNotMatch(about, /luxury-public\.css">>/);
  });

  it("unified CSS includes staging audit hardening", () => {
    const css = readFileSync(join(ROOT, "public/florisyn-rc2-luxury-unified.css"), "utf8");
    assert.match(css, /STAGING AUDIT/);
    assert.match(css, /\.progress-ring/);
    assert.match(css, /overflow-x: clip/);
    assert.match(css, /92dvh/);
  });

  it("React luxury page shell exists for shared chrome", () => {
    assert.ok(existsSync(join(ROOT, "frontend/src/components/layout/LuxuryPageShell.tsx")));
  });
});
