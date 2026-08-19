import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const loginHtml = fs.readFileSync(path.join(root, "public/login.html"), "utf8");
const signupHtml = fs.readFileSync(path.join(root, "public/signup.html"), "utf8");

/**
 * login.html and signup.html's top nav ("Product / Features / Pricing /
 * Resources / About") had "Product" and "Features" pointing at the exact
 * same /company/services/ URL — two labels, one destination — and each
 * page's top-right CTA button was labeled "About Florisyn" and linked to
 * the same /company/about/ page as the plain "About" nav link right next
 * to it. Verifies the nav no longer has two links to the same place, and
 * the CTA slot does something distinct and useful instead.
 */
function extractNavLinks(html) {
  const navMatch = html.match(/<nav class="auth-hero-links"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(navMatch, "auth-hero-links nav not found");
  return [...navMatch[1].matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}

test("login.html nav has no duplicate destinations", () => {
  const hrefs = extractNavLinks(loginHtml);
  assert.equal(new Set(hrefs).size, hrefs.length, `duplicate nav destinations: ${hrefs.join(", ")}`);
  assert.doesNotMatch(loginHtml, />About Florisyn<\/a>/);
});

test("signup.html nav has no duplicate destinations", () => {
  const hrefs = extractNavLinks(signupHtml);
  assert.equal(new Set(hrefs).size, hrefs.length, `duplicate nav destinations: ${hrefs.join(", ")}`);
  assert.doesNotMatch(signupHtml, />About Florisyn<\/a>/);
});
