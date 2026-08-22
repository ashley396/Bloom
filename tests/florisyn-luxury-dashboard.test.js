import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/florisyn-luxury-dashboard.css"), "utf8");
const dashJs = fs.readFileSync(path.join(root, "public/florisyn-atelier-dashboard.js"), "utf8");

test("luxury Figma shell chrome is wired", () => {
  assert.match(html, /florisyn-lux-shell/);
  assert.match(html, /florisyn-lux-sidebar/);
  assert.match(html, /florisyn-lux-main/);
  assert.match(html, /florisyn-ask-lily/);
  assert.match(html, /FLOWER SHOP OS/);
  assert.match(html, /ROSE FOUNDATION/);
  assert.match(html, /florisyn-luxury-dashboard\.css/);
  assert.match(html, /\+ New Order/);
  assert.match(html, /Orders Today/);
  assert.match(html, /Deliveries Today/);
  assert.match(html, /Repeat Customers/);
  assert.match(html, /Payment Centre/);
  assert.match(html, /PREMIUM PLAN|Premium Plan/i);
});

test("luxury palette uses navy and rose without green primary buttons", () => {
  assert.match(css, /#1a1f3c/);
  assert.match(css, /#e06b85/i);
  assert.match(css, /#fbf6f7/i);
  assert.match(css, /#26263a/i);
  assert.match(css, /#c8cade/i);
  assert.match(css, /family=Inter|Inter,/);
  assert.match(css, /Crimson Pro/);
  assert.match(css, /\.florisyn-ask-lily/);
  assert.match(css, /button\.soft-green/);
  assert.doesNotMatch(css, /background:\s*#547428|background:\s*#486329/i);
});

test("luxury dashboard list rendering keeps delivery badges and date chip", () => {
  assert.match(dashJs, /dashboardDateChip/);
  assert.match(dashJs, /atelier-delivery-badge/);
  assert.match(html, /id="posPage"/);
  assert.match(html, /data-route="\/pos"/);
  assert.doesNotMatch(html, /data-lux-scroll/);
});
