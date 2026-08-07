import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const USER_VISIBLE_BLOCKLIST = [
  /\bBloom HQ\b/,
  /\bBloom POS\b/,
  /\bBloom Platform\b/i,
  /\bCreate my free Bloom\b/,
  /\bBloom order\b/,
  /<strong>Bloom<\/strong>/,
  /bloom-wordmark\.svg/,
  /bloom-mark\.svg/,
  /assets\/bloom-icon/
];

test("production logo is Concept C monoline in florisyn-mark.svg", () => {
  const mark = fs.readFileSync(new URL("../public/assets/florisyn/florisyn-mark.svg", import.meta.url), "utf8");
  assert.match(mark, /#1[Aa]2[Bb]48/);
  assert.match(mark, /#FAF7F2/i);
  assert.match(mark, /#C9A962/i);
  assert.doesNotMatch(mark, /fill="#6b8f7a"/);
});

test("public HTML has no blocked Bloom branding strings", () => {
  const roots = [
    "login.html",
    "signup.html",
    "forgot-password.html",
    "verify-email.html",
    "reset-password.html",
    "index.html",
    "admin.html",
    "company/about/index.html",
    "help/index.html"
  ];
  const hits = [];
  for (const rel of roots) {
    const text = fs.readFileSync(new URL(`../public/${rel}`, import.meta.url), "utf8");
    for (const re of USER_VISIBLE_BLOCKLIST) {
      if (re.test(text)) hits.push(`${rel}: ${re}`);
    }
  }
  assert.equal(hits.length, 0, hits.join("\n"));
});

test("official tagline appears on login", () => {
  const login = fs.readFileSync(new URL("../public/login.html", import.meta.url), "utf8");
  assert.match(login, /The Operating System for Modern Florists/);
  assert.match(login, /Where Your Passion Flowers/);
});

test("sidebar invoices and payments are plain nav buttons without extra wrappers", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const aside = html.match(/<aside>([\s\S]*?)<\/aside>/)?.[1] || "";
  assert.match(aside, /<button data-page="invoicesPage">Invoices<\/button>/);
  assert.match(aside, /<button data-page="paymentsPage">Payment Center<\/button>/);
  assert.doesNotMatch(aside, /class="secondary"[^>]*data-page="invoicesPage"/);
  assert.doesNotMatch(aside, /<div[^>]*>\s*<button data-page="invoicesPage"/);
});

test("founder CSS unifies shell sidebar nav and removes legacy inset ring", () => {
  const css = fs.readFileSync(new URL("../public/florisyn-founder-1.0.css", import.meta.url), "utf8");
  assert.match(css, /\.shell > aside button\[data-page\]/);
  assert.match(css, /box-shadow: inset 3px 0 0 var\(--florisyn-sage/);
  assert.match(css, /button\[data-page\]::after/);
});
