import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const login = fs.readFileSync(path.join(root, "public/login.html"), "utf8");
const signup = fs.readFileSync(path.join(root, "public/signup.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "public/admin.js"), "utf8");
const adminCc = fs.readFileSync(path.join(root, "public/admin-command-center-ui.js"), "utf8");
const voice = fs.readFileSync(path.join(root, "netlify/functions/_shared/assistant-voice.js"), "utf8");
const atelierCss = fs.readFileSync(path.join(root, "public/florisyn-atelier-ui.css"), "utf8");

test("POS sits above profit intelligence on the dashboard", () => {
  const pos = html.indexOf('class="pos-workspace"');
  const profit = html.indexOf('class="profit-intelligence-grid"');
  assert.ok(pos > 0 && profit > 0);
  assert.ok(pos < profit);
  assert.match(html, /data-page="dashboardPage">Point of Sale</);
});

test("login and signup copy match founder auth directive", () => {
  assert.match(login, /<h1 id="loginHeading">Welcome back<\/h1>/);
  assert.doesNotMatch(login, /with Beauty|Book a Demo|Watch Demo|#1 florist/i);
  assert.match(login, /Built for florists who deserve better/);
  assert.match(login, /About Florisyn/);
  assert.match(signup, /Welcome back/);
  assert.doesNotMatch(signup, /Book a Demo|#1 florist/i);
  assert.match(signup, /Built for florists who deserve better/);
});

test("assistant personalities stay upbeat Lily, wise Rose, cheerful Daisy", () => {
  assert.match(voice, /upbeat creative partner/);
  assert.match(voice, /Good morning, dear\. I'm Rose/);
  assert.match(voice, /cheerful shop pup/);
  assert.match(html, /Shop Mascot/);
});

test("showPage scrolls to top and hides inactive pages", () => {
  assert.match(app, /window\.scrollTo\(0,0\)/);
  assert.match(app, /p\.hidden=!on/);
});

test("mobile atelier keeps POS product pads visible", () => {
  assert.doesNotMatch(
    atelierCss,
    /\.profit-intelligence-grid,\s*\.pos-workspace\s*\{\s*display:\s*none\s*!important/
  );
  assert.match(atelierCss, /Keep Point of Sale \+ product pads reachable on mobile/);
});

test("admin wiring uses click delegation and fixed role filter listener", () => {
  assert.match(adminJs, /__florisynAdminNavWired/);
  assert.match(adminJs, /openShopBtn/);
  assert.match(adminJs, /v\.hidden=!on/);
  assert.match(adminCc, /userRoleFilter'\)\?\.addEventListener\('change'/);
  assert.doesNotMatch(adminCc, /userRoleFilter'\)\?\.change\(/);
});

test("library images no longer use known non-floral placeholders", () => {
  assert.doesNotMatch(app, /photos\/2111192|photos\/1308881|photos\/54200|photos\/1407322|photos\/459335/);
  const urls = [...app.matchAll(/https:\/\/images\.pexels\.com\/photos\/[^"']+/g)].map((m) => m[0]);
  assert.equal(new Set(urls).size, urls.length);
});
