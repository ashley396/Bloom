import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const polish = fs.readFileSync(new URL("../public/florisyn-rc2.2-founder-polish.css", import.meta.url), "utf8");

test("launch design layer covers Orders, Website Studio, Payments, and Staff", () => {
  for (const selector of [".order-command-page", "#websitePage", "#paymentsPage", "#staffPage"]) {
    assert.match(polish, new RegExp(selector.replace(/[.#]/g, "\\$&")));
  }
});

test("launch design layer uses approved Florisyn luxury palette tokens", () => {
  for (const color of ["#18252f", "#fffcf8", "#f3e4e8", "#c9a962", "#3d5c4a"]) {
    assert.match(polish, new RegExp(color, "i"));
  }
});

test("launch design layer has one canonical launch surface block", () => {
  const matches = polish.match(/Launch surfaces?: Orders, Website Studio, Payments, Staff/g) || [];

  assert.equal(matches.length, 1);
});

test("launch surface cards use restrained 8px radius", () => {
  assert.match(polish, /border-radius:\s*8px/);
  assert.doesNotMatch(polish, /#websitePage[\s\S]{0,1200}border-radius:\s*14px/);
});

test("Today dashboard structure selectors remain preserved", () => {
  assert.match(polish, /#dashboardPage\.pos-home/);
  assert.match(polish, /\.pos-welcome-row/);
});
