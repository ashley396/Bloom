import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const appJs = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/florisyn-luxury-dashboard.css", import.meta.url), "utf8");

function greetingCardSlice() {
  const start = html.indexOf('<div class="atelier-dash-hero-actions">');
  return html.slice(start, html.indexOf("</div>", html.indexOf("</div>", start) + 1) + 6);
}

test("dashboard greeting card no longer shows Rose's portrait as if it were the florist's own photo", () => {
  const card = greetingCardSlice();
  assert.doesNotMatch(card, /rose-portrait\.png/, "the AI assistant's mascot must not stand in for the shop owner's own avatar");
});

test("greeting-card avatar is a real, accessible, tappable control — not a bare decorative image", () => {
  const card = greetingCardSlice();
  assert.match(card, /id="dashboardUserAvatarBtn"/);
  assert.match(card, /<button type="button"/);
  assert.match(card, /aria-label="Your profile photo/);
  assert.match(card, /id="dashboardUserAvatar"[^>]*hidden/, "img starts hidden until we know a real photo exists — never show a broken/empty img by default");
  assert.match(card, /id="dashboardUserAvatarFallback"/);
});

test("avatar control deep-links to Community — where the real upload/change/remove flow already lives, not a second one", () => {
  const card = greetingCardSlice();
  assert.match(card, /data-route="\/community"/);
  assert.match(card, /data-page="communityPage"/);
});

test("loadDashboardAvatar fetches the florist's own Community profile and reuses its avatar_url — no parallel upload system", () => {
  const start = appJs.indexOf("async function loadDashboardAvatar(");
  assert.ok(start >= 0, "loadDashboardAvatar must exist");
  const body = appJs.slice(start, appJs.indexOf("\nasync function loadDashboard(", start));
  assert.match(body, /api\("florist-community",\{method:"POST",body:JSON\.stringify\(\{action:"profile"\}\)\}\)/);
  assert.match(body, /d\?\.profile\?\.avatar_url/);
});

test("avatar falls back to the florist's real initial, never a mascot or a blank broken image, and fails quiet on error", () => {
  const start = appJs.indexOf("async function loadDashboardAvatar(");
  const body = appJs.slice(start, appJs.indexOf("\nasync function loadDashboard(", start));
  assert.match(body, /firstNameFromIdentity\(session\?\.user,\s*shopSettings\)/, "initial must come from the real signed-in florist, not a hardcoded name");
  assert.match(body, /catch\{/);
  assert.match(body, /img\.hidden=true;fallback\.hidden=false/);
});

test("loadDashboard actually calls loadDashboardAvatar — wiring isn't dead code", () => {
  const start = appJs.indexOf("async function loadDashboard(){");
  const firstLines = appJs.slice(start, start + 200);
  assert.match(firstLines, /loadDashboardAvatar\(\)/);
});

test("avatar button and fallback have real, non-placeholder CSS (sizing, focus ring, initials styling)", () => {
  assert.match(css, /\.florisyn-lux-user-avatar-btn\s*\{/);
  assert.match(css, /\.florisyn-lux-user-avatar-btn:focus-visible/);
  assert.match(css, /\.florisyn-lux-user-avatar-fallback\s*\{/);
});
