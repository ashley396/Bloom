import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("RC2.1 polish assets linked from index", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /bloom-rc2\.1-polish\.css/);
  assert.match(html, /bloom-rc2\.1-founder-polish\.js/);
  assert.match(html, /bloom-rc21/);
  assert.match(html, /bloomLoadingScreen/);
});

test("RC2.1 founder polish exports module hooks", () => {
  const src = fs.readFileSync(new URL("../public/bloom-rc2.1-founder-polish.js", import.meta.url), "utf8");
  assert.match(src, /window\.BloomRC21/);
  assert.match(src, /enhanceCommandCenter/);
  assert.match(src, /customerCard/);
  assert.match(src, /staffCard/);
});

test("app.js wires BloomRC21 hooks", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /BloomRC21\?\.enhanceCommandCenter/);
  assert.match(app, /BloomRC21\?\.customerCard/);
  assert.match(app, /BloomRC21\?\.mountOrdersToolbar/);
});

test("reset password page and function", () => {
  const html = fs.readFileSync(new URL("../public/reset-password.html", import.meta.url), "utf8");
  assert.match(html, /bloom-auth\.css/);
  assert.match(html, /reset-password\.js/);
  const fn = fs.readFileSync(new URL("../netlify/functions/auth-reset-password.js", import.meta.url), "utf8");
  assert.match(fn, /auth\/v1\/user/);
  const toml = fs.readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  assert.match(toml, /reset-password/);
  const forgot = fs.readFileSync(new URL("../netlify/functions/auth-forgot-password.js", import.meta.url), "utf8");
  assert.match(forgot, /sendPasswordResetEmail/);
  const helper = fs.readFileSync(new URL("../netlify/functions/_shared/auth-confirmation-email.js", import.meta.url), "utf8");
  assert.match(helper, /\/reset-password/);
  assert.match(helper, /type:\s*"recovery"/);
  assert.match(helper, /token_hash|buildFlorisynRecoveryUrl/);
  assert.match(fn, /token_hash/);
});

test("RC2.1 consistency layer linked last", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const idx = html.indexOf("bloom-rc2.1-consistency.css");
  const idxPolish = html.indexOf("bloom-rc2.1-polish.css");
  assert.ok(idx > idxPolish);
  assert.match(html, /bloom-rc2\.1-consistency\.js/);
});

test("RC2.1 consistency stylesheet covers assistants and dialogs", () => {
  const css = fs.readFileSync(new URL("../public/bloom-rc2.1-consistency.css", import.meta.url), "utf8");
  assert.match(css, /\.lily-fab/);
  assert.match(css, /\.bloom-daisy/);
  assert.match(css, /dialog/);
  assert.match(css, /mobile-nav/);
});

test("floral library UI shows recipe meta", () => {
  const ui = fs.readFileSync(new URL("../public/floral-library-ui.js", import.meta.url), "utf8");
  assert.match(ui, /library-recipe-meta/);
  assert.match(ui, /stems/);
});
