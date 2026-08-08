import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("atelier CSS does not force inactive Dashboard into layout", () => {
  const css = read("public/florisyn-atelier-ui.css");
  assert.doesNotMatch(css, /#dashboardPage\.pos-home\s*\{\s*display:\s*flex/);
  assert.match(css, /#dashboardPage\.pos-home\.active:not\(\[hidden\]\)/);
  assert.match(css, /\.page:not\(\.active\)/);
  assert.match(css, /\.page\[hidden\]/);
  assert.match(css, /display:\s*none\s*!important/);
});

test("showPage hides inactive pages immediately without transitionTo delay", () => {
  const app = read("public/app.js");
  const start = app.indexOf("function showPage(id)");
  assert.ok(start >= 0);
  const end = app.indexOf("\nasync function loadPaymentsPage", start);
  const fn = app.slice(start, end > start ? end : start + 700);
  assert.match(fn, /p\.hidden=!on/);
  assert.match(fn, /classList\.toggle\("active",on\)/);
  assert.doesNotMatch(fn, /BloomLaunchPolish\?\.transitionTo|transitionTo\(id,/);
});

test("styles.css keeps fail-closed .page / .page.active contract", () => {
  const css = read("public/styles.css");
  assert.match(css, /\.page\{display:none\}/);
  assert.match(css, /\.page\.active\{display:block\}/);
  assert.match(css, /\[hidden\]\{display:none!important\}/);
});

test("Admin remains a separate document from florist shell", () => {
  assert.match(read("public/admin.html"), /id="adminAuth"/);
  assert.match(read("public/admin.html"), /id="adminApp"[^>]*hidden/);
  assert.doesNotMatch(read("public/index.html"), /id="adminApp"/);
  assert.doesNotMatch(read("public/login.js"), /mfa\.enroll|adminMfaForm|challengeAndVerifyAdminMfa/);
});
