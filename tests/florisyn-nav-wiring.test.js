import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const atelier = fs.readFileSync(path.join(root, "public/florisyn-atelier-dashboard.js"), "utf8");

test("app uses document click delegation for data-page and data-open", () => {
  assert.match(app, /__florisynUiNavWired/);
  assert.match(app, /document\.addEventListener\("click"/);
  assert.match(app, /closest\?\.\("\[data-page\]"\)/);
  assert.match(app, /closest\?\.\("\[data-open\]"\)/);
  assert.doesNotMatch(app, /\$\$\("\[data-page\]"\)\.forEach\(b=>b\.onclick/);
  assert.doesNotMatch(app, /\$\$\("\[data-open\]"\)\.forEach\(b=>b\.onclick/);
});

test("showPage activates the target page section and clears exit state", () => {
  assert.match(app, /const target=document\.getElementById\(id\)/);
  assert.match(app, /p\.classList\.remove\("bloom-page-exit"\)/);
  assert.match(app, /p\.hidden=!on/);
  assert.match(app, /\$\$\("\.page"\)\.forEach/);
  assert.match(app, /window\.showPage=showPage/);
});

test("every data-page nav target has a matching .page section", () => {
  const pages = [...html.matchAll(/id="([a-zA-Z]+Page)"/g)].map((m) => m[1]);
  const nav = [...new Set([...html.matchAll(/data-page="([a-zA-Z]+Page)"/g)].map((m) => m[1]))];
  const missing = nav.filter((p) => !pages.includes(p));
  assert.deepEqual(missing, []);
});

test("every data-open target has a matching dialog element", () => {
  const opens = [...new Set([...html.matchAll(/data-open="([^"]+)"/g)].map((m) => m[1]))];
  const missing = opens.filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});

test("atelier drawer closes on nav without reimplementing route handlers", () => {
  assert.match(atelier, /page\/dialog routing is handled by app\.js delegation/);
  assert.doesNotMatch(atelier, /dialog\.showModal\(\)/);
  assert.doesNotMatch(atelier, /window\.showPage\(pageBtn/);
});
