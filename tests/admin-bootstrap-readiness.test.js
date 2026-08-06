import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../netlify/functions/admin-bootstrap.js", import.meta.url), "utf8");

test("admin bootstrap checks owner state with a normal service-role select", () => {
  assert.match(src, /\.from\("platform_admins"\)\s*\.select\("user_id"\)\s*\.limit\(1\)/s);
  assert.doesNotMatch(src, /head:\s*true/);
});

test("admin bootstrap returns a specific setup-unavailable error", () => {
  assert.match(src, /admin_bootstrap_setup_unavailable/);
  assert.match(src, /cannot verify the admin database yet/i);
});
