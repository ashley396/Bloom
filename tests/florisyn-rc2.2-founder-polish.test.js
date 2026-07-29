import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("RC2.2 polish stylesheet linked after founder layer", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const founder = html.indexOf("florisyn-founder-1.0.css");
  const rc22 = html.indexOf("florisyn-rc2.2-founder-polish.css");
  assert.ok(founder >= 0 && rc22 > founder);
  assert.match(html, /florisyn-rc22/);
});

test("assistant portraits use bundled SVG assets", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /assistants\/lily-portrait\.svg/);
  assert.match(html, /assistants\/rose-portrait\.svg/);
  assert.doesNotMatch(html, /\/assets\/lily\.png/);
  assert.doesNotMatch(html, /\/assets\/rose\.png/);
  for (const rel of ["lily-portrait.svg", "rose-portrait.svg"]) {
    fs.accessSync(new URL(`../public/assets/assistants/${rel}`, import.meta.url));
  }
});

test("RC2.2 CSS restores dashboard assistants and readable Flower Shop OS tag", () => {
  const css = fs.readFileSync(new URL("../public/florisyn-rc2.2-founder-polish.css", import.meta.url), "utf8");
  assert.match(css, /Flower Shop OS/);
  assert.match(css, /\.lily-suggestion-card[\s\S]*display: grid/);
  assert.match(css, /\.rose-portrait[\s\S]*display: block/);
  assert.match(css, /brand-mark[\s\S]*41px/);
});

test("Lily and Rose labels use founder titles in shell", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /Creative Assistant/);
  assert.match(html, /Business Advisor/);
});
