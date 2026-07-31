import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_GUIDELINES,
  validateProfileBody,
  validatePostBody,
  validateCommentBody,
  validateReportBody,
  validateCommunityImageUpload,
  canEditOwnContent,
  publicPost,
  publicProfile,
  assertCommunitySafePayload,
  communityImagePath,
  communityImagePublicUrl,
} from "../netlify/functions/_shared/florist-community.js";
import { getFeatureFlags, isFeatureEnabled } from "../netlify/functions/_shared/feature-flags.js";

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("COMMUNITY_BETA flag defaults true and can be disabled via env", () => {
  const flags = getFeatureFlags({});
  assert.equal(flags.COMMUNITY_BETA, true);
  assert.equal(isFeatureEnabled("COMMUNITY_BETA", { FLORISYN_FLAG_COMMUNITY_BETA: "false" }), false);
  assert.equal(isFeatureEnabled("COMMUNITY_BETA", { FLORISYN_FLAG_COMMUNITY_BETA: "true" }), true);
});

test("community categories match product requirements", () => {
  assert.deepEqual(COMMUNITY_CATEGORIES, [
    "Design Help",
    "Business Advice",
    "Questions",
    "Celebrations",
  ]);
});

test("community guidelines are present for beta UX", () => {
  assert.ok(COMMUNITY_GUIDELINES.length >= 4);
  assert.ok(COMMUNITY_GUIDELINES.some((g) => /customer/i.test(g)));
});

test("profile validation requires display and shop names", () => {
  assert.equal(validateProfileBody({}).valid, false);
  const ok = validateProfileBody({
    display_name: "Maya",
    shop_display_name: "Bloom & Stem",
    city: "Austin",
    bio: "Wedding specialist",
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.sanitized.display_name, "Maya");
});

test("post validation requires category and caption", () => {
  assert.equal(validatePostBody({ caption: "Hi" }).valid, false);
  const ok = validatePostBody({
    category: "Design Help",
    caption: "Hydrangea tip",
    body: "Condition overnight.",
  });
  assert.equal(ok.valid, true);
});

test("post image must be jpeg/png/webp under 2MB", () => {
  const ok = validateCommunityImageUpload({ dataUrl: tinyPng });
  assert.equal(ok.valid, true);
  assert.equal(ok.mime, "image/png");

  const bad = validateCommunityImageUpload({
    dataUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  });
  assert.equal(bad.valid, false);

  const huge = validateCommunityImageUpload({
    mime: "image/jpeg",
    sizeBytes: 3 * 1024 * 1024,
  });
  assert.equal(huge.valid, false);
});

test("comments and reports validate length", () => {
  assert.equal(validateCommentBody({ body: "" }).valid, false);
  assert.equal(validateCommentBody({ body: "Beautiful work!" }).valid, true);
  assert.equal(validateReportBody({ reason: "no" }).valid, false);
  assert.equal(validateReportBody({ reason: "Spam promotion" }).valid, true);
});

test("users may edit only their own content", () => {
  assert.equal(canEditOwnContent({ userId: "a", authorUserId: "a" }), true);
  assert.equal(canEditOwnContent({ userId: "a", authorUserId: "b" }), false);
});

test("public post payload never includes customer or payment fields", () => {
  const dirty = {
    id: "p1",
    category: "Questions",
    caption: "Need advice",
    body: "How do you price sympathy?",
    author_user_id: "u1",
    shop_id: "s1",
    like_count: 2,
    comment_count: 1,
    status: "active",
    created_at: "2026-07-31T00:00:00Z",
    customer_name: "SECRET",
    order_number: "ORD-1",
    payment_status: "PAID",
    author: {
      user_id: "u1",
      shop_id: "s1",
      display_name: "Maya",
      shop_display_name: "Bloom & Stem",
      customer_phone: "555",
      hourly_rate: 20,
    },
  };
  const clean = publicPost(dirty, { liked: true, isMine: true, imageUrl: "https://example.com/x.jpg" });
  assert.equal(clean.caption, "Need advice");
  assert.equal(clean.liked, true);
  assert.equal(clean.author.display_name, "Maya");
  assert.equal("customer_name" in clean, false);
  assert.equal("order_number" in clean, false);
  assert.equal("payment_status" in clean, false);
  assert.equal("customer_phone" in clean.author, false);
  assert.equal("hourly_rate" in clean.author, false);
});

test("assertCommunitySafePayload strips forbidden keys deeply", () => {
  const obj = {
    ok: true,
    nested: { recipient_name: "X", caption: "safe" },
    pin_hash: "nope",
  };
  assertCommunitySafePayload(obj);
  assert.equal(obj.nested.caption, "safe");
  assert.equal("recipient_name" in obj.nested, false);
  assert.equal("pin_hash" in obj, false);
});

test("community image path is shop/user scoped", () => {
  const p = communityImagePath("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "image/jpeg");
  assert.match(p, /^11111111-1111-1111-1111-111111111111\/22222222-2222-2222-2222-222222222222\/.+\.jpg$/);
  const url = communityImagePublicUrl("https://abc.supabase.co", p);
  assert.match(url, /^https:\/\/abc\.supabase\.co\/storage\/v1\/object\/public\/florist-community\//);
});

test("florist-community function enforces feature flag and auth patterns", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/florist-community.js"), "utf8");
  assert.match(src, /isFeatureEnabled\("COMMUNITY_BETA"\)/);
  assert.match(src, /currentUser\(event\)/);
  assert.match(src, /author_user_id/);
  assert.match(src, /moderate_hide|moderate_remove/);
  assert.match(src, /validateCommunityImageUpload|uploadCommunityImage/);
  assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE_KEY/);
  // Must not query sensitive shop tables for community feed
  assert.doesNotMatch(src, /\.from\("orders"\)/);
  assert.doesNotMatch(src, /\.from\("customers"\)/);
  assert.doesNotMatch(src, /\.from\("staff"\)/);
  assert.doesNotMatch(src, /\.from\("payments"\)/);
});

test("community migration enables RLS and storage policies", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260731_florist_community_beta_v1.sql"),
    "utf8"
  );
  assert.match(sql, /florist_community_posts/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /is_platform_admin_user/);
  assert.match(sql, /is_shop_manager_of/);
  assert.match(sql, /florist-community/);
  assert.match(sql, /author_user_id = auth\.uid\(\)/);
  assert.match(sql, /file_size_limit/);
});

test("community UI and nav are wired in SPA shell", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");
  assert.match(html, /id="communityPage"/);
  assert.match(html, /community-ui\.js/);
  assert.match(html, /community\.css/);
  assert.match(html, /data-page="communityPage"/);
  const app = fs.readFileSync(path.join(process.cwd(), "public/app.js"), "utf8");
  assert.match(app, /loadCommunityPage/);
  assert.match(app, /communityPage:loadCommunityPage/);
  const ui = fs.readFileSync(path.join(process.cwd(), "public/community-ui.js"), "utf8");
  assert.match(ui, /BloomCommunity/);
  assert.match(ui, /community-loading|Loading Florist Community/);
  assert.match(ui, /community-empty|No posts yet/);
  assert.match(ui, /community-error|Something went wrong/);
});

test("publicProfile omits employee and payment fields", () => {
  const p = publicProfile({
    user_id: "u",
    shop_id: "s",
    display_name: "A",
    shop_display_name: "Shop",
    hourly_rate: 99,
    pin_hash: "x",
  });
  assert.equal(p.display_name, "A");
  assert.equal("hourly_rate" in p, false);
  assert.equal("pin_hash" in p, false);
});
