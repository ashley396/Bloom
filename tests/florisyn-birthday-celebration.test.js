import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("birthday celebration assets are wired in the app shell", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");
  assert.match(html, /florisyn-birthday-celebration\.js/);
  assert.match(html, /florisyn-birthday-celebration\.css/);
  assert.match(html, /florisyn-official-icon\.png/);
});

test("birthday module celebrates Aug 10 and personalizes dashboard", () => {
  const js = fs.readFileSync(path.join(process.cwd(), "public/florisyn-birthday-celebration.js"), "utf8");
  assert.match(js, /08-10/);
  assert.match(js, /FlorisynBirthday/);
  assert.match(js, /Happy Birthday/);
  assert.match(js, /florisyn-birthday-banner/);
});

test("birthday stylesheet includes confetti and assistant cards", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "public/florisyn-birthday-celebration.css"), "utf8");
  assert.match(css, /florisyn-birthday-assistants/);
  assert.match(css, /prefers-reduced-motion/);
});
