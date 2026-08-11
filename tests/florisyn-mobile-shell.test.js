import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test("mobile shell stylesheet is loaded last in the app shell", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const a11yIdx = html.indexOf("a11y-320.css");
  const shellIdx = html.indexOf("florisyn-mobile-shell.css");
  assert.ok(a11yIdx >= 0 && shellIdx > a11yIdx, "mobile shell should load after a11y-320.css");
});

test("mobile shell fixes off-canvas drawer and full-width main", () => {
  const css = fs.readFileSync(path.join(root, "public/florisyn-mobile-shell.css"), "utf8");
  assert.match(css, /max-width: 820px/);
  assert.match(css, /grid-template-columns: none/);
  assert.match(css, /position: fixed !important/);
  assert.match(css, /translateX\(-105%\)/);
  assert.match(css, /florisyn-lux-main > \.content/);
  assert.match(css, /--florisyn-mobile-nav-height/);
  assert.match(css, /repeat\(6, minmax\(0, 1fr\)\)/);
});

test("mobile bottom nav exposes daily actions and Menu drawer", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /id="mobileNavMore"/);
  assert.match(html, /data-page="dashboardPage"/);
  assert.match(html, /data-page="posPage"/);
  assert.match(html, /data-page="ordersPage"/);
  assert.match(html, /data-page="inventoryPage"/);
  assert.match(html, /data-page="productsPage"/);
  assert.match(html, /data-page="libraryPage"/, "library stays in sidebar menu");
});

test("showPage scrolls mobile viewport to top", () => {
  const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(js, /scrollMobilePageToTop/);
  assert.match(js, /closeMobileDrawer/);
});
