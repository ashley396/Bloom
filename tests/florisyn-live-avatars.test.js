import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("live avatar PNGs exist for Lily, Rose, and Daisy", () => {
  for (const rel of [
    "public/assets/assistants/lily-portrait.png",
    "public/assets/assistants/rose-portrait.png",
    "public/assets/assistants/daisy-portrait.png",
    "public/assets/daisy/daisy-portrait.png"
  ]) {
    const st = fs.statSync(new URL(`../${rel}`, import.meta.url));
    assert.ok(st.size > 10_000, `${rel} should be a real portrait asset`);
  }
});

test("top Daisy dock kept; floating/bottom dog mascots removed", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const daisy = fs.readFileSync(new URL("../public/daisy-mascot.js", import.meta.url), "utf8");
  const lily = fs.readFileSync(new URL("../public/lily-platform.js", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(html, /florisyn-live-avatars\.css/);
  assert.match(html, /daisy-dock-btn/);
  assert.match(html, /<b>Daisy<\/b>/);
  assert.match(html, /lily-portrait\.png/);
  assert.match(html, /rose-portrait\.png/);
  assert.match(html, /daisy-portrait\.png/);
  assert.doesNotMatch(html, /id="bloomDog"|class="bloom-dog"/);
  assert.doesNotMatch(html, /Pet Lily the shop dog/);
  assert.match(html, /florisyn-no-floating-mascot\.css/);
  assert.match(daisy, /intentionally disabled|noop/);
  assert.doesNotMatch(daisy, /bloom-daisy--wag|dogTrot|appendChild\(el\)/);
  assert.doesNotMatch(app, /petBloomDog|#bloomDog/);
  assert.match(lily, /lily-portrait\.png/);
});

test("floral library arrangement images are unique", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const urls = [...app.matchAll(/"(https:\/\/images\.pexels\.com[^"]+|\/assets\/floral-library\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(urls.length >= 10);
  assert.equal(new Set(urls).size, urls.length, "duplicate floral image URLs found");
});
