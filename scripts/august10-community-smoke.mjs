/**
 * Local smoke checks for Florist Community Beta (no production deploy).
 * Run: node scripts/august10-community-smoke.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  validatePostBody,
  validateCommunityImageUpload,
  canEditOwnContent,
  publicPost,
  assertCommunitySafePayload,
  COMMUNITY_CATEGORIES,
} from "../netlify/functions/_shared/florist-community.js";
import { isFeatureEnabled } from "../netlify/functions/_shared/feature-flags.js";

const root = process.cwd();
const results = [];

function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.error(`FAIL  ${name}: ${e.message}`);
  }
}

check("feature flag enabled by default", () => {
  assert.equal(isFeatureEnabled("COMMUNITY_BETA", {}), true);
});

check("emergency disable via env", () => {
  assert.equal(isFeatureEnabled("COMMUNITY_BETA", { FLORISYN_FLAG_COMMUNITY_BETA: "false" }), false);
});

check("SPA wiring", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /communityPage/);
  assert.match(html, /community-ui\.js/);
  const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(app, /loadCommunityPage/);
});

check("mobile more-menu includes community", () => {
  const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(app, /community:"communityPage"/);
});

check("two-shop ownership: only author edits", () => {
  const shopAUser = "user-a";
  const shopBUser = "user-b";
  assert.equal(canEditOwnContent({ userId: shopAUser, authorUserId: shopAUser }), true);
  assert.equal(canEditOwnContent({ userId: shopBUser, authorUserId: shopAUser }), false);
});

check("shop B moderator cannot moderate shop A post (API rule)", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/florist-community.js"), "utf8");
  assert.match(src, /post\.shop_id === ctx\.shopId/);
  assert.match(src, /Moderation requires a shop manager/);
});

check("create post validation for each category", () => {
  for (const category of COMMUNITY_CATEGORIES) {
    const v = validatePostBody({ category, caption: `${category} tip` });
    assert.equal(v.valid, true, category);
  }
});

check("image type/size validation", () => {
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  assert.equal(validateCommunityImageUpload({ dataUrl: png }).valid, true);
  assert.equal(validateCommunityImageUpload({ mime: "image/gif", sizeBytes: 100 }).valid, false);
});

check("payload never leaks order/customer/staff fields", () => {
  const post = publicPost({
    id: "1",
    category: "Questions",
    caption: "Hello",
    author_user_id: "a",
    shop_id: "shop-a",
    status: "active",
    like_count: 0,
    comment_count: 0,
    customer_name: "LEAK",
    order_id: "LEAK",
    author: { user_id: "a", shop_id: "shop-a", display_name: "A", shop_display_name: "Shop A", pin_hash: "x" },
  });
  const json = JSON.stringify(post);
  assert.doesNotMatch(json, /LEAK|pin_hash/);
});

check("no service role key in frontend community files", () => {
  for (const f of ["public/community-ui.js", "public/app.js", "public/index.html"]) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    assert.doesNotMatch(src, /SERVICE_ROLE|sk_live_|sk_test_/);
  }
});

check("UI has loading, empty, error states", () => {
  const ui = fs.readFileSync(path.join(root, "public/community-ui.js"), "utf8");
  assert.match(ui, /community-loading/);
  assert.match(ui, /community-empty/);
  assert.match(ui, /community-error/);
});

check("migration file present", () => {
  assert.ok(fs.existsSync(path.join(root, "supabase/migrations/20260731_florist_community_beta_v1.sql")));
  assert.ok(fs.existsSync(path.join(root, "supabase/migrations/20260729_phase2a_a2_staff_time_entries_rls_v1.sql")));
});

check("core modules still present (no rewrite)", () => {
  for (const f of [
    "netlify/functions/orders.js",
    "netlify/functions/customers.js",
    "netlify/functions/create-checkout.js",
    "netlify/functions/staff.js",
    "netlify/functions/inventory.js",
    "netlify/functions/instant-website.js",
    "netlify/functions/dashboard.js",
  ]) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});

const failed = results.filter((r) => !r.ok);
console.log("\n--- Smoke summary ---");
console.log(`Passed: ${results.length - failed.length}/${results.length}`);
if (failed.length) {
  console.error("Failed:", failed.map((f) => f.name).join(", "));
  process.exit(1);
}

console.log(`
Live env notes (not run in this sandbox):
- Owner/admin account: open Community, moderate hide/remove
- Normal florist: create post, comment, like
- Second shop: see feed, cannot edit/delete other shop posts
- Stripe test mode: existing checkout path unchanged
- Mobile viewport: Community CSS @media 760px + More menu "community"
`);
process.exit(0);
