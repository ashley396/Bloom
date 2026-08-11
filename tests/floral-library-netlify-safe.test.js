import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { handler as floralLibraryHandler } from "../netlify/functions/floral-library.js";
import { createFloralLibraryAdminHandler } from "../netlify/functions/floral-library-admin.js";
import {
  getEverydayFloralLibraryCatalog,
  getPublicFloralLibraryCatalog
} from "../netlify/functions/_shared/floral-library-core.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "../public");

function fileSha256(relativeFromPublic) {
  const filePath = path.join(publicDir, relativeFromPublic);
  const buf = readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

test("everyday library module imports without fs/path crash", () => {
  const catalog = getEverydayFloralLibraryCatalog();
  assert.equal(catalog.length, 100);
  assert.ok(catalog.every((p) => p.primary_image?.url));
});

test("public floral library catalog returns 100 starter products", () => {
  const catalog = getPublicFloralLibraryCatalog();
  assert.equal(catalog.length, 100);
  const names = new Set(catalog.map((p) => p.name));
  assert.equal(names.size, 100);
});

test("floral-library handler GET starter returns valid JSON products", async () => {
  const res = await floralLibraryHandler({
    httpMethod: "GET",
    queryStringParameters: { action: "starter" },
    headers: {}
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.count, 100);
  assert.ok(Array.isArray(body.products));
  assert.ok(body.products.every((p) => p.id && p.name && p.primary_image?.url));
});

test("floral-library-admin handler quality dashboard initializes", async () => {
  const adminRow = { user_id: "test-user", role: "super_admin", active: true };
  const client = {
    from(table) {
      if (table === "platform_admins") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: adminRow, error: null })
            })
          })
        };
      }
      if (table === "bloom_floral_library_master") {
        return {
          select: async () => ({ data: null, error: null })
        };
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) })
        })
      };
    }
  };
  const handler = createFloralLibraryAdminHandler({
    authenticate: async () => ({ user: { id: "test-user" }, usesServiceRole: false }),
    createServerClient: () => client
  });
  const res = await handler({
    httpMethod: "GET",
    queryStringParameters: { action: "quality" },
    headers: { authorization: "Bearer test" }
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.dashboard);
  assert.ok(body.dashboard.total >= 100);
});

test("featured everyday arrangements have unique image file hashes", () => {
  const catalog = getEverydayFloralLibraryCatalog();
  const hashes = new Map();
  for (const p of catalog) {
    const url = p.primary_image.url.replace(/^\//, "");
    assert.ok(existsSync(path.join(publicDir, url)), `missing image ${url}`);
    const hash = fileSha256(url);
    if (hashes.has(hash)) {
      assert.fail(`duplicate image hash ${hash} for ${p.id} and ${hashes.get(hash)}`);
    }
    hashes.set(hash, p.id);
    assert.notEqual(p.metadata?.needs_image_replacement, true, `${p.id} still needs replacement`);
  }
  assert.equal(hashes.size, catalog.length);
});

test("ultra-realistic metadata is backed by unique image content", () => {
  const catalog = getEverydayFloralLibraryCatalog();
  const urlHashes = new Set();
  const contentHashes = new Set();
  for (const p of catalog) {
    assert.equal(p.metadata?.image_standard, "ultra_realistic_professional_floral_photography");
    assert.ok(p.primary_image.url, `${p.id} missing url`);
    assert.ok(p.primary_image.hash, `${p.id} missing content hash`);
    urlHashes.add(p.primary_image.url);
    const rel = p.primary_image.url.replace(/^\//, "");
    contentHashes.add(fileSha256(rel));
  }
  assert.equal(urlHashes.size, catalog.length, "duplicate image URLs in featured catalog");
  assert.equal(contentHashes.size, catalog.length, "duplicate image blobs despite unique URLs");
});

test("no duplicate filenames or hashes in JSON batches", () => {
  const batchFiles = [
    "data/floral-library-everyday-50.json",
    "data/floral-library-everyday-batch-2.json"
  ];
  const imagePaths = [];
  const shaFromJson = [];
  for (const rel of batchFiles) {
    const data = JSON.parse(readFileSync(path.join(publicDir, rel), "utf8"));
    for (const a of data.arrangements || []) {
      imagePaths.push(a.image);
      if (a.content_sha256) shaFromJson.push(a.content_sha256);
      assert.ok(a.pexels_photo_id, `${a.id} missing pexels_photo_id`);
    }
  }
  assert.equal(new Set(imagePaths).size, imagePaths.length);
  assert.equal(new Set(shaFromJson).size, shaFromJson.length);
});
