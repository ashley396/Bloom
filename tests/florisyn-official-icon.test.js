import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("official Florisyn icon PNG is present and substantial", () => {
  const official = fs.statSync(new URL("../public/assets/florisyn/florisyn-official-icon.png", import.meta.url));
  const mark = fs.statSync(new URL("../public/assets/florisyn/florisyn-mark.png", import.meta.url));
  const fav = fs.statSync(new URL("../public/assets/florisyn/florisyn-favicon-32.png", import.meta.url));
  const apple = fs.statSync(new URL("../public/assets/florisyn/florisyn-apple-touch-180.png", import.meta.url));
  assert.ok(official.size > 50_000, "official icon too small");
  assert.ok(mark.size > 10_000, "mark png too small");
  assert.ok(fav.size > 500, "favicon png missing");
  assert.ok(apple.size > 10_000, "apple touch missing");
});

test("pages use official Florisyn PNG mark, not generic SVG monoline", () => {
  for (const page of ["login.html", "index.html", "admin.html", "signup.html"]) {
    const html = fs.readFileSync(new URL(`../public/${page}`, import.meta.url), "utf8");
    if (page === "login.html") {
      assert.match(html, /florisyn-login-lockup\.png|florisyn-mark\.png|florisyn-official-icon\.png/, `${page} should use official Florisyn logo asset`);
    } else {
      assert.match(html, /florisyn-mark\.png/, `${page} should use official PNG mark`);
    }
    assert.doesNotMatch(html, /florisyn-mark\.svg/, `${page} should not use generic SVG mark`);
  }
  const manifest = fs.readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8");
  assert.match(manifest, /florisyn-app-icon-192\.png/);
  assert.match(manifest, /florisyn-app-icon-512\.png/);
});
