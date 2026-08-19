import test from "node:test";
import assert from "node:assert/strict";
import { ageDays, freshness, localDate } from "../netlify/functions/dashboard.js";

/**
 * dashboard.js's "today" boundary (Today's Sales, Orders Due Today, the
 * weekly sales chart, and inventory freshness/age scoring) used to be
 * computed via the server's raw UTC clock, ignoring shops.timezone
 * entirely — wrong for hours every evening in any US timezone. It's now
 * threaded through as an explicit todayStr param (from
 * shopDateStr(shop.timezone), see shop-time.test.js), so these pure
 * functions can be tested without depending on the real wall clock at
 * all — the exact "today" a test run happens to execute on can't make
 * these pass or fail by accident.
 */

test("ageDays counts whole days between an arrival date and the shop's today, independent of real wall-clock time", () => {
  assert.equal(ageDays("2026-08-15", "2026-08-20"), 5);
  assert.equal(ageDays("2026-08-20", "2026-08-20"), 0);
  assert.equal(ageDays(null, "2026-08-20"), 0);
  // Never negative even if arrival is somehow after "today".
  assert.equal(ageDays("2026-08-25", "2026-08-20"), 0);
});

test("ageDays is unaffected by which timezone todayStr itself came from — it only ever sees the Y-M-D string", () => {
  // Same two calendar dates, whether shopDateStr computed "2026-08-20" for
  // an Eastern shop or a Pacific one — ageDays just diffs the strings.
  assert.equal(ageDays("2026-08-17", "2026-08-20"), 3);
});

test("freshness scores full marks on arrival day and decays toward the vase life limit", () => {
  const today = "2026-08-20";
  assert.equal(freshness({ arrival_date: "2026-08-20", vase_life_days: 10 }, today), 100);
  assert.equal(freshness({ arrival_date: "2026-08-15", vase_life_days: 10 }, today), 50);
  assert.equal(freshness({ arrival_date: "2026-08-10", vase_life_days: 10 }, today), 0);
});

test("localDate slices a stored value's date portion without ever routing it through new Date() (no misparse risk)", () => {
  assert.equal(localDate("2026-08-20"), "2026-08-20");
  assert.equal(localDate("2026-08-20T14:32:00.000Z"), "2026-08-20");
  assert.equal(localDate(null), "");
});
