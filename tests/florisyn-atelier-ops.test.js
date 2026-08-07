import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/florisyn-atelier-ui.css", import.meta.url), "utf8");

test("atelier ops CSS covers core florist workspaces", () => {
  assert.match(css, /Florist workspaces — Orders, Inventory, Products, Deliveries, Customers/);
  for (const sel of [
    "#ordersPage > .heading",
    "#inventoryPage > .heading",
    "#productsPage > .heading",
    "#deliveriesPage > .heading",
    "#customersPage > .heading",
    ".order-board-column",
    ".inventory-scan-banner",
    ".delivery-summary article",
  ]) {
    assert.match(css, new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("workspace page headings keep feature entry points", () => {
  assert.match(html, /id="ordersPage"/);
  assert.match(html, /data-open="orderDialog"/);
  assert.match(html, /id="refreshOrderBoard"/);
  assert.match(html, /id="inventoryPage"/);
  assert.match(html, /data-open="inventoryDialog"/);
  assert.match(html, /id="scanInventoryBtn"/);
  assert.match(html, /id="productsPage"/);
  assert.match(html, /data-open="productDialog"/);
  assert.match(html, /id="deliveriesPage"/);
  assert.match(html, /data-open="deliveryDialog"/);
  assert.match(html, /id="customersPage"/);
  assert.match(html, /data-open="customerDialog"/);
  assert.match(html, /florisyn-atelier-ui\.css\?v=atelierops2/);
});
