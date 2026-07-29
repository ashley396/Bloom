import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Florisyn manifest and icons", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.name, "Florisyn");
  assert.equal(manifest.short_name, "Florisyn");
  assert.match(manifest.icons[0].src, /florisyn/);
  for (const file of ["florisyn-mark.svg", "favicon.svg", "florisyn-wordmark.svg", "florisyn-logo-light.svg"]) {
    fs.accessSync(new URL(`../public/assets/florisyn/${file}`, import.meta.url));
  }
});

test("main app uses Florisyn shell", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /Florisyn — The Operating System for Modern Florists/);
  assert.match(html, /florisyn-brand\.css/);
  assert.match(html, /florisyn-founder-1\.0\.css/);
  assert.match(html, /florisyn-version\.js/);
  assert.match(html, /class="[^"]*florisyn/);
  assert.doesNotMatch(html, /bloom-wordmark\.svg/);
});

test("auth pages say Florisyn not Bloom", () => {
  for (const page of ["login.html", "signup.html", "forgot-password.html", "verify-email.html", "reset-password.html"]) {
    const html = fs.readFileSync(new URL(`../public/${page}`, import.meta.url), "utf8");
    assert.match(html, /Florisyn/);
    assert.doesNotMatch(html, /<strong>Bloom<\/strong>/);
    assert.match(html, /florisyn-founder-1\.0\.css/);
  }
});

test("email templates use Florisyn branding", () => {
  const src = fs.readFileSync(new URL("../netlify/functions/_shared/notification-email.js", import.meta.url), "utf8");
  assert.match(src, /FLORISYN PAYMENTS/);
  assert.doesNotMatch(src, /BLOOM PAYMENTS/);
});
