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

  it("index.html wires RC2 luxury assets", () => {
    const html = readFileSync(join(ROOT, "public/index.html"), "utf8");
    assert.match(html, /florisyn-rc2-luxury-experience\.css/);
    assert.match(html, /florisyn-rc2-bloom-moment\.js/);
    assert.match(html, /florisyn-rc2-atelier-flow\.js/);
    assert.match(html, /florisyn-rc2-luxury/);
    assert.match(html, /Cormorant\+Garamond/);
  });

  it("RC2 spec document exists", () => {
    const docPath = join(ROOT, "docs/FLORISYN_RC2_LUXURY_EXPERIENCE.md");
    assert.ok(existsSync(docPath));
    const doc = readFileSync(docPath, "utf8");
    assert.match(doc, /Bloom Moment/);
    assert.match(doc, /Daily Atelier Flow/);
    assert.match(doc, /DO NOT MODIFY/);
  });

  it("React Bloom Moment component exists", () => {
    const tsxPath = join(ROOT, "frontend/src/components/today/bloom-moment.tsx");
    assert.ok(existsSync(tsxPath));
    const tsx = readFileSync(tsxPath, "utf8");
    assert.match(tsx, /Bloom moment/);
    assert.match(tsx, /font-serif-display/);
  });

  it("React luxury tokens include champagne gold and botanical palette", () => {
    const css = readFileSync(join(ROOT, "frontend/src/index.css"), "utf8");
    assert.match(css, /--color-champagne-gold/);
    assert.match(css, /--color-eucalyptus/);
    assert.match(css, /--color-terracotta/);
    assert.match(css, /bloom-reveal/);
  });
});
