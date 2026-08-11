import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test("mobile shell stylesheet loads after POS CSS and before critical inline block", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const posIdx = html.indexOf("florisyn-luxury-pos.css");
  const shellIdx = html.indexOf("florisyn-mobile-shell.css");
  const criticalIdx = html.indexOf("florisyn-pos-critical");
  assert.ok(posIdx >= 0 && shellIdx > posIdx, "mobile shell should load after luxury POS CSS");
  assert.ok(shellIdx < criticalIdx, "mobile shell should load before POS critical inline CSS");
  assert.match(html, /florisyn-mobile-shell\.css\?v=m8/);
});

test("mobile shell implements drawer, viewport stack, scroll lock, and five-tab grid", () => {
  const css = fs.readFileSync(path.join(root, "public/florisyn-mobile-shell.css"), "utf8");
  assert.match(css, /max-width: 820px/);
  assert.match(css, /translateX\(-105%\)/);
  assert.match(css, /--florisyn-mobile-drawer-width/);
  assert.match(css, /--florisyn-mobile-drawer-max/);
  assert.match(css, /248px/);
  assert.match(css, /atelier-sidebar-brand/);
  assert.match(css, /florisyn-lux-main > \.content/);
  assert.match(css, /--florisyn-mobile-nav-height/);
  assert.match(css, /repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /#lilyPanel:not\(\[hidden\]\)/);
  assert.match(css, /#bloomDaisy/);
  assert.match(css, /\.lily-body/);
  assert.match(css, /florisyn-mobile-drawer-open/);
  assert.match(css, /overflow-wrap: anywhere/);
});

test("mobile drawer max width is constrained and nav labels wrap inside drawer", () => {
  const css = fs.readFileSync(path.join(root, "public/florisyn-mobile-shell.css"), "utf8");
  assert.match(css, /max-width: var\(--florisyn-mobile-drawer-max\)/);
  assert.match(css, /#atelierSidebarDrawer \.florisyn-lux-nav > button/);
  assert.match(css, /white-space: normal/);
  assert.match(css, /rgba\(26, 31, 60, 0\.28\)/);
});

test("mobile shell hides Daisy floating assistant on phone", () => {
  const css = fs.readFileSync(path.join(root, "public/florisyn-mobile-shell.css"), "utf8");
  const ent = fs.readFileSync(path.join(root, "public/enterprise-mobile-nav.css"), "utf8");
  assert.match(css, /#bloomDaisy[\s\S]*display: none !important/);
  assert.match(ent, /#bloomDaisy/);
});

test("bottom nav keeps five columns with safe-area min-height", () => {
  const css = fs.readFileSync(path.join(root, "public/florisyn-mobile-shell.css"), "utf8");
  const ent = fs.readFileSync(path.join(root, "public/enterprise-mobile-nav.css"), "utf8");
  assert.match(css, /min-height: var\(--florisyn-mobile-nav-height\)/);
  assert.match(css, /calc\(68px \+ env\(safe-area-inset-bottom/);
  assert.match(ent, /repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(ent, /safe-area-inset-bottom/);
});

test("desktop nav behavior unchanged — mobile shell only applies at 820px", () => {
  const css = fs.readFileSync(path.join(root, "public/florisyn-mobile-shell.css"), "utf8");
  assert.match(css, /@media \(min-width: 821px\)[\s\S]*\.mobile-nav\.atelier-mobile-nav[\s\S]*display: none !important/);
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
  assert.match(appJs, /wireMobileLilyScrollLock/);
  assert.match(appJs, /wireMobileDrawerScrollLock/);
  assert.match(appJs, /hideMobileFloatingAssistants/);
  assert.match(appJs, /florisyn-lily-open/);
});

test("mobile mockup markers include hamburger drawer and bottom nav ids", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /id="atelierMenuToggle"/);
  assert.match(html, /atelier-mobile-nav/);
  assert.match(html, /id="mobileNavCommunity"/);
  assert.match(html, /id="mobileNavLibrary"/);
  assert.match(html, /id="atelierSidebarDrawer"[\s\S]*data-page="customersPage"[\s\S]*data-page="settingsPage"/);
});

test("hamburger toggle exists in shell and JS binds the same selector", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /id="atelierMenuToggle"/, "hamburger button must exist in index.html");
  assert.match(html, /id="atelierSidebarBackdrop"/, "drawer backdrop must exist in index.html");
  assert.match(html, /id="atelierSidebarDrawer"/, "drawer aside must exist in index.html");
  const dashboard = fs.readFileSync(path.join(root, "public/florisyn-atelier-dashboard.js"), "utf8");
  assert.match(dashboard, /#atelierMenuToggle/, "atelier dashboard must bind the real hamburger id");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(appJs, /atelierMenuToggle/, "app.js fallback must reference the real hamburger id");
  assert.match(appJs, /wireMobileDrawerToggleFallback/, "app.js must wire a defensive drawer toggle fallback");
});

test("drawer scroll-lock sync is guarded against MutationObserver feedback loops", () => {
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(appJs, /function setClassIfChanged/, "guarded class writer must exist");
  assert.match(
    appJs,
    /setClassIfChanged\(document\.body,"florisyn-nav-locked"/,
    "nav lock must be written through the guarded helper (unguarded classList.add re-fires the class observer forever and freezes the page)"
  );
  assert.match(appJs, /setClassIfChanged\(document\.documentElement,"florisyn-mobile-drawer-open"/);
  const lockBlock = appJs.slice(appJs.indexOf("function wireMobileDrawerScrollLock"), appJs.indexOf("function wireMobileDrawerToggleFallback"));
  assert.doesNotMatch(lockBlock, /classList\.add\("florisyn-nav-locked"\)/, "no unguarded nav-lock add inside the observer sync");
});

test("drawer close releases the scroll lock (nav lock follows drawer-open state)", () => {
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const lockBlock = appJs.slice(appJs.indexOf("function wireMobileDrawerScrollLock"), appJs.indexOf("function wireMobileDrawerToggleFallback"));
  assert.match(lockBlock, /const drawerOpen=document\.body\.classList\.contains\("atelier-drawer-open"\)/);
  assert.match(lockBlock, /"florisyn-nav-locked",drawerOpen/, "nav lock must mirror drawer-open so closing the drawer unlocks scrolling");
});

test("Lily FAB and panel selectors exist and open path never requires backend", () => {
  const lily = fs.readFileSync(path.join(root, "public/lily-platform.js"), "utf8");
  assert.match(lily, /fab\.id = "lilyFab"/, "Lily FAB id must exist");
  assert.match(lily, /fab\.className = "lily-fab"/, "Lily FAB class must exist");
  assert.match(lily, /panel\.id = "lilyPanel"/, "Lily panel id must exist");
  assert.match(lily, /fab\.onclick = \(\) => togglePanel\(true\)/, "FAB click must open the panel");
  const toggleBody = lily.slice(lily.indexOf("function togglePanel"), lily.indexOf("function setTab"));
  assert.ok(
    toggleBody.indexOf("panel.hidden = !open") < toggleBody.indexOf("loadCoach()"),
    "panel must be unhidden before any backend call so open never blocks on the API"
  );
  const coachBody = lily.slice(lily.indexOf("async function loadCoach"), lily.indexOf("function renderCoachTab"));
  assert.match(coachBody, /try \{/, "coach load must catch backend failures");
  assert.match(coachBody, /catch/, "coach load must fall back safely when the backend is unavailable");
});

test("enterprise platform mobile nav wiring remains in shell", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /enterprise-mobile-nav\.css/);
  assert.match(html, /core\/florisyn-platform\.js/);
  const js = fs.readFileSync(path.join(root, "public/core/florisyn-platform.js"), "utf8");
  assert.match(js, /setDrawer/);
  assert.match(js, /mobileNavMore/);
});
