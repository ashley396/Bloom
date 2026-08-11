import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("enterprise mobile nav exposes five primary tabs", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const mobileNav = html.slice(html.indexOf('class="mobile-nav atelier-mobile-nav"'));
  const mobileSection = mobileNav.slice(0, mobileNav.indexOf("</nav>"));
  assert.match(mobileSection, /data-page="posPage"/);
  assert.match(mobileSection, /data-page="ordersPage"/);
  assert.match(mobileSection, /data-page="inventoryPage"/);
  assert.match(mobileSection, /data-page="libraryPage"/);
  assert.match(mobileSection, /data-page="communityPage"/);
  assert.doesNotMatch(mobileSection, /id="mobileNavMore"/);
  assert.match(html, /enterprise-mobile-nav\.css/);
  assert.match(html, /core\/florisyn-platform\.js/);
});

test("assistant dock wires Lily, Rose, and Daisy", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /data-assistant="lily"/);
  assert.match(html, /data-assistant="rose"/);
  assert.match(html, /data-assistant="daisy"/);
  assert.match(html, /data-page="aiStudioPage"/);
});

test("official premium logo used on loading screen and mobile header", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /florisyn-official-icon\.png/);
  assert.match(html, /florisyn-official-logo/);
});

test("platform module defines assistant routing", () => {
  const js = fs.readFileSync(new URL("../public/core/florisyn-platform.js", import.meta.url), "utf8");
  assert.match(js, /aiStudioPage/);
  assert.match(js, /reportsPage/);
  assert.match(js, /setDrawer/);
});

test("http security headers include enterprise hardening", () => {
  const js = fs.readFileSync(new URL("../netlify/functions/_shared/http.js", import.meta.url), "utf8");
  assert.match(js, /Strict-Transport-Security/);
  assert.match(js, /Permissions-Policy/);
  assert.match(js, /Cross-Origin-Opener-Policy/);
});
