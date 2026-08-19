import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Found via a visual audit against a mocked/empty backend response (the
 * same shape a real thin/incomplete API response can take): three spots
 * that read a property off possibly-undefined data with no guard, so the
 * raw JS TypeError text ("Cannot read properties of undefined...") ends
 * up shown directly to a florist or admin instead of a friendly message.
 */
const referralHub = fs.readFileSync(path.join(process.cwd(), "public/referral-hub.js"), "utf8");
const adminJs = fs.readFileSync(path.join(process.cwd(), "public/admin.js"), "utf8");

test("referral-hub.js never shows a raw exception message to the florist", () => {
  assert.doesNotMatch(referralHub, /root\.innerHTML = `<p class="subtle">\$\{esc\(e\.message\)\}<\/p>`/);
  assert.match(referralHub, /Referral program is temporarily unavailable/);
});

test("referral-hub.js guards against a reward/share-less response before reading d.reward.label", () => {
  assert.match(referralHub, /if \(!d\?\.reward \|\| !d\?\.share\)/);
});

test("admin.js loadOverview() defaults d.metrics before reading its properties", () => {
  const start = adminJs.indexOf("async function loadOverview(){");
  const end = adminJs.indexOf("async function loadShops(){");
  assert.ok(start > -1 && end > start, "expected to find loadOverview() before loadShops()");
  const body = adminJs.slice(start, end);
  assert.match(body, /const metrics=d\.metrics\|\|\{\}/);
  assert.doesNotMatch(body, /d\.metrics\.shops/);
});

test("admin.js loadShops() defaults d.shops before reading .length", () => {
  const start = adminJs.indexOf("async function loadShops(){");
  assert.ok(start > -1, "expected to find loadShops()");
  const body = adminJs.slice(start, start + 800);
  assert.match(body, /const shops=d\.shops\|\|\[\]/);
  // The actual code (not this file's own explanatory comment above it)
  // must read the defaulted local, not the raw, possibly-undefined d.shops.
  const code = body.slice(body.indexOf("const shops="));
  assert.doesNotMatch(code, /\bd\.shops\.length/);
});
