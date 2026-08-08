import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const login = fs.readFileSync(new URL("../public/login.html", import.meta.url), "utf8");
const signup = fs.readFileSync(new URL("../public/signup.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/florisyn-atelier-auth.css", import.meta.url), "utf8");

test("login and signup use premium auth hero shell with official mark", () => {
  for (const html of [login, signup]) {
    assert.match(html, /florisyn-auth-hero/);
    assert.match(html, /florisyn-atelier-auth\.css\?v=authhero2/);
    assert.match(html, /florisyn-mark\.png\?v=official1/);
    assert.match(html, /<strong>Florisyn<\/strong>/);
    assert.match(html, /florisyn-auth-hero-devices\.png/);
    assert.match(html, /florisyn-auth-petals\.png/);
    assert.match(html, /Where Your Passion Flowers/);
  }
});

test("login keeps auth form contracts", () => {
  assert.match(login, /id="authForm"/);
  assert.match(login, /id="email"/);
  assert.match(login, /id="password"/);
  assert.match(login, /id="authButton"/);
  assert.match(login, /id="authMessage"/);
  assert.match(login, /Thoughtful florist software for modern shops/);
  assert.match(login, /Welcome back!/);
  assert.match(login, /About Florisyn/);
  assert.doesNotMatch(login, /The #1 florist management platform/);
  assert.doesNotMatch(login, /Watch Demo/);
  assert.match(login, /Create account/);
});

test("signup keeps trial form contracts", () => {
  assert.match(signup, /id="signupForm"/);
  assert.match(signup, /id="pricing"/);
  assert.match(signup, /id="fullName"/);
  assert.match(signup, /id="shopName"/);
  assert.match(signup, /id="agreeTerms"/);
  assert.match(signup, /Start Your Free Trial/);
});

test("auth hero CSS uses Playfair display and magenta accent", () => {
  assert.match(css, /AUTH HERO/);
  assert.match(css, /--hero-magenta:\s*#c43b6e/);
  assert.match(css, /Playfair Display/);
  assert.match(css, /\.auth-hero-devices/);
  assert.match(css, /authPetalFloat/);
});

test("auth hero image assets exist", () => {
  for (const file of [
    "florisyn-auth-hero-devices.png",
    "florisyn-auth-petals.png",
    "florisyn-auth-bouquet.png",
  ]) {
    const stat = fs.statSync(new URL(`../public/assets/florisyn/${file}`, import.meta.url));
    assert.ok(stat.size > 20_000, `${file} too small`);
  }
});
