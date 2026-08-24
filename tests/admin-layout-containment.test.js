import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("Admin app hidden before auth and login shell stays primary", () => {
  const html = read("public/admin.html");
  const css = read("public/admin.css");
  const atelier = read("public/florisyn-atelier-admin.css");
  assert.match(html, /class="[^"]*\badmin-locked\b/);
  assert.match(html, /id="adminApp"[^>]*\bhidden\b/);
  assert.match(css, /body\.admin-locked\s*#adminApp/);
  assert.match(css, /body\.admin-locked[\s\S]*overflow\s*:\s*hidden/);
  assert.match(atelier, /admin-locked\s*#adminApp/);
});

test("Admin sidebar and workspace use explicit two-column grid placement", () => {
  const css = read("public/admin.css");
  const atelier = read("public/florisyn-atelier-admin.css");
  assert.match(css, /#adminApp\s*\{[\s\S]*grid-template-columns\s*:\s*250px\s+minmax\(0\s*,\s*1fr\)/);
  assert.match(css, /#adminApp\s*>\s*aside[\s\S]*grid-column\s*:\s*1/);
  assert.match(css, /#adminApp\s*>\s*\.workspace[\s\S]*grid-column\s*:\s*2/);
  assert.match(atelier, /#adminApp\s*>\s*aside[\s\S]*grid-column\s*:\s*1/);
  assert.match(atelier, /#adminApp\s*>\s*\.workspace[\s\S]*grid-column\s*:\s*2/);
});

test("Mobile drawer: the sidebar's z-index beats the backdrop's in both admin.css and its atelier override, so nav taps land on the sidebar, not the dimmer", () => {
  const css = read("public/admin.css");
  const atelier = read("public/florisyn-atelier-admin.css");

  const backdropMatch = css.match(/#adminNavBackdrop\{[^}]*z-index:(\d+)/);
  assert.ok(backdropMatch, "expected to find the drawer backdrop's z-index in admin.css");
  const backdropZ = Number(backdropMatch[1]);

  const asideZValues = [...css.matchAll(/#adminApp>aside\{[^}]*z-index:(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(asideZValues.some((z) => z > backdropZ), "admin.css must give the drawer a z-index above its own backdrop");

  // florisyn-atelier-admin.css loads AFTER admin.css and reaches aside
  // through a body-class-qualified selector with higher specificity, so
  // its unconditional z-index:5 silently wins over admin.css's drawer
  // z-index on every viewport unless this mobile-scoped override raises
  // it back above the backdrop too — otherwise every nav tap lands on the
  // backdrop (which only closes the menu) instead of the button beneath it.
  const atelierMobileBlock = atelier.slice(atelier.indexOf("@media (max-width: 900px)"));
  const atelierAsideMatch = atelierMobileBlock.match(/#adminApp\s*>\s*aside\s*\{[^}]*z-index:\s*(\d+)/);
  assert.ok(atelierAsideMatch, "expected florisyn-atelier-admin.css's mobile block to set aside's z-index");
  assert.ok(
    Number(atelierAsideMatch[1]) > backdropZ,
    `atelier mobile aside z-index (${atelierAsideMatch[1]}) must exceed the backdrop's (${backdropZ})`
  );
});

test("Command Center and Beta Toolkit panels stay inside workspace column", () => {
  const html = read("public/admin.html");
  const css = read("public/admin.css");
  assert.match(html, /class="workspace"[\s\S]*id="commandDashboard"/);
  assert.match(html, /id="betaToolkitPanel"/);
  assert.match(css, /#commandDashboard[\s\S]*#betaToolkitPanel[\s\S]*max-width\s*:\s*100%/);
});

test("Beta toolkit known issues and feedback render inside #betaToolkitPanel", () => {
  const cc = read("public/admin-command-center-ui.js");
  const bloom = read("netlify/functions/_shared/bloom-release.js");
  assert.match(cc, /const mount = \$\('#betaToolkitPanel'\)/);
  assert.match(cc, /known_issues/);
  assert.match(cc, /Feedback inbox/);
  assert.match(cc, /beta-toolkit-row/);
  assert.match(bloom, /KNOWN_ISSUES_V1/);
});

test("Remote editor and UI Design Mode markers remain in Admin shell", () => {
  const html = read("public/admin.html");
  const js = read("public/admin.js");
  assert.match(html, /data-view="editor"/);
  assert.match(html, /data-view="uiDesignMode"/);
  assert.match(html, /id="uiDesignModeRoot"/);
  assert.match(html, /Edit florist pages \(Design Mode\)/);
  assert.match(js, /FlorisynUiEditor/);
  assert.match(js, /uiDesignMode/);
});

test("Admin JS relocates launch-polish onboarding banner into workspace host", () => {
  const js = read("public/admin.js");
  const html = read("public/admin.html");
  assert.match(html, /id="adminOnboardingHost"/);
  assert.match(js, /function relocateAdminOnboardingBanner/);
  assert.match(js, /relocateAdminOnboardingBanner\(\)/);
  assert.match(js, /bloom-onboarding-banner\[data-mode="admin"\]/);
});

test("Launch-polish onboarding cannot permanently break Admin grid columns", () => {
  const css = read("public/admin.css");
  assert.match(css, /#adminApp\s*>\s*\.bloom-onboarding-banner[\s\S]*grid-column\s*:\s*2/);
});
