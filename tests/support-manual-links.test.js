/**
 * The Support button is only useful if the PDF it links to actually
 * exists on disk where public/ serves it from — a link to a missing file
 * is exactly the kind of "looks done, isn't" bug this whole session has
 * been about catching. This checks both directions: every Support link
 * in the app points at a real file, and every generated manual PDF is
 * actually linked from somewhere a user would find it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function manualHrefs(html) {
  return [...html.matchAll(/href="(\/manuals\/[a-zA-Z0-9._-]+\.pdf)"/g)].map((m) => m[1]);
}

test("florist app Support link points at a real, generated manual PDF", () => {
  const html = read("public/index.html");
  const hrefs = manualHrefs(html);
  assert.ok(hrefs.includes("/manuals/florisyn-florist-manual.pdf"), "expected a link to the florist manual");
  assert.ok(hrefs.includes("/manuals/florisyn-wholesaler-manual.pdf"), "expected a link to the wholesaler manual on the seller dashboard");
  for (const href of hrefs) {
    const onDisk = path.join(ROOT, "public", href);
    assert.ok(fs.existsSync(onDisk), `${href} is linked but the file does not exist at ${onDisk}`);
  }
});

test("admin console Support link points at a real, generated manual PDF", () => {
  const html = read("public/admin.html");
  const hrefs = manualHrefs(html);
  assert.ok(hrefs.includes("/manuals/florisyn-admin-manual.pdf"), "expected a link to the admin manual");
  for (const href of hrefs) {
    const onDisk = path.join(ROOT, "public", href);
    assert.ok(fs.existsSync(onDisk), `${href} is linked but the file does not exist at ${onDisk}`);
  }
});

test("every manual PDF that exists is linked from at least one app page", () => {
  const manualsDir = path.join(ROOT, "public/manuals");
  const pdfFiles = fs.readdirSync(manualsDir).filter((f) => f.endsWith(".pdf"));
  assert.ok(pdfFiles.length >= 3, "expected at least the florist, admin, and wholesaler manuals");

  const allHtml = read("public/index.html") + read("public/admin.html");
  for (const file of pdfFiles) {
    assert.match(allHtml, new RegExp(`/manuals/${file.replace(/\./g, "\\.")}`), `${file} exists but nothing links to it`);
  }
});

test("each manual PDF is a real, non-empty PDF file, not a stub", () => {
  const manualsDir = path.join(ROOT, "public/manuals");
  for (const file of fs.readdirSync(manualsDir).filter((f) => f.endsWith(".pdf"))) {
    const filePath = path.join(manualsDir, file);
    const header = fs.readFileSync(filePath, { encoding: "latin1", flag: "r" }).slice(0, 5);
    assert.equal(header, "%PDF-", `${file} does not start with a valid PDF header`);
    assert.ok(fs.statSync(filePath).size > 10_000, `${file} is suspiciously small for a real manual`);
  }
});
