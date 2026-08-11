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
  assert.match(html, /florisyn-mobile-shell.css\?v=m7/);
});

test("mobile shell fixes off-canvas drawer and app viewport shell", () => {
  const css = fs.readFileSync(path.join(root, "public/florisyn-mobile-shell.css"), "utf8");
  assert.match(css, /max-width: 820px/);
  assert.match(css, /translateX\(-105%\)/);
  assert.match(css, /florisyn-lux-main > \.content/);
  assert.match(css, /--florisyn-mobile-nav-height/);
  assert.match(css, /repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /100dvh/);
  assert.match(css, /--florisyn-mobile-drawer-width/);
  assert.match(css, /44vw/);
  assert.match(css, /bloom-pos-mobile-footer/);
  assert.match(css, /#lilyPanel:not\(\[hidden\]\)/);
});

test("critical POS inline CSS is desktop-only", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /@media \(min-width: 821px\)/);
  assert.match(html, /pos-lux-checkout\{display:flex!important;flex-direction:column!important;flex:0 0 340px/);
});

test("mobile bottom nav exposes POS, Orders, Inventory, Library, Community only", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const mobileNav = html.slice(html.indexOf('class="mobile-nav atelier-mobile-nav"'));
  const mobileSection = mobileNav.slice(0, mobileNav.indexOf("</nav>"));
  assert.match(mobileSection, /id="mobileNavInventory"/);
  assert.match(mobileSection, /id="mobileNavLibrary"/);
  assert.match(mobileSection, /id="mobileNavCommunity"/);
  assert.match(mobileSection, /data-page="posPage"/);
  assert.match(mobileSection, /data-page="ordersPage"/);
  assert.match(mobileSection, /data-page="inventoryPage"/);
  assert.match(mobileSection, /data-page="libraryPage"/);
  assert.match(mobileSection, /data-page="communityPage"/);
  assert.doesNotMatch(mobileSection, /id="mobileNavMore"/);
  assert.doesNotMatch(mobileSection, /data-page="dashboardPage"/, "Dashboard belongs in hamburger only");
  assert.doesNotMatch(mobileSection, /data-page="productsPage"/, "Products belongs in hamburger only");
});

test("setCommunityNavVisible keeps Community in bottom nav when beta is off", () => {
  const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(js, /closest\("\.mobile-nav"\)/);
  assert.doesNotMatch(js, /mobileNavMore/);
});

test("showPage syncs visibility and scrolls on mobile", () => {
  const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(js, /scrollMobilePageToTop/);
  assert.match(js, /syncPageVisibility/);
  assert.match(js, /closeMobileDrawer/);
});
