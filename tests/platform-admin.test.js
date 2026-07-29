import test from "node:test";
import assert from "node:assert/strict";
import { requireSuperAdmin } from "../netlify/functions/_shared/platform-admin.js";

test("requireSuperAdmin allows super_admin", () => {
  assert.doesNotThrow(() => requireSuperAdmin({ role: "super_admin" }));
});

test("requireSuperAdmin blocks support role", () => {
  assert.throws(() => requireSuperAdmin({ role: "support" }), (err) => {
    assert.equal(err.statusCode, 403);
    return true;
  });
});
