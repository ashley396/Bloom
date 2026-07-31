import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_GUIDELINES,
  COMMUNITY_SIGNED_URL_SECONDS,
  validateProfileBody,
  validatePostBody,
  validateCommentBody,
  validateReportBody,
  validateCommunityImageUpload,
  detectImageMimeFromBytes,
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

test("COMMUNITY_BETA flag defaults OFF; only explicit true enables", () => {
  const flags = getFeatureFlags({});
  assert.equal(flags.COMMUNITY_BETA, false);
  assert.equal(isFeatureEnabled("COMMUNITY_BETA", {}), false);
  assert.equal(isFeatureEnabled("COMMUNITY_BETA", { FLORISYN_FLAG_COMMUNITY_BETA: "" }), false);
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

test("signed URL lifetime is documented and short", () => {
  assert.equal(COMMUNITY_SIGNED_URL_SECONDS, 300);
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

test("image validation accepts real JPEG/PNG/WebP fixtures and rejects corrupt/truncated", () => {
  const fixtures = path.join(process.cwd(), "tests/fixtures/community-images");
  const png = fs.readFileSync(path.join(fixtures, "valid-1x1.png"));
  const jpg = fs.readFileSync(path.join(fixtures, "valid-1x1.jpg"));
  const webp = fs.readFileSync(path.join(fixtures, "valid-1x1.webp"));
  const truncJpg = fs.readFileSync(path.join(fixtures, "corrupt-truncated.jpg"));
  const truncPng = fs.readFileSync(path.join(fixtures, "corrupt-truncated.png"));
  const truncWebp = fs.readFileSync(path.join(fixtures, "corrupt-truncated.webp"));
  const pngAsJpeg = fs.readFileSync(path.join(fixtures, "png-bytes-as-jpeg.bin"));

  assert.equal(validateCommunityImageUpload({ buffer: png, mime: "image/png" }).valid, true);
  assert.equal(validateCommunityImageUpload({ buffer: jpg, mime: "image/jpeg" }).valid, true);
  assert.equal(validateCommunityImageUpload({ buffer: webp, mime: "image/webp" }).valid, true);

  const ok = validateCommunityImageUpload({ dataUrl: tinyPng });
  assert.equal(ok.valid, true);
  assert.equal(ok.mime, "image/png");
  assert.equal(ok.width, 1);
  assert.equal(ok.height, 1);

  const gif = validateCommunityImageUpload({
    dataUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  });
  assert.equal(gif.valid, false);

  assert.equal(detectImageMimeFromBytes(Buffer.from("not-an-image-file-content!!!!!!!!!!")), null);
  assert.equal(validateCommunityImageUpload({ buffer: truncJpg, mime: "image/jpeg" }).valid, false);
  assert.equal(validateCommunityImageUpload({ buffer: truncPng, mime: "image/png" }).valid, false);
  assert.equal(validateCommunityImageUpload({ buffer: truncWebp, mime: "image/webp" }).valid, false);
  assert.equal(
    validateCommunityImageUpload({ buffer: pngAsJpeg, mime: "image/jpeg" }).valid,
    false,
    "declared MIME must match magic bytes"
  );

  assert.equal(
    validateCommunityImageUpload({
      buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(3 * 1024 * 1024)]),
    }).valid,
    false
  );
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
  const clean = publicPost(dirty, { liked: true, isMine: true, imageUrl: "https://signed.example/x" });
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

test("community image path is shop/user scoped; public URL helper disabled", () => {
  const p = communityImagePath(
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
    "image/jpeg"
  );
  assert.match(
    p,
    /^11111111-1111-1111-1111-111111111111\/22222222-2222-2222-2222-222222222222\/.+\.jpg$/
  );
  assert.equal(communityImagePublicUrl("https://abc.supabase.co", p), null);
});

test("florist-community function enforces flag, membership, signed URLs, RPCs", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/florist-community.js"), "utf8");
  assert.match(src, /isFeatureEnabled\("COMMUNITY_BETA"\)/);
  assert.match(src, /requireActiveFlorist/);
  assert.match(src, /resolveCommunityAccess/);
  assert.match(src, /is_platform_admin_user/);
  assert.match(src, /florist_community_image_readable/);
  assert.match(src, /florist_community_moderate_report/);
  assert.match(src, /florist_community_moderate_comment/);
  assert.match(src, /createSignedUrl/);
  assert.match(src, /COMMUNITY_SIGNED_URL_SECONDS|image_signed_url_seconds/);
  assert.match(src, /florist_community_toggle_like/);
  assert.match(src, /florist_community_report_post/);
  assert.match(src, /florist_community_moderate_post/);
  assert.match(src, /validateCommunityImageUpload/);
  assert.doesNotMatch(src, /\.from\("platform_admins"\)/);
  assert.doesNotMatch(src, /object\/public\/florist-community/);
  assert.doesNotMatch(src, /\.from\("orders"\)/);
  assert.doesNotMatch(src, /\.from\("customers"\)/);
  assert.doesNotMatch(src, /\.from\("staff"\)/);
  assert.doesNotMatch(src, /\.from\("payments"\)/);
  assert.doesNotMatch(src, /florist_community_adjust_like_count/);
  assert.doesNotMatch(src, /catch\s*\{\s*\/\* helper may be unavailable/);
});

test("community R1/R2 migration hardens membership, private storage, narrow moderation", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260731_florist_community_beta_v1_r1_security.sql"),
    "utf8"
  );
  assert.match(sql, /is_active_florist/);
  assert.match(sql, /is_active_member_of/);
  assert.match(sql, /sm\.status = 'active'/);
  assert.doesNotMatch(sql, /coalesce\s*\(\s*sm\.status/i);
  assert.match(sql, /public\s*=\s*false/);
  assert.match(sql, /florist_community_toggle_like/);
  assert.match(sql, /on conflict \(post_id, reporter_user_id\) do nothing/);
  assert.match(sql, /florist_community_moderate_comment/);
  assert.match(sql, /florist_community_moderate_report/);
  assert.match(sql, /florisyn_internal/);
  assert.match(sql, /drop policy if exists "community posts update moderator"/);
  assert.match(sql, /drop policy if exists "community posts update author content"/);
  assert.match(sql, /revoke all on table public\.florist_community_posts from anon/);
  assert.match(sql, /shop_members_active_user_idx/);
  assert.doesNotMatch(sql, /staff_time_entries/);
});

test("community UI hides nav when disabled and keeps loading/empty/error states", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");
  assert.match(html, /id="communityPage"/);
  assert.match(html, /community-ui\.js/);
  assert.match(html, /data-page="communityPage"[^>]*hidden/);
  const app = fs.readFileSync(path.join(process.cwd(), "public/app.js"), "utf8");
  assert.match(app, /refreshCommunityFeatureFlag|setCommunityNavVisible/);
  assert.match(app, /COMMUNITY_BETA/);
  assert.match(app, /communityBetaEnabled/);
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
