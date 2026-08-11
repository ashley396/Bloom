import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Lily panel locks background scroll on mobile", () => {
  const js = fs.readFileSync(path.join(process.cwd(), "public/lily-platform.js"), "utf8");
  assert.match(js, /lockPageScroll/);
  assert.match(js, /lily-panel-open/);
  assert.match(js, /lilyClose/);
});

test("Lily CSS keeps internal body scroll and overscroll containment", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "public/lily-platform.css"), "utf8");
  assert.match(css, /overscroll-behavior:contain/);
  assert.match(css, /lily-body\{[^}]*overflow-y:auto/);
  assert.match(css, /body\.lily-panel-open/);
  assert.match(css, /lily-close-label/);
});

test("mobile shell keeps narrow drawer and sticky Florisyn brand", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "public/florisyn-mobile-shell.css"), "utf8");
  assert.match(css, /44vw/);
  assert.match(css, /atelier-sidebar-brand/);
  assert.match(css, /florisyn-lux-nav/);
  assert.match(css, /#bloomDaisy/);
});

test("website studio reliability test file guards draft visibility", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "tests/website-studio-reliability.test.js"), "utf8");
  assert.match(src, /draft\.allowed, false/);
  assert.match(src, /Unpublished drafts never/);
});
