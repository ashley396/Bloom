import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/florisyn-atelier-ui.css"), "utf8");
const dashJs = fs.readFileSync(path.join(root, "public/florisyn-atelier-dashboard.js"), "utf8");

test("dashboard mockup chrome is wired in the florist app shell", () => {
  assert.match(html, /atelier-sidebar-brand/);
  assert.match(html, /atelier-mark-f/);
  assert.match(html, /atelier-kpi-row/);
  assert.match(html, /atelier-dash-columns/);
  assert.match(html, /id="atelierTodayOrders"/);
  assert.match(html, /id="atelierTopBouquets"/);
  assert.match(html, /atelier-inventory-alert/);
  assert.match(html, /Point of Sale/);
  assert.match(html, /florisyn-atelier-dashboard\.js/);
  assert.match(html, /florisyn-atelier-ui\.css\?v=atelierops1/);
  assert.match(html, /florisyn-luxury-dashboard\.css/);
});

test("mobile mockup chrome matches founder phone layout markers", () => {
  assert.match(html, /atelier-mobile-topbar/);
  assert.match(html, /id="atelierMenuToggle"/);
  assert.match(html, /atelier-mobile-nav/);
  assert.match(html, /id="mobileNavCommunity"/);
  assert.match(html, /id="mobileNavLibrary"/);
  assert.doesNotMatch(html, /id="moreMenu"/);
  assert.doesNotMatch(html, /atelier-mobile-add/);
  assert.match(html, /data-page="dashboardPage"/);
  assert.match(html, /data-page="posPage"/);
  assert.match(html, /data-page="ordersPage"/);
  assert.match(html, /data-page="libraryPage"/);
  assert.match(html, /id="atelierSidebarDrawer"[\s\S]*data-page="customersPage"[\s\S]*data-page="settingsPage"/);
  assert.match(html, /Here’s what’s blooming today/);
  assert.match(html, /kpi-label-mobile">Orders/);
  assert.match(html, /kpi-label-mobile">Delivered/);
  assert.match(html, /kpi-label-mobile">Happiness/);
  assert.match(html, /florisyn-mobile-shell\.css/);
  const shellCss = fs.readFileSync(path.join(root, "public/florisyn-mobile-shell.css"), "utf8");
  assert.match(shellCss, /repeat\(5, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /\.atelier-mobile-add/);
  assert.match(css, /kpi-revenue/);
});

test("atelier dashboard script renders overview lists and drawer chrome", () => {
  assert.match(dashJs, /FlorisynAtelierDashboard/);
  assert.match(dashJs, /renderTodayOrders/);
  assert.match(dashJs, /atelier-drawer-open/);
  assert.match(dashJs, /statusLabel/);
});
