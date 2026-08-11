import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test("mobile shell stylesheet is loaded last in the app shell", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const posCriticalEnd = html.indexOf("</style>");
  const shellIdx = html.indexOf("florisyn-mobile-shell.css");
  assert.ok(posCriticalEnd >= 0 && shellIdx > posCriticalEnd, "mobile shell should load after POS critical CSS");
});

test("mobile shell fixes off-canvas drawer and full-width main", () => {
  const css = fs.readFileSync(path.join(root, "public/florisyn-mobile-shell.css"), "utf8");
  assert.match(css, /max-width: 820px/);
  assert.match(css, /grid-template-columns: none/);
  assert.match(css, /position: fixed !important/);
  assert.match(css, /translateX\(-105%\)/);
  assert.match(css, /florisyn-lux-main > \.content/);
  assert.match(css, /--florisyn-mobile-nav-height/);
  assert.match(css, /repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /pos-lux-checkout/);
  assert.match(css, /lily-fab img/);
  assert.match(css, /52px/);
});

test("mobile bottom nav exposes five tabs including Community when beta is on", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /id="mobileNavMore"/);
  assert.match(html, /id="mobileNavCommunity"/);
  assert.match(html, /id="lilyRetryCommunityBtn"/);
  assert.match(html, /data-page="dashboardPage"/);
  assert.match(html, /data-page="posPage"/);
  assert.match(html, /data-page="ordersPage"/);
  assert.match(html, /data-page="libraryPage"/);
});

test("POS critical CSS stacks register on phone widths", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const critical = html.slice(html.indexOf("florisyn-pos-critical"), html.indexOf("</style>", html.indexOf("florisyn-pos-critical")));
  assert.match(critical, /@media\(max-width:820px\)/);
  assert.match(critical, /pos-lux-main-row\{flex-direction:column/);
  assert.match(critical, /pos-lux-checkout\{[^}]*width:100%/);
});
