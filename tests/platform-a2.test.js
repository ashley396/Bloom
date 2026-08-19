import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { requireRowShopId } from "../netlify/functions/_shared/shop-scope.js";

test("requireRowShopId rejects cross-shop row", () => {
  assert.throws(
    () => requireRowShopId({ shop_id: "aaa" }, "bbb", "Payment link"),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.match(err.message, /Payment link/i);
      return true;
    }
  );
});

test("requireRowShopId allows matching shop", () => {
  assert.doesNotThrow(() => requireRowShopId({ shop_id: "same" }, "same"));
});

test("requireRowShopId ignores null row", () => {
  assert.doesNotThrow(() => requireRowShopId(null, "shop-1"));
});

test("A2 migration file exists for staff_time_entries RLS", () => {
  const file = path.join(
    process.cwd(),
    "supabase/legacy_migrations/20260729_phase2a_a2_staff_time_entries_rls_v1.sql"
  );
  const sql = fs.readFileSync(file, "utf8");
  assert.match(sql, /staff_time_entries/i);
  assert.match(sql, /is_shop_member\(shop_id\)/i);
});

test("currentUser source uses JWT userClient (A2)", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/_shared/supabase.js"), "utf8");
  assert.match(src, /const client = userClient\(token\)/);
  assert.doesNotMatch(src, /adminClient\s*\?\?\s*userClient/);
});
