import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const concepts = [
  ["concept-a-stem-f", ["florisyn-concept-a-color.svg", "florisyn-concept-a-black.svg", "florisyn-concept-a-white.svg", "florisyn-concept-a-favicon.svg"]],
  ["concept-b-hidden-flower", ["florisyn-concept-b-color.svg", "florisyn-concept-b-black.svg", "florisyn-concept-b-white.svg", "florisyn-concept-b-favicon.svg"]],
  ["concept-c-monoline", ["florisyn-concept-c-color.svg", "florisyn-concept-c-black.svg", "florisyn-concept-c-white.svg", "florisyn-concept-c-favicon.svg"]]
];

test("three Florisyn logo concept families exist", () => {
  for (const [dir, files] of concepts) {
    for (const file of files) {
      const path = new URL(`../public/assets/florisyn/concepts/${dir}/${file}`, import.meta.url);
      const svg = fs.readFileSync(path, "utf8");
      assert.match(svg, /<svg/);
      assert.match(svg, /Florisyn Concept/i);
    }
  }
});

test("logo concepts use brand palette not clip-art flowers", () => {
  const colorA = fs.readFileSync(
    new URL("../public/assets/florisyn/concepts/concept-a-stem-f/florisyn-concept-a-color.svg", import.meta.url),
    "utf8"
  );
  assert.match(colorA, /6[Bb]8[Ff]7[Aa]|4[Dd]6[Bb]5[Cc]/);
  assert.doesNotMatch(colorA, /rose|tulip|clip/i);
});

test("founder preview page links all concepts", () => {
  const html = fs.readFileSync(new URL("../public/assets/florisyn/concepts/preview.html", import.meta.url), "utf8");
  assert.match(html, /concept-a-stem-f/);
  assert.match(html, /concept-b-hidden-flower/);
  assert.match(html, /concept-c-monoline/);
});
