/**
 * Local smoke checks for Florist Community Beta security correction R1.
 * Run: npm run test:community-smoke
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  validatePostBody,
  validateCommunityImageUpload,
  detectImageMimeFromBytes,
  canEditOwnContent,
  publicPost,
  COMMUNITY_CATEGORIES,
  COMMUNITY_SIGNED_URL_SECONDS,
  communityImagePublicUrl,
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

check("feature flag defaults OFF", () => {
  assert.equal(isFeatureEnabled("COMMUNITY_BETA", {}), false);
});

check("feature flag enables only with explicit true", () => {
  assert.equal(isFeatureEnabled("COMMUNITY_BETA", { FLORISYN_FLAG_COMMUNITY_BETA: "true" }), true);
  assert.equal(isFeatureEnabled("COMMUNITY_BETA", { FLORISYN_FLAG_COMMUNITY_BETA: "false" }), false);
});

check("SPA wiring + nav hidden by default", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /communityPage/);
  assert.match(html, /hidden/);
  const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(app, /refreshCommunityFeatureFlag/);
  assert.match(app, /loadCommunityPage/);
});

check("two-shop ownership: only author edits", () => {
  assert.equal(canEditOwnContent({ userId: "user-a", authorUserId: "user-a" }), true);
  assert.equal(canEditOwnContent({ userId: "user-b", authorUserId: "user-a" }), false);
});

check("moderation requires shop match in API", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/florist-community.js"), "utf8");
  assert.match(src, /post\.shop_id === ctx\.shopId/);
  assert.match(src, /requireActiveFlorist/);
  assert.match(src, /createSignedUrl/);
});

check("create post validation for each category", () => {
  for (const category of COMMUNITY_CATEGORIES) {
    const v = validatePostBody({ category, caption: `${category} tip` });
    assert.equal(v.valid, true, category);
  }
});

check("magic-byte image validation", () => {
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  assert.equal(validateCommunityImageUpload({ dataUrl: png }).valid, true);
  assert.equal(detectImageMimeFromBytes(Buffer.from("GIF89a......")), null);
  assert.equal(validateCommunityImageUpload({ mime: "image/gif", sizeBytes: 100 }).valid, false);
});

check("no permanent public image URLs", () => {
  assert.equal(communityImagePublicUrl("https://x.supabase.co", "a/b/c.jpg"), null);
  assert.equal(COMMUNITY_SIGNED_URL_SECONDS, 300);
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
    author: {
      user_id: "a",
      shop_id: "shop-a",
      display_name: "A",
      shop_display_name: "Shop A",
      pin_hash: "x",
    },
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

check("R1 security migration present; Staff A2 not bundled", () => {
  assert.ok(fs.existsSync(path.join(root, "supabase/migrations/20260731_florist_community_beta_v1.sql")));
  assert.ok(
    fs.existsSync(path.join(root, "supabase/migrations/20260731_florist_community_beta_v1_r1_security.sql"))
  );
  const r1 = fs.readFileSync(
    path.join(root, "supabase/migrations/20260731_florist_community_beta_v1_r1_security.sql"),
    "utf8"
  );
  assert.doesNotMatch(r1, /staff_time_entries/);
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
Live env notes (still required on approved staging):
- Enable FLORISYN_FLAG_COMMUNITY_BETA=true only for approved environments
- Owner/admin, normal florist, second shop, Stripe test, mobile viewport
`);
process.exit(0);
