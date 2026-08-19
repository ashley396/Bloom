import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const appHtml = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const appJs = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const signupJs = fs.readFileSync(new URL("../public/signup.js", import.meta.url), "utf8");

test("florist dashboard greeting is tenant/user derived, not hardcoded to one founder", () => {
  assert.match(appHtml, /id="atelierUserName">Florist<\/b>/);
  // The old "Hi there!" card (id="lilySuggestionGreeting") was itself a
  // fabrication — static copy claiming "I found new floral ideas that
  // match your inventory" regardless of real data (Lily Step 73). It's
  // now a real "Needs Attention" panel with no name in it at all, which
  // satisfies the no-hardcoded-founder-name guarantee even more directly
  // than a per-user greeting would.
  assert.match(appHtml, /id="lilySuggestionGreeting">Needs Attention<\/h2>/);
  assert.doesNotMatch(appHtml, /Hi Ashley!/);
  assert.doesNotMatch(appHtml, /id="atelierUserName">Ashley<\/b>/);
  assert.match(appJs, /function firstNameFromIdentity/);
  assert.match(appJs, /user_metadata\?\.full_name/);
  assert.match(appJs, /#atelierUserName/);
  assert.doesNotMatch(appJs, /Good evening",daypart[\s\S]*Ashley!/);
  assert.doesNotMatch(appJs, /Hi Ashley!/);
});

test("dashboard icon controls have explicit button types and accessible names", () => {
  assert.match(appHtml, /for="tileCategoryFilter">Product tile category/);
  assert.match(appHtml, /type="button" aria-label="Show compact product tile grid">▦/);
  assert.match(appHtml, /type="button" aria-label="Show spacious product tile grid">▤/);
});

test("signup form does not crash when submitted without event.submitter", () => {
  assert.match(signupJs, /e\.submitter\s*\|\|\s*\$\(['"]#signupForm button\[type=['"]submit['"]\]['"]\)/);
});
