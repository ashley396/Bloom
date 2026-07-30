import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PUBLIC = join(ROOT, "public");

describe("Florisyn RC2 completion audit", () => {
  const workspacePages = [
    "inventoryPage",
    "customersPage",
    "deliveriesPage",
    "productsPage",
    "libraryPage",
    "marketplacePage",
    "wholesaleSellerPage",
    "paymentsPage",
    "websitePage",
    "aiStudioPage",
    "bloomshotPage",
    "reportsPage",
    "expensesPage",
    "invoicesPage",
    "staffPage",
    "settingsPage",
    "subscriptionPage",
    "ecosystemPage",
    "storesPage",
  ];

  it("workspace completion assets exist", () => {
    for (const file of [
      "florisyn-rc2-workspaces.css",
      "florisyn-rc2-workspaces.js",
      "florisyn-rc2-wholesale-complete.css",
    ]) {
      assert.ok(existsSync(join(PUBLIC, file)), `${file} must exist`);
    }
  });

  it("index.html wires workspace stack and onboarding", () => {
    const html = readFileSync(join(PUBLIC, "index.html"), "utf8");
    assert.match(html, /florisyn-rc2-workspaces\.css/);
    assert.match(html, /florisyn-rc2-wholesale-complete\.css/);
    assert.match(html, /florisyn-rc2-workspaces\.js/);
    assert.match(html, /id="floraviaOnboarding"/);
    assert.match(html, /onboarding\.js/);
  });

  it("workspace CSS defines purpose-built selectors for every major page", () => {
    const css =
      readFileSync(join(PUBLIC, "florisyn-rc2-workspaces.css"), "utf8") +
      readFileSync(join(PUBLIC, "florisyn-rc2-wholesale-complete.css"), "utf8");
    for (const pageId of workspacePages) {
      assert.match(css, new RegExp(`#${pageId}`), `missing #${pageId} rules`);
    }
    assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /min-height: 44px/);
    assert.match(css, /rc2-ws-dialog/);
  });

  it("wholesale complete CSS covers buyer and seller sections", () => {
    const css = readFileSync(join(PUBLIC, "florisyn-rc2-wholesale-complete.css"), "utf8");
    assert.match(css, /#marketplacePage/);
    assert.match(css, /rc2-wholesale-seller-complete/);
    assert.match(css, /wholesale-seller-nav/);
  });

  it("workspaces JS exposes orchestrator without secrets", () => {
    const js = readFileSync(join(PUBLIC, "florisyn-rc2-workspaces.js"), "utf8");
    assert.match(js, /FlorisynRC2Workspaces/);
    assert.match(js, /rc2-ws-complete/);
    assert.match(js, /wrapShowPage/);
    assert.doesNotMatch(js, /password|secret|api_key/i);
  });

  it("admin complete overlay covers Command Center views", () => {
    const css = readFileSync(join(PUBLIC, "florisyn-rc2-luxury-admin.css"), "utf8");
    assert.match(css, /#commandDashboard/);
    assert.match(css, /#adminApp/);
    assert.match(css, /min-height: 44px/);
  });

  it("auth, public, storefront, and pay link have complete RC2 layouts", () => {
    const auth = readFileSync(join(PUBLIC, "florisyn-rc2-luxury-auth.css"), "utf8");
    const pub = readFileSync(join(PUBLIC, "florisyn-rc2-luxury-public.css"), "utf8");
    const sf = readFileSync(join(PUBLIC, "florisyn-rc2-luxury-storefront.css"), "utf8");
    const pay = readFileSync(join(PUBLIC, "pay.html"), "utf8");
    assert.match(auth, /RC2 Auth complete/);
    assert.match(pub, /RC2 Public complete/);
    assert.match(sf, /RC2 Storefront complete/);
    assert.match(pay, /rc2-pay-complete/);
    assert.match(pay, /florisyn-rc2-workspaces\.css/);
  });

  it("onboarding uses RC2 palette not legacy pink", () => {
    const css = readFileSync(join(PUBLIC, "onboarding.css"), "utf8");
    assert.match(css, /#6b8f7a/);
    assert.doesNotMatch(css, /#bb6f92|#9c5877/);
    assert.match(css, /prefers-reduced-motion/);
  });

  it("luxury init provides focus trap for dialogs", () => {
    const js = readFileSync(join(PUBLIC, "florisyn-rc2-luxury-init.js"), "utf8");
    assert.match(js, /trapFocus/);
    assert.match(js, /rc2-ws-dialog/);
  });

  it("canonical tokens remap legacy pink away from SaaS palette", () => {
    const css = readFileSync(join(PUBLIC, "florisyn-rc2-tokens.css"), "utf8");
    assert.match(css, /--pink: var\(--rc2-sage-deep\)/);
    assert.doesNotMatch(css, /#007bff|#2563eb/);
  });

  it("orders and POS pages have purpose-built RC2 selectors", () => {
    const css = readFileSync(join(PUBLIC, "florisyn-rc2-orders-pos.css"), "utf8");
    assert.match(css, /#ordersPage/);
    assert.match(css, /\.pos-home/);
    assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /min-height: 44px/);
  });

  it("all static dialogs receive RC2 workspace dialog rules", () => {
    const html = readFileSync(join(PUBLIC, "index.html"), "utf8");
    const css =
      readFileSync(join(PUBLIC, "florisyn-rc2-workspaces.css"), "utf8") +
      readFileSync(join(PUBLIC, "florisyn-rc2-wholesale-complete.css"), "utf8") +
      readFileSync(join(PUBLIC, "florisyn-rc2-orders-pos.css"), "utf8") +
      readFileSync(join(PUBLIC, "florisyn-rc2-luxury-unified.css"), "utf8");
    const staticDialogs = [...html.matchAll(/<dialog id="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(staticDialogs.length >= 19, "expected at least 19 static dialogs");
    for (const id of staticDialogs) {
      const hasSpecific = new RegExp(`#${id}`).test(css);
      const hasGeneric = css.includes("dialog.rc2-ws-dialog");
      assert.ok(hasSpecific || hasGeneric, `missing RC2 rules for #${id}`);
    }
  });

  it("dynamic dialogs have RC2 workspace selectors", () => {
    const css = readFileSync(join(PUBLIC, "florisyn-rc2-workspaces.css"), "utf8");
    for (const id of ["customerProfileDialog", "phWizardDialog", "themePreviewDialog", "floraviaOnboarding"]) {
      assert.match(css, new RegExp(`#${id}`), `missing #${id} rules`);
    }
  });

  it("admin Command Center views share RC2 complete layout rules", () => {
    const css = readFileSync(join(PUBLIC, "florisyn-rc2-luxury-admin.css"), "utf8");
    const adminHtml = readFileSync(join(PUBLIC, "admin.html"), "utf8");
    const views = [...adminHtml.matchAll(/id="([^"]+View|ownerSetup|adminAuth)"/g)].map((m) => m[1]);
    assert.ok(views.length >= 16, "expected admin views in admin.html");
    assert.match(css, /\.view\.active/);
    assert.match(css, /prefers-reduced-motion/);
    for (const id of ["ownerSetup", "adminAuth", "overviewView", "usersView", "shopsView"]) {
      assert.match(adminHtml, new RegExp(`id="${id}"`));
    }
  });

  it("auth routes activate RC2 luxury body class and overlay CSS", () => {
    const authCss = readFileSync(join(PUBLIC, "florisyn-rc2-luxury-auth.css"), "utf8");
    for (const page of ["login.html", "signup.html", "verify-email.html", "forgot-password.html", "reset-password.html"]) {
      const html = readFileSync(join(PUBLIC, page), "utf8");
      assert.match(html, /florisyn-rc2-luxury-auth\.css/);
      assert.match(html, /florisyn-rc2-luxury/);
    }
    assert.match(authCss, /RC2 Auth complete/);
  });

  it("public and storefront satellite pages use RC2 overlays", () => {
    const publicPages = [
      "company/about/index.html",
      "help/index.html",
      "legal/privacy/index.html",
      "sitemap/index.html",
      "storefront/index.html",
    ];
    for (const page of publicPages) {
      const html = readFileSync(join(PUBLIC, page), "utf8");
      assert.match(html, /florisyn-rc2-luxury/);
    }
  });

  it("workspaces JS avoids duplicate showPage wrapping", () => {
    const js = readFileSync(join(PUBLIC, "florisyn-rc2-workspaces.js"), "utf8");
    assert.match(js, /showPageWrapped/);
    assert.match(js, /__rc2WsWrapped/);
    assert.match(js, /observeDynamicDialogs/);
    assert.equal((js.match(/window\.showPage\s*=/g) || []).length, 1);
  });

  it("onboarding module exports post-login hook without altering auth flow", () => {
    const js = readFileSync(join(PUBLIC, "onboarding.js"), "utf8");
    assert.match(js, /floraviaSaasAfterLogin/);
    assert.match(js, /window\.floraviaSaasAfterLogin/);
    assert.doesNotMatch(js, /window\.location\.replace\(/);
  });

  it("wholesale seller dashboard renders RC2-complete sections", () => {
    const js = readFileSync(join(PUBLIC, "wholesale-seller-dashboard.js"), "utf8");
    for (const section of ["dashboard", "products", "orders", "customers", "shipping", "pricing", "import"]) {
      assert.match(js, new RegExp(section, "i"), `missing wholesale seller section: ${section}`);
    }
  });
});
