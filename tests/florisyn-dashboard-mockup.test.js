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
});

test("mobile mockup chrome matches founder phone layout markers", () => {
  assert.match(html, /atelier-mobile-topbar/);
  assert.match(html, /id="atelierMenuToggle"/);
  assert.match(html, /atelier-mobile-nav/);
  assert.doesNotMatch(html, /id="moreMenu"/);
  assert.doesNotMatch(html, /atelier-mobile-add/);
  assert.match(html, /data-page="dashboardPage"><span class="mnav-ico" aria-hidden="true">⌂<\/span><span>POS<\/span>/);
  assert.match(html, /data-page="ordersPage"/);
  assert.match(html, /data-page="inventoryPage"/);
  assert.match(html, /id="atelierSidebarDrawer"[\s\S]*data-page="customersPage"[\s\S]*data-page="settingsPage"/);
  assert.match(html, /Here’s what’s blooming today/);
  assert.match(html, /kpi-label-mobile">Orders/);
  assert.match(html, /kpi-label-mobile">Delivered/);
  assert.match(html, /kpi-label-mobile">Happiness/);
  assert.match(css, /Mobile founder mockup/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /\.atelier-mobile-add/);
  assert.match(css, /kpi-revenue/);
  assert.match(css, /linear-gradient\(145deg, #1a2b48/);
});

test("atelier dashboard script renders overview lists and drawer chrome", () => {
  assert.match(dashJs, /FlorisynAtelierDashboard/);
  assert.match(dashJs, /renderTodayOrders/);
  assert.match(dashJs, /atelier-drawer-open/);
  assert.match(dashJs, /window\.FlorisynAtelierChrome = \{ setDrawer \}/);
  assert.match(dashJs, /#atelierSidebarDrawer, \.atelier-mobile-nav/);
  assert.match(dashJs, /setDrawer\(false\)/);
  assert.match(dashJs, /statusLabel/);
});

test("remote admin content controls can update images and labels", () => {
  const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(app, /safeRemoteImageUrl/);
  assert.match(app, /app_background_image/);
  assert.match(app, /dashboard_image/);
  assert.match(app, /logo_image/);
  assert.match(app, /button_labels/);
  assert.match(app, /tab_labels/);
  assert.match(css, /--remote-app-background-image/);
});
