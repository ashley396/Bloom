import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

describe("Florisyn RC2 luxury experience", () => {
  it("production luxury CSS exists and defines core tokens", () => {
    const cssPath = join(ROOT, "public/florisyn-rc2-luxury-experience.css");
    assert.ok(existsSync(cssPath), "luxury CSS file must exist");
    const css = readFileSync(cssPath, "utf8");
    assert.match(css, /florisyn-rc2-luxury/);
    assert.match(css, /--rc2-champagne-gold/);
    assert.match(css, /--rc2-font-display/);
    assert.match(css, /prefers-reduced-motion/);
  });

  it("unified luxury CSS covers navigation, dialogs, forms, and mobile", () => {
    const cssPath = join(ROOT, "public/florisyn-rc2-luxury-unified.css");
    assert.ok(existsSync(cssPath));
    const css = readFileSync(cssPath, "utf8");
    assert.match(css, /\.shell > aside/);
    assert.match(css, /dialog::backdrop/);
    assert.match(css, /\.order-board-column/);
    assert.match(css, /\.mobile-nav/);
    assert.match(css, /\.payment-tile/);
    assert.match(css, /@media \(max-width: 820px\)/);
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

  it("Bloom Moment production script exists", () => {
    const jsPath = join(ROOT, "public/florisyn-rc2-bloom-moment.js");
    assert.ok(existsSync(jsPath));
    const js = readFileSync(jsPath, "utf8");
    assert.match(js, /florisynBloomMoment/);
    assert.match(js, /Bloom moment/);
    assert.doesNotMatch(js, /password|secret|api_key/i);
  });

  it("Daily Atelier Flow production script exists", () => {
    const jsPath = join(ROOT, "public/florisyn-rc2-atelier-flow.js");
    assert.ok(existsSync(jsPath));
    const js = readFileSync(jsPath, "utf8");
    assert.match(js, /florisynAtelierFlow/);
    assert.match(js, /atelier-timeline/);
  });

  it("index.html wires all RC2 luxury assets", () => {
    const html = readFileSync(join(ROOT, "public/index.html"), "utf8");
    assert.match(html, /florisyn-rc2-luxury-experience\.css/);
    assert.match(html, /florisyn-rc2-luxury-unified\.css/);
    assert.match(html, /florisyn-rc2-bloom-moment\.js/);
    assert.match(html, /florisyn-rc2-atelier-flow\.js/);
    assert.match(html, /florisyn-rc2-luxury/);
    assert.match(html, /Cormorant\+Garamond/);
  });

  it("auth pages wire luxury auth CSS", () => {
    const html = readFileSync(join(ROOT, "public/login.html"), "utf8");
    assert.match(html, /florisyn-rc2-luxury-auth\.css/);
    assert.match(html, /florisyn-rc2-luxury/);
  });

  it("public pages wire luxury public CSS", () => {
    const html = readFileSync(join(ROOT, "public/company/about/index.html"), "utf8");
    assert.match(html, /florisyn-rc2-luxury-public\.css/);
    assert.match(html, /florisyn-rc2-luxury-public/);
  });

  it("admin and storefront wire luxury overlays", () => {
    const admin = readFileSync(join(ROOT, "public/admin.html"), "utf8");
    assert.match(admin, /florisyn-rc2-luxury-admin\.css/);
    const sf = readFileSync(join(ROOT, "public/storefront/index.html"), "utf8");
    assert.match(sf, /florisyn-rc2-luxury-storefront\.css/);
  });

  it("RC2 spec document exists", () => {
    const docPath = join(ROOT, "docs/FLORISYN_RC2_LUXURY_EXPERIENCE.md");
    assert.ok(existsSync(docPath));
    const doc = readFileSync(docPath, "utf8");
    assert.match(doc, /Bloom Moment/);
    assert.match(doc, /Daily Atelier Flow/);
    assert.match(doc, /DO NOT MODIFY/);
  });

  it("React Bloom Moment and luxury page shell exist", () => {
    assert.ok(existsSync(join(ROOT, "frontend/src/components/today/bloom-moment.tsx")));
    assert.ok(existsSync(join(ROOT, "frontend/src/components/layout/LuxuryPageShell.tsx")));
    const router = readFileSync(join(ROOT, "frontend/src/routes/AppRouter.tsx"), "utf8");
    assert.match(router, /DeliveriesPage/);
    assert.match(router, /PosPage/);
  });

  it("React luxury tokens include full botanical palette", () => {
    const css = readFileSync(join(ROOT, "frontend/src/index.css"), "utf8");
    assert.match(css, /--color-champagne-gold/);
    assert.match(css, /--color-eucalyptus/);
    assert.match(css, /--color-terracotta/);
    assert.match(css, /bloom-reveal/);
  });
});
