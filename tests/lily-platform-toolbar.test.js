import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const js = fs.readFileSync(path.join(root, "public/lily-platform.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/lily-platform.css"), "utf8");

// This toolbar is one shared component across all three assistants
// (Lily/Rose/Daisy switch personas within the same #lilyPanel — there are
// not three separate panels), so a fix here applies uniformly to all three.

test("toolbar button styling no longer relies on uppercase+letter-spacing that caused uneven wrapping", () => {
  const start = css.indexOf(".lily-toolbar button{");
  assert.ok(start >= 0, ".lily-toolbar button rule must exist");
  const block = css.slice(start, css.indexOf("}", start) + 1);
  // Live-measured 2026-08-15: uppercase + .04em letter-spacing widened
  // labels like "Find Customer"/"Facebook Post" enough to wrap onto an
  // uneven second line while shorter labels stayed on one, and rows had
  // inconsistent heights (48.5px vs 44px) as a result.
  assert.match(block, /text-transform:\s*none/, "must not force uppercase");
  assert.match(block, /letter-spacing:\s*normal/, "must not add extra letter-spacing");
  assert.match(block, /min-height:\s*42px/, "every button must share a fixed min-height regardless of 1 vs 2-line wrap");
  assert.match(block, /display:\s*flex/);
  assert.match(block, /align-items:\s*center/);
  assert.match(block, /justify-content:\s*center/);
  assert.match(block, /white-space:\s*normal/, "must allow controlled wrapping, not force a single line that could clip");
});

test("Delivery quick-action exists alongside the original nine toolbar buttons", () => {
  const start = js.indexOf("const TOOLBAR = [");
  const block = js.slice(start, js.indexOf("];", start));
  for (const label of [
    "Create Order",
    "Add Product",
    "Find Customer",
    "Marketplace",
    "Inventory",
    "Reports",
    "Facebook Post",
    "Website",
    "Support",
    "Delivery"
  ]) {
    assert.match(block, new RegExp(`label:\\s*"${label}"`), `${label} must still be a toolbar entry`);
  }
  assert.match(block, /label:\s*"Delivery",\s*action:\s*"deliveryLookup"/);
});

test("Delivery button is wired to a real mileage lookup, not a stub", () => {
  assert.match(js, /function runToolbar\(/);
  const runToolbarStart = js.indexOf("function runToolbar(");
  const runToolbarBody = js.slice(runToolbarStart, js.indexOf("\n  }", runToolbarStart));
  assert.match(runToolbarBody, /item\.action === "deliveryLookup"/);
  assert.match(runToolbarBody, /runDeliveryLookup\(\)/);

  assert.match(js, /async function runDeliveryLookup\(/);
  const fnStart = js.indexOf("async function runDeliveryLookup(");
  const fnBody = js.slice(fnStart, js.indexOf("\n  }", fnStart));
  // Reuses the exact same backend endpoint the order builder's existing
  // "Calculate driving route" feature already calls (shop address as
  // origin, from Settings) — no new API integration, confirmed live
  // against production that GOOGLE_MAPS_API_KEY is already configured.
  assert.match(fnBody, /window\.prompt\(/, "must ask for the destination address");
  assert.match(fnBody, /deps\.api\("route-distance"/);
  assert.match(fnBody, /destination:\s*trimmed/);
  assert.match(fnBody, /d\.configured === false/, "must handle the endpoint's graceful-degrade case, not assume it's always configured");
  assert.match(fnBody, /oneWayMiles/);
  assert.match(fnBody, /roundTripMiles/);
  assert.match(fnBody, /driveMinutes/);
  assert.match(fnBody, /appendMessage\(/, "result must post into the same chat log as everything else, not a separate UI");
});
