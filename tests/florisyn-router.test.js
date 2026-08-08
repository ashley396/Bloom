import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const routerSrc = fs.readFileSync(path.join(root, "public/florisyn-router.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const dashJs = fs.readFileSync(path.join(root, "public/florisyn-atelier-dashboard.js"), "utf8");

const REQUIRED = [
  ["/dashboard", "dashboardPage"],
  ["/pos", "posPage"],
  ["/orders", "ordersPage"],
  ["/products", "productsPage"],
  ["/bouquets", "libraryPage"],
  ["/customers", "customersPage"],
  ["/deliveries", "deliveriesPage"],
  ["/payment-centre", "paymentsPage"],
  ["/lily-ai-studio", "aiStudioPage"],
  ["/analytics", "reportsPage"],
  ["/reports", "reportsPage"],
  ["/expenses", "expensesPage"],
  ["/photo-studio", "bloomshotPage"],
  ["/website-studio", "websitePage"],
  ["/floral-library", "libraryPage"],
  ["/staff", "staffPage"],
  ["/wholesale", "marketplacePage"],
  ["/stores", "storesPage"],
  ["/business-os", "ecosystemPage"],
  ["/settings", "settingsPage"]
];

test("florist shell wires History API router and separate POS page", () => {
  assert.match(html, /florisyn-router\.js/);
  assert.match(html, /id="posPage"/);
  assert.match(html, /id="dashboardPage"/);
  assert.match(html, /data-route="\/pos"/);
  assert.doesNotMatch(html, /data-lux-scroll/);
  // POS markup lives on posPage, not nested under dashboard
  const dashStart = html.indexOf('id="dashboardPage"');
  const posStart = html.indexOf('id="posPage"');
  const dashChunk = html.slice(dashStart, posStart);
  assert.doesNotMatch(dashChunk, /id="florisynPosLux"/);
  assert.match(html.slice(posStart, posStart + 8000), /id="florisynPosLux"/);
});

test("sidebar declares required data-route paths", () => {
  for (const [route, page] of REQUIRED) {
    assert.match(html, new RegExp(`data-route="${route}"\\s+data-page="${page}"`));
  }
});

test("router module maps paths to page ids", () => {
  const sandbox = {
    document: {
      body: { dataset: {} },
      readyState: "loading",
      addEventListener() {},
      querySelectorAll() {
        return [];
      },
      dispatchEvent() {}
    },
    history: {
      pushState() {},
      replaceState() {}
    },
    location: { pathname: "/dashboard", search: "", hash: "" },
    addEventListener() {},
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(routerSrc, sandbox);
  const router = sandbox.window.FlorisynRouter;
  assert.ok(router);
  for (const [route, page] of REQUIRED) {
    assert.equal(router.resolve(route).page, page, route);
  }
  assert.equal(router.resolve("/").page, "dashboardPage");
  assert.equal(router.resolve("/payment-center").path, "/payment-centre");
  assert.equal(router.pathForPage("posPage"), "/pos");
  assert.equal(router.pathForPage("paymentsPage"), "/payment-centre");
});

test("app boots router and atelier no longer scroll-to-POS", () => {
  assert.match(appJs, /FlorisynRouter/);
  assert.match(appJs, /installShowPageBridge/);
  assert.match(appJs, /bootFromLocation/);
  assert.match(appJs, /posPage/);
  assert.doesNotMatch(dashJs, /luxScroll|scrollIntoView/);
  assert.doesNotMatch(html, /data-lux-scroll/);
});
