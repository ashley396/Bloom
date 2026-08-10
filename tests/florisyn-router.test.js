import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import vm from "node:vm";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const routerSrc = fs.readFileSync(path.join(root, "public/florisyn-router.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const dashJs = fs.readFileSync(path.join(root, "public/florisyn-atelier-dashboard.js"), "utf8");

const SIDEBAR_ORDER = [
  ["/dashboard", "dashboardPage"],
  ["/pos", "posPage"],
  ["/orders", "ordersPage"],
  ["/products", "productsPage"],
  ["/bouquets", "bouquetsPage"],
  ["/customers", "customersPage"],
  ["/deliveries", "deliveriesPage"],
  ["/payment-centre", "paymentsPage"],
  ["/lily-ai-studio", "aiStudioPage"],
  ["/analytics", "analyticsPage"],
  ["/reports", "reportsPage"],
  ["/expenses", "expensesPage"],
  ["/photo-studio", "bloomshotPage"],
  ["/community", "communityPage"],
  ["/florist-network", "floristNetworkPage"],
  ["/marketing", "emailCampaignsPage"],
  ["/weddings", "weddingsPage"],
  ["/holiday-command", "holidayPage"],
  ["/staff", "staffPage"],
  ["/wholesale", "marketplacePage"],
  ["/stores", "storesPage"],
  ["/business-os", "ecosystemPage"],
  ["/pos-settings", "posSettingsPage"],
  ["/settings", "settingsPage"]
];

function navBlock() {
  const start = html.indexOf('class="florisyn-lux-nav"');
  const end = html.indexOf("</nav>", start);
  return html.slice(start, end);
}

test("florist shell wires History API router and separate POS page", () => {
  assert.match(html, /florisyn-router\.js/);
  assert.match(html, /id="posPage"/);
  assert.match(html, /id="dashboardPage"/);
  assert.match(html, /id="bouquetsPage"/);
  assert.match(html, /id="analyticsPage"/);
  assert.match(html, /id="posSettingsPage"/);
  assert.match(html, /data-route="\/pos"/);
  assert.doesNotMatch(html, /data-lux-scroll/);
  const dashStart = html.indexOf('id="dashboardPage"');
  const posStart = html.indexOf('id="posPage"');
  const dashChunk = html.slice(dashStart, posStart);
  assert.doesNotMatch(dashChunk, /id="florisynPosLux"/);
  assert.match(html.slice(posStart, posStart + 8000), /id="florisynPosLux"/);
});

test("sidebar lists every required route in exact order", () => {
  const nav = navBlock();
  const routes = [...nav.matchAll(/data-route="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    routes,
    SIDEBAR_ORDER.map(([route]) => route),
    `sidebar routes were ${JSON.stringify(routes)}`
  );
  for (const [route, page] of SIDEBAR_ORDER) {
    assert.match(nav, new RegExp(`data-route="${route}"\\s+data-page="${page}"`));
  }
  assert.match(nav, /florisyn-lux-nav-label">GROWTH</);
  assert.match(nav, /florisyn-lux-nav-label">BUSINESS</);
  assert.match(nav, /florisyn-lux-nav-label">SELLER DASHBOARD</);
  assert.match(nav, /florisyn-lux-nav-label">SUBSCRIPTION</);
  assert.match(nav, /POS Settings/);
  assert.equal(routes.length, 24);
  assert.match(html, /florisyn-premium-badge/);
  assert.match(html, /PREMIUM PLAN/);
  const premiumStart = html.indexOf("florisyn-premium-badge");
  const premiumEnd = html.indexOf("</section>", premiumStart);
  const premium = html.slice(premiumStart, premiumEnd);
  assert.match(premium, /PREMIUM PLAN/);
  assert.doesNotMatch(premium, /<button/);
  // Premium badge sits after nav, not as a route button
  assert.ok(html.indexOf('class="florisyn-lux-nav"') < premiumStart);
  assert.ok(html.indexOf("</nav>", html.indexOf('class="florisyn-lux-nav"')) < premiumStart);
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
  for (const [route, page] of SIDEBAR_ORDER) {
    assert.equal(router.resolve(route).page, page, route);
  }
  assert.equal(router.resolve("/").page, "dashboardPage");
  assert.equal(router.resolve("/payment-center").path, "/payment-centre");
  assert.equal(router.pathForPage("posPage"), "/pos");
  assert.equal(router.pathForPage("posSettingsPage"), "/pos-settings");
  assert.equal(router.pathForPage("bouquetsPage"), "/bouquets");
  assert.equal(router.pathForPage("analyticsPage"), "/analytics");
});

test("app boots router and atelier no longer scroll-to-POS", () => {
  assert.match(appJs, /FlorisynRouter/);
  assert.match(appJs, /installShowPageBridge/);
  assert.match(appJs, /bootFromLocation/);
  assert.match(appJs, /posPage/);
  assert.match(appJs, /loadAnalyticsPage|analyticsPage/);
  assert.match(appJs, /loadPosSettingsPage|posSettingsPage/);
  assert.doesNotMatch(dashJs, /luxScroll|scrollIntoView/);
  assert.doesNotMatch(html, /data-lux-scroll/);
});
