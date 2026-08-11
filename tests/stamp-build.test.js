import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");

test("stamp-build writes deploy id and cache-busts key HTML", () => {
  const stamp = "teststamp1234";
  execFileSync("node", ["scripts/stamp-build.mjs"], {
    cwd: root,
    env: { ...process.env, NETLIFY_DEPLOY_ID: stamp }
  });

  const buildJs = fs.readFileSync(path.join(root, "public/florisyn-build.js"), "utf8");
  assert.match(buildJs, new RegExp(`FLORISYN_BUILD_ID=${JSON.stringify(stamp)}`));

  const versionJs = fs.readFileSync(path.join(root, "public/florisyn-version.js"), "utf8");
  assert.match(versionJs, new RegExp(`build: ${JSON.stringify(stamp)}`));

  const signup = fs.readFileSync(path.join(root, "public/signup.html"), "utf8");
  assert.match(signup, new RegExp(`/pricing\\.js\\?v=${stamp}`));
  assert.match(signup, new RegExp(`/pricing\\.css\\?v=${stamp}`));

  const admin = fs.readFileSync(path.join(root, "public/admin.html"), "utf8");
  assert.match(admin, new RegExp(`/admin\\.js\\?v=${stamp}`));
  assert.match(admin, new RegExp(`/florisyn-version\\.js\\?v=${stamp}`));

  const index = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(index, new RegExp(`/app\\.js\\?v=${stamp}`));
  assert.match(index, new RegExp(`/florisyn-version\\.js\\?v=${stamp}`));
  assert.match(index, new RegExp(`/floral-library-ui\\.js\\?v=${stamp}`));
  assert.match(index, new RegExp(`/floral-library-collection\\.js\\?v=${stamp}`));
  assert.match(index, /florisyn-build\.js\?v=/);
});
