/**
 * Local smoke checks for Florist Community Beta security correction R3.
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

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.error(`FAIL  ${name}: ${e.message}`);
  }
}

await check("feature flag defaults OFF", () => {
  assert.equal(isFeatureEnabled("COMMUNITY_BETA", {}), false);
});

await check("feature flag enables only with explicit true", () => {
  assert.equal(isFeatureEnabled("COMMUNITY_BETA", { FLORISYN_FLAG_COMMUNITY_BETA: "true" }), true);
  assert.equal(isFeatureEnabled("COMMUNITY_BETA", { FLORISYN_FLAG_COMMUNITY_BETA: "false" }), false);
});

await check("SPA wiring + nav hidden by default", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /communityPage/);
  assert.match(html, /hidden/);
  const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(app, /refreshCommunityFeatureFlag/);
  assert.match(app, /loadCommunityPage/);
});

await check("two-shop ownership: only author edits", () => {
  assert.equal(canEditOwnContent({ userId: "user-a", authorUserId: "user-a" }), true);
  assert.equal(canEditOwnContent({ userId: "user-b", authorUserId: "user-a" }), false);
});

await check("moderation requires shop match in API; create_post uses moderatorForPost", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/florist-community.js"), "utf8");
  assert.match(src, /post\.shop_id === ctx\.shopId/);
  assert.match(src, /requireActiveFlorist/);
  assert.match(src, /createSignedUrl/);
  assert.match(src, /moderatorForPost\(ctx, data, platformAdmin\)/);
  assert.doesNotMatch(src, /canModerate:\s*true/);
});

await check("create post validation for each category", async () => {
  for (const category of COMMUNITY_CATEGORIES) {
    const v = await validatePostBody({ category, caption: `${category} tip` });
    assert.equal(v.valid, true, category);
  }
});

await check("sharp decode/re-encode + corrupt rejection", async () => {
  const fixtures = path.join(root, "tests/fixtures/community-images");
  assert.equal(
    (
      await validateCommunityImageUpload({
        buffer: fs.readFileSync(path.join(fixtures, "valid-1x1.png")),
        mime: "image/png",
      })
    ).valid,
    true
  );
  assert.equal(
    (
      await validateCommunityImageUpload({
        buffer: fs.readFileSync(path.join(fixtures, "corrupt-short-jpg.bin")),
        mime: "image/jpeg",
      })
    ).valid,
    false
  );
  assert.equal(detectImageMimeFromBytes(Buffer.from("GIF89a......")), null);
  assert.equal((await validateCommunityImageUpload({ mime: "image/gif", sizeBytes: 100 })).valid, false);
});

await check("no permanent public image URLs", () => {
  assert.equal(communityImagePublicUrl("https://x.supabase.co", "a/b/c.jpg"), null);
  assert.equal(COMMUNITY_SIGNED_URL_SECONDS, 300);
});

await check("payload never leaks order/customer/staff fields", () => {
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

await check("no service role key in frontend community files", () => {
  for (const f of ["public/community-ui.js", "public/app.js", "public/index.html"]) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    assert.doesNotMatch(src, /SERVICE_ROLE|sk_live_|sk_test_/);
  }
});

await check("UI has loading, empty, error states", () => {
  const ui = fs.readFileSync(path.join(root, "public/community-ui.js"), "utf8");
  assert.match(ui, /community-loading/);
  assert.match(ui, /community-empty/);
  assert.match(ui, /community-error/);
});

await check("R6 security migrations present; Staff A2 not bundled; v1 locked", () => {
  assert.ok(fs.existsSync(path.join(root, "supabase/migrations/20260731_florist_community_beta_v1.sql")));
  assert.ok(
    fs.existsSync(path.join(root, "supabase/migrations/20260731_florist_community_beta_v1_r1_security.sql"))
  );
  assert.ok(fs.existsSync(path.join(root, "netlify/functions/_shared/florist-community-storage.js")));
  const v1 = fs.readFileSync(path.join(root, "supabase/migrations/20260731_florist_community_beta_v1.sql"), "utf8");
  const r1 = fs.readFileSync(
    path.join(root, "supabase/migrations/20260731_florist_community_beta_v1_r1_security.sql"),
    "utf8"
  );
  const handler = fs.readFileSync(path.join(root, "netlify/functions/florist-community.js"), "utf8");
  const storage = fs.readFileSync(
    path.join(root, "netlify/functions/_shared/florist-community-storage.js"),
    "utf8"
  );
  assert.match(v1, /LOCKED/);
  assert.match(v1, /public\s*=\s*false/);
  assert.doesNotMatch(r1, /staff_time_entries/);
  assert.doesNotMatch(r1, /coalesce\s*\(\s*sm\.status/i);
  assert.doesNotMatch(r1, /exception\s+when others then/i);
  assert.match(r1, /florist_community_moderate_report/);
  assert.match(r1, /found_statuses is distinct from expected_statuses/);
  assert.doesNotMatch(r1, /check_def !~\* 'active'/);
  assert.match(handler, /uploadPrevalidatedCommunityImage\(client, shopId, user\.id, v\.image\)/);
  assert.match(handler, /reconcileCommunityImageAfterWriteError\(client, uploadedPath\)/);
  assert.doesNotMatch(handler, /validateCommunityImageUpload/);
  assert.doesNotMatch(storage, /from ["']sharp["']/);
  assert.match(storage, /reconcileCommunityImageAfterWriteError/);
});

await check("core modules still present (no rewrite)", () => {
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
