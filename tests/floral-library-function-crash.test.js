/**
 * P0 — Floral Library Netlify function crash regression.
 * Ensures everyday catalog loading never uses fileURLToPath(import.meta.url) + fs
 * (breaks under Netlify esbuild bundling → path receives undefined).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

import { handler as floralLibraryHandler } from "../netlify/functions/floral-library.js";
import { createFloralLibraryAdminHandler } from "../netlify/functions/floral-library-admin.js";
import { getEverydayFloralLibraryCatalog } from "../netlify/functions/_shared/floral-library-everyday-50.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(root, "..");
const bundleOutDir = "/dev/shm/floral-library-bundles";

async function loadEsbuild() {
  try {
    return await import("esbuild");
  } catch {
    return import("/dev/shm/esbuild-wasm/lib/main.js");
  }
}

async function bundleEntry(entry, outfile) {
  mkdirSync(path.dirname(outfile), { recursive: true });
  const esbuild = await loadEsbuild();
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
  });
}

function runSmoke(script) {
  const smoke = spawnSync(process.execPath, ["-e", script], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(smoke.status, 0, smoke.stderr || smoke.stdout);
}

const LOADER_CHAIN = [
  "netlify/functions/_shared/floral-library-everyday-50.js",
  "lib/floral-library/everyday-arrangements.js",
  "netlify/functions/_shared/floral-library-core.js",
  "netlify/functions/floral-library.js",
  "netlify/functions/floral-library-admin.js"
];

const FORBIDDEN_LOADER_PATTERNS = [
  /fileURLToPath\s*\(\s*import\.meta\.url\s*\)/,
  /readFileSync\s*\(/,
  /from\s+["']node:fs["']/,
  /from\s+["']fs["']/
];

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

test("floral library loader chain avoids runtime fs + import.meta.url JSON reads", () => {
  for (const rel of LOADER_CHAIN) {
    const src = stripComments(readFileSync(path.join(repoRoot, rel), "utf8"));
    for (const pattern of FORBIDDEN_LOADER_PATTERNS) {
      assert.equal(
        pattern.test(src),
        false,
        `${rel} must not match ${pattern} (Netlify esbuild unsafe)`
      );
    }
  }
  const loader = stripComments(readFileSync(path.join(repoRoot, "lib/floral-library/everyday-arrangements.js"), "utf8"));
  assert.match(loader, /import\s+batch1\s+from\s+["'].*floral-library-everyday-50\.json["']\s+with\s*\{\s*type:\s*["']json["']\s*\}/);
  assert.match(loader, /import\s+batch2\s+from\s+["'].*floral-library-everyday-batch-2\.json["']\s+with\s*\{\s*type:\s*["']json["']\s*\}/);
});

test("everyday library shared module imports without path crash", () => {
  const catalog = getEverydayFloralLibraryCatalog();
  assert.equal(catalog.length, 100);
  assert.ok(catalog[0]?.id?.startsWith("ed-"));
});

test("floral-library handler GET starter returns products JSON", async () => {
  const res = await floralLibraryHandler({
    httpMethod: "GET",
    queryStringParameters: { action: "starter" },
    headers: {}
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.count, 21);
  assert.ok(Array.isArray(body.products) && body.products.length === 21);
});

test("floral-library-admin handler quality action initializes", async () => {
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
        return { select: async () => ({ data: null, error: null }) };
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
  assert.ok(JSON.parse(res.body).dashboard);
});

test("esbuild bundle of floral-library.js loads and serves starter action", async () => {
  const entry = path.join(repoRoot, "netlify/functions/floral-library.js");
  const outfile = path.join(bundleOutDir, "floral-library.bundle.mjs");
  await bundleEntry(entry, outfile);
  runSmoke(`
    import('file://${outfile}').then(async ({ handler }) => {
      const res = await handler({
        httpMethod: 'GET',
        queryStringParameters: { action: 'starter' },
        headers: {}
      });
      if (res.statusCode !== 200) process.exit(2);
      const body = JSON.parse(res.body);
      if (body.count !== 21) process.exit(3);
    }).catch(() => process.exit(1));
  `);
});

test("esbuild bundle of floral-library-admin.js loads quality dashboard", async () => {
  const entry = path.join(repoRoot, "netlify/functions/floral-library-admin.js");
  const outfile = path.join(bundleOutDir, "floral-library-admin.bundle.mjs");
  await bundleEntry(entry, outfile);
  runSmoke(`
    import('file://${outfile}').then(async ({ createFloralLibraryAdminHandler }) => {
      const adminRow = { user_id: 'test-user', role: 'super_admin', active: true };
      const client = {
        from(table) {
          if (table === 'platform_admins') {
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: adminRow, error: null }) }) }) };
          }
          if (table === 'bloom_floral_library_master') {
            return { select: async () => ({ data: null, error: null }) };
          }
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
        }
      };
      const handler = createFloralLibraryAdminHandler({
        authenticate: async () => ({ user: { id: 'test-user' }, usesServiceRole: false }),
        createServerClient: () => client
      });
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { action: 'quality' }, headers: { authorization: 'Bearer test' } });
      if (res.statusCode !== 200) process.exit(2);
    }).catch(() => process.exit(1));
  `);
});
