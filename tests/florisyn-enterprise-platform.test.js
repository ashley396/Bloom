import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("enterprise mobile nav exposes five primary slots on phone", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const mobileNav = html.slice(html.indexOf('class="mobile-nav atelier-mobile-nav"'));
  const mobileSection = mobileNav.slice(0, mobileNav.indexOf("</nav>"));
  assert.match(mobileSection, /data-page="posPage"/);
  assert.match(mobileSection, /data-page="ordersPage"/);
  assert.match(mobileSection, /data-page="inventoryPage"/);
  assert.match(mobileSection, /data-page="libraryPage"/);
  assert.match(mobileSection, /id="mobileNavCommunity"/);
  assert.match(mobileSection, /id="mobileNavMore"/);
  assert.match(html, /enterprise-mobile-nav\.css/);
  assert.match(html, /core\/florisyn-platform\.js/);
});

test("platform module defines drawer helper for hamburger menu", () => {
  const js = fs.readFileSync(new URL("../public/core/florisyn-platform.js", import.meta.url), "utf8");
  assert.match(js, /setDrawer/);
  assert.match(js, /mobileNavMore/);
});
