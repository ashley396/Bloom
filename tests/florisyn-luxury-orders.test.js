import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/florisyn-luxury-orders.css"), "utf8");
const js = fs.readFileSync(path.join(root, "public/florisyn-luxury-orders.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

const pageHtml = html.slice(html.indexOf('id="ordersPage"'), html.indexOf('id="deliveriesPage"'));

test("Orders Figma shell and assets are wired", () => {
  assert.match(html, /florisyn-luxury-orders\.css/);
  assert.match(html, /florisyn-luxury-orders\.js/);
  assert.match(pageHtml, /florisyn-lux-orders/);
  assert.match(pageHtml, /<h1>Orders<\/h1>/);
  assert.match(pageHtml, /Manage and track all customer orders/);
  assert.match(pageHtml, /ordExportBtn/);
  assert.match(pageHtml, /\+ New Order/);
  assert.match(pageHtml, /ordTabs/);
  assert.match(pageHtml, /Search orders\.\.\./);
  assert.match(pageHtml, /May 1 - May 12, 2026/);
  assert.match(pageHtml, /ord-table-card/);
  assert.match(pageHtml, /id="ordTable"/);
  assert.match(pageHtml, /id="ordTableBody"/);
  assert.match(pageHtml, /Showing 1-8 of 186 orders/);
  assert.match(pageHtml, /data-ord-sort="total"/);
  assert.match(pageHtml, /data-open="orderDialog"/);
});

test("Orders palette uses navy/rose tokens without green CTAs", () => {
  assert.match(css, /#1a1f3c/);
  assert.match(css, /#e06b85/i);
  assert.match(css, /#fbf6f7/i);
  assert.match(css, /#e8f5f0/i);
  assert.match(css, /#fff3e0/i);
  assert.match(css, /#e3f2fd/i);
  assert.match(css, /\.ord-status\.delivered/);
  assert.match(css, /\.ord-status\.cancelled/);
  assert.doesNotMatch(css, /background:\s*#547428|background:\s*#486329/i);
  assert.doesNotMatch(css, /\.ord-new[^{]*\{[^}]*#547428/i);
});

test("Orders table demo data and interactions are functional", () => {
  assert.match(js, /FlorisynLuxuryOrders/);
  assert.match(js, /FLR-7342/);
  assert.match(js, /Sarah Johnson/);
  assert.match(js, /Clara Kensington/);
  assert.match(js, /Wedding Package/);
  assert.match(js, /Blush Serenity Bouquet/);
  assert.match(js, /data-ord-tab/);
  assert.match(js, /ordExportBtn/);
  assert.match(js, /PAGE_SIZE/);
  assert.match(js, /data-cancel-order/);
  assert.match(js, /status:\s*"CANCELLED"/);
  assert.match(js, /Cancel Order/);
  assert.match(appJs, /FlorisynLuxuryOrders\?\.boot/);
  assert.match(appJs, /data-cancel-order/);
});
