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
const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const atelierUi = fs.readFileSync(path.join(root, "public/florisyn-atelier-ui.css"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "public/admin.html"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "public/admin.js"), "utf8");

/** Pre-Codex florist tabs + separate POS page (not scroll-merged into dashboard). */
const SIDEBAR_ORDER = [
  ["/dashboard", "dashboardPage"],
  ["/pos", "posPage"],
  ["/orders", "ordersPage"],
  ["/inventory", "inventoryPage"],
  ["/products", "productsPage"],
  ["/deliveries", "deliveriesPage"],
  ["/customers", "customersPage"],
  ["/invoices", "invoicesPage"],
  ["/payment-centre", "paymentsPage"],
  ["/lily-ai-studio", "aiStudioPage"],
  ["/photo-studio", "bloomshotPage"],
  ["/website-studio", "websitePage"],
  ["/floral-library", "libraryPage"],
  ["/expenses", "expensesPage"],
  ["/reports", "reportsPage"],
  ["/staff", "staffPage"],
  ["/wholesale", "marketplacePage"],
  ["/wholesale/seller", "wholesaleSellerPage"],
  ["/stores", "storesPage"],
  ["/subscription", "subscriptionPage"],
  ["/business-os", "ecosystemPage"],
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
  assert.match(html, /id="inventoryPage"/);
  assert.match(html, /id="invoicesPage"/);
  assert.match(html, /id="paymentsPage"/);
  assert.match(html, /id="websitePage"/);
  assert.match(html, /data-route="\/pos"/);
  assert.doesNotMatch(html, /data-lux-scroll/);
  const dashStart = html.indexOf('id="dashboardPage"');
  const posStart = html.indexOf('id="posPage"');
  const dashChunk = html.slice(dashStart, posStart);
  assert.doesNotMatch(dashChunk, /id="florisynPosLux"/);
  assert.match(html.slice(posStart, posStart + 8000), /id="florisynPosLux"/);
});

test("sidebar lists every required route in restored pre-Codex order", () => {
  const nav = navBlock();
  const routes = [...nav.matchAll(/data-route="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((route) => route !== "/community");
  assert.deepEqual(
    routes,
    SIDEBAR_ORDER.map(([route]) => route),
    `sidebar routes were ${JSON.stringify(routes)}`
  );
  for (const [route, page] of SIDEBAR_ORDER) {
    assert.match(nav, new RegExp(`data-route="${route}"\\s+data-page="${page}"`));
  }
  assert.match(nav, /Inventory/);
  assert.match(nav, /Invoices/);
  assert.match(nav, /Payment Center/);
  assert.match(nav, /Seller dashboard/);
  assert.match(nav, /Subscription/);
  assert.match(nav, /data-route="\/community"/);
});

test("page visibility CSS keeps sections separate (not a scroll stack)", () => {
  assert.match(styles, /\.page\{display:none\}/);
  assert.match(styles, /\.page\.active\{display:block\}/);
  assert.match(appJs, /p\.classList\.toggle\("active",on\)/);
  assert.match(appJs, /p\.setAttribute\("hidden",""\)/);
  assert.match(appJs, /p\.removeAttribute\("hidden"\)/);
  /* Atelier must not force #dashboardPage visible without .active (Codex scroll-merge bug). */
  assert.match(atelierUi, /body\.florisyn-atelier\s+\.page:not\(\.active\)\s*\{\s*display:\s*none\s*!important/);
  assert.match(atelierUi, /#dashboardPage\.pos-home\.active\s*\{/);
  assert.doesNotMatch(atelierUi, /#dashboardPage\.pos-home\s*\{\s*display:\s*flex/);
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
  assert.equal(router.pathForPage("inventoryPage"), "/inventory");
  assert.equal(router.pathForPage("invoicesPage"), "/invoices");
});

test("app boots router with data-page fallback and no scroll-to-POS", () => {
  assert.match(appJs, /FlorisynRouter/);
  assert.match(appJs, /installShowPageBridge/);
  assert.match(appJs, /bootFromLocation/);
  assert.match(appJs, /posPage/);
  assert.match(appJs, /\[data-page\]"\)\.forEach\(b=>b\.onclick=/);
  assert.match(appJs, /if\(window\.FlorisynRouter\)return/);
  assert.doesNotMatch(dashJs, /luxScroll|scrollIntoView/);
  assert.doesNotMatch(html, /data-lux-scroll/);
});

test("admin remains a separate authenticated /admin shell", () => {
  assert.match(adminHtml, /id="adminApp"/);
  assert.match(adminHtml, /id="adminAuth"/);
  assert.match(adminJs, /function lockAdminShell/);
  assert.match(adminJs, /function showLoginGate/);
  assert.match(adminJs, /admin-locked/);
  assert.match(adminJs, /if\(!session\?\.accessToken\|\|!session\?\.user\)/);
  assert.doesNotMatch(html, /id="adminApp"/);
});
