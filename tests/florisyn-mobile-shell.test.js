import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test("mobile shell stylesheet is loaded last in the app shell", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const posIdx = html.indexOf("florisyn-luxury-pos.css");
  const shellIdx = html.indexOf("florisyn-mobile-shell.css");
  assert.ok(posIdx >= 0 && shellIdx > posIdx, "mobile shell should load after florisyn-luxury-pos.css");
  assert.match(html, /florisyn-mobile-shell.css\?v=m6/);
});

test("mobile shell fixes off-canvas drawer and app viewport shell", () => {
  const css = fs.readFileSync(path.join(root, "public/florisyn-mobile-shell.css"), "utf8");
  assert.match(css, /max-width: 820px/);
  assert.match(css, /translateX\(-105%\)/);
  assert.match(css, /florisyn-lux-main > \.content/);
  assert.match(css, /--florisyn-mobile-nav-height/);
  assert.match(css, /repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(css, /100dvh/);
  assert.match(css, /overscroll-behavior: contain/);
});

test("critical POS inline CSS is desktop-only", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /@media \(min-width: 821px\)/);
  assert.match(html, /pos-lux-checkout\{display:flex!important;flex-direction:column!important;flex:0 0 340px/);
});

test("mobile bottom nav exposes daily actions and Menu drawer", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /id="mobileNavMore"/);
  assert.match(html, /data-page="inventoryPage"/);
  assert.match(html, /data-page="productsPage"/);
});

test("showPage syncs visibility and scrolls on mobile", () => {
  const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(js, /scrollMobilePageToTop/);
  assert.match(js, /syncPageVisibility/);
  assert.match(js, /closeMobileDrawer/);
});
