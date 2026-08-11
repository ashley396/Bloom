import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test("mobile shell stylesheet loads after POS CSS and before critical inline block", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const posIdx = html.indexOf("florisyn-luxury-pos.css");
  const shellIdx = html.indexOf("florisyn-mobile-shell.css?v=m7");
  const criticalIdx = html.indexOf("florisyn-pos-critical");
  assert.ok(posIdx >= 0 && shellIdx > posIdx, "mobile shell should load after luxury POS CSS");
  assert.ok(shellIdx < criticalIdx, "mobile shell should load before POS critical inline CSS");
});

test("mobile shell implements drawer, viewport stack, scroll lock, and five-tab grid", () => {
  const css = fs.readFileSync(path.join(root, "public/florisyn-mobile-shell.css"), "utf8");
  assert.match(css, /max-width: 820px/);
  assert.match(css, /translateX\(-105%\)/);
  assert.match(css, /--florisyn-mobile-drawer-width/);
  assert.match(css, /atelier-sidebar-brand/);
  assert.match(css, /florisyn-lux-main > \.content/);
  assert.match(css, /--florisyn-mobile-nav-height/);
  assert.match(css, /repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /#lilyPanel:not\(\[hidden\]\)/);
  assert.match(css, /#bloomDaisy/);
  assert.match(css, /\.lily-body/);
});

test("POS critical inline CSS is desktop-only (mobile defers to shell stylesheet)", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const critical = html.slice(html.indexOf("florisyn-pos-critical"), html.indexOf("</style>", html.indexOf("florisyn-pos-critical")));
  assert.match(critical, /@media \(min-width: 821px\)/);
  assert.doesNotMatch(critical, /@media\(max-width:820px\)/);
});

test("mobile bottom nav exposes POS, Orders, Inventory, Library, Community, and Menu fallback", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const mobileNav = html.slice(html.indexOf('class="mobile-nav atelier-mobile-nav"'));
  const mobileSection = mobileNav.slice(0, mobileNav.indexOf("</nav>"));
  assert.match(mobileSection, /id="mobileNavInventory"/);
  assert.match(mobileSection, /id="mobileNavLibrary"/);
  assert.match(mobileSection, /id="mobileNavCommunity"/);
  assert.match(mobileSection, /id="mobileNavMore"/);
  assert.match(mobileSection, /data-page="posPage"/);
  assert.match(mobileSection, /data-page="ordersPage"/);
  assert.match(mobileSection, /data-page="inventoryPage"/);
  assert.match(mobileSection, /data-page="libraryPage"/);
  assert.match(mobileSection, /data-page="communityPage"/);
  assert.doesNotMatch(mobileSection, /data-page="dashboardPage"/, "Dashboard belongs in hamburger only");
});

test("setCommunityNavVisible toggles Community vs Menu in bottom nav fifth slot", () => {
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(appJs, /mobileNavCommunity/);
  assert.match(appJs, /mobileNavMore/);
  assert.match(appJs, /more\.hidden=communityBetaEnabled/);
  assert.match(appJs, /closeMobileDrawer/);
  assert.match(appJs, /scrollMobilePageToTop/);
  assert.match(appJs, /syncPageVisibility/);
});

test("enterprise mobile nav CSS uses five equal columns on phone", () => {
  const css = fs.readFileSync(path.join(root, "public/enterprise-mobile-nav.css"), "utf8");
  assert.match(css, /repeat\(5, minmax\(0, 1fr\)\)/);
});

test("mobile mockup markers include hamburger drawer and bottom nav ids", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /id="atelierMenuToggle"/);
  assert.match(html, /atelier-mobile-nav/);
  assert.match(html, /id="mobileNavCommunity"/);
  assert.match(html, /id="mobileNavLibrary"/);
  assert.match(html, /id="atelierSidebarDrawer"[\s\S]*data-page="customersPage"[\s\S]*data-page="settingsPage"/);
});

test("enterprise platform mobile nav wiring remains in shell", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /enterprise-mobile-nav\.css/);
  assert.match(html, /core\/florisyn-platform\.js/);
  const js = fs.readFileSync(path.join(root, "public/core/florisyn-platform.js"), "utf8");
  assert.match(js, /setDrawer/);
  assert.match(js, /mobileNavMore/);
});
