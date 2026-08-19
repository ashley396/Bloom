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

test("UI surfaces point at live avatar PNGs", () => {
  // Lily, Rose, and Daisy appear as avatars in the top assistant dock (index.html).
  // The floating on-screen Daisy mascot was intentionally retired, so the avatar
  // is verified here in the header/dock rather than in daisy-mascot.js.
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const lily = fs.readFileSync(new URL("../public/lily-platform.js", import.meta.url), "utf8");
  assert.match(html, /florisyn-live-avatars\.css/);
  assert.match(html, /lily-portrait\.png/);
  assert.match(html, /rose-portrait\.png/);
  assert.match(html, /daisy-portrait\.png/);
  assert.match(lily, /lily-portrait\.png/);
});
