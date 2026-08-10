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
  parseDataUrl,
  maxBase64LengthForBytes,
  COMMUNITY_IMAGE_MAX_BYTES,
  canEditOwnContent,
  canModerateCommunity,
  publicPost,
  publicProfile,
  assertCommunitySafePayload,
  communityImagePath,
  communityImagePublicUrl,
} from "../netlify/functions/_shared/florist-community.js";
import { getFeatureFlags, isFeatureEnabled } from "../netlify/functions/_shared/feature-flags.js";

const fixtures = path.join(process.cwd(), "tests/fixtures/community-images");
const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("COMMUNITY_BETA flag defaults ON at launch; explicit false disables", () => {
  const flags = getFeatureFlags({});
  assert.equal(flags.COMMUNITY_BETA, true);
  assert.equal(isFeatureEnabled("COMMUNITY_BETA", {}), true);
  assert.equal(isFeatureEnabled("COMMUNITY_BETA", { FLORISYN_FLAG_COMMUNITY_BETA: "" }), true);
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

test("post validation requires category and caption", async () => {
  assert.equal((await validatePostBody({ caption: "Hi" })).valid, false);
  const ok = await validatePostBody({
    category: "Design Help",
    caption: "Hydrangea tip",
    body: "Condition overnight.",
  });
  assert.equal(ok.valid, true);
});

test("sharp fully decodes/re-encodes valid images and rejects corrupt fixtures", async () => {
  const png = fs.readFileSync(path.join(fixtures, "valid-1x1.png"));
  const jpg = fs.readFileSync(path.join(fixtures, "valid-1x1.jpg"));
  const webp = fs.readFileSync(path.join(fixtures, "valid-1x1.webp"));

  for (const [buf, mime] of [
    [png, "image/png"],
    [jpg, "image/jpeg"],
    [webp, "image/webp"],
  ]) {
    const ok = await validateCommunityImageUpload({ buffer: buf, mime });
    assert.equal(ok.valid, true, mime);
    assert.equal(ok.mime, mime);
    assert.equal(ok.sanitized, true);
    assert.ok(Buffer.isBuffer(ok.buffer));
    assert.notEqual(ok.buffer.equals(buf) && ok.buffer.length === buf.length, undefined);
  }

  const dataUrlOk = await validateCommunityImageUpload({ dataUrl: tinyPng });
  assert.equal(dataUrlOk.valid, true);
  assert.equal(dataUrlOk.mime, "image/png");

  const cases = [
    ["corrupt-short-jpg.bin", "image/jpeg"],
    ["corrupt-short-png.bin", "image/png"],
    ["corrupt-short-webp.bin", "image/webp"],
    ["corrupt-missing-jpeg-eoi.jpg", "image/jpeg"],
    ["corrupt-missing-png-chunks.png", "image/png"],
    ["corrupt-bad-webp-riff.webp", "image/webp"],
    ["corrupt-valid-dims-bad-idat.png", "image/png"],
  ];
  for (const [name, mime] of cases) {
    const r = await validateCommunityImageUpload({
      buffer: fs.readFileSync(path.join(fixtures, name)),
      mime,
    });
    assert.equal(r.valid, false, name);
  }

  assert.equal(
    (
      await validateCommunityImageUpload({
        buffer: fs.readFileSync(path.join(fixtures, "png-bytes-as-jpeg.bin")),
        mime: "image/gif",
      })
    ).valid,
    false
  );
  assert.equal(
    (
      await validateCommunityImageUpload({
        buffer: fs.readFileSync(path.join(fixtures, "png-bytes-as-jpeg.bin")),
        mime: "image/jpeg",
      })
    ).valid,
    false
  );

  const huge = Buffer.alloc(2 * 1024 * 1024 + 10, 1);
  huge[0] = 0xff;
  huge[1] = 0xd8;
  huge[2] = 0xff;
  assert.equal((await validateCommunityImageUpload({ buffer: huge, mime: "image/jpeg" })).valid, false);

  const pixelLimited = await validateCommunityImageUpload({
    buffer: png,
    mime: "image/png",
    maxPixels: 0,
  });
  assert.equal(pixelLimited.valid, false);

  const sanitizeLimited = await validateCommunityImageUpload({
    buffer: jpg,
    mime: "image/jpeg",
    maxBytes: Math.max(1, jpg.length + 1),
  });
  // Input fits; if re-encode grows past maxBytes, reject sanitized output.
  if (sanitizeLimited.valid === false) {
    assert.match(sanitizeLimited.error, /sanitization|2 MB/i);
  } else {
    // If re-encode shrank, force a tighter ceiling.
    const tighter = await validateCommunityImageUpload({
      buffer: jpg,
      mime: "image/jpeg",
      maxBytes: sanitizeLimited.sizeBytes - 1,
    });
    assert.equal(tighter.valid, false);
  }

  assert.equal(detectImageMimeFromBytes(Buffer.from("not-an-image-file-content!!!!!!!!!!")), null);
});

test("comments and reports validate length", () => {
  assert.equal(validateCommentBody({ body: "" }).valid, false);
  assert.equal(validateCommentBody({ body: "Beautiful work!" }).valid, true);
  assert.equal(validateReportBody({ reason: "no" }).valid, false);
  assert.equal(validateReportBody({ reason: "Spam promotion" }).valid, true);
});

test("users may edit only their own content; moderation is role-based", () => {
  assert.equal(canEditOwnContent({ userId: "a", authorUserId: "a" }), true);
  assert.equal(canEditOwnContent({ userId: "a", authorUserId: "b" }), false);
  assert.equal(
    canModerateCommunity({
      role: "staff",
      isPlatformAdmin: false,
      post: { shop_id: "s1" },
      shopId: "s1",
    }),
    false
  );
  assert.equal(
    canModerateCommunity({
      role: "manager",
      isPlatformAdmin: false,
      post: { shop_id: "s1" },
      shopId: "s1",
    }),
    true
  );
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
  assert.match(src, /moderatorForPost\(ctx, data, platformAdmin\)/);
  assert.doesNotMatch(src, /community_admin_check_failed/);
  assert.match(src, /community_admin_check_degraded/);
  assert.doesNotMatch(src, /Unable to verify platform admin authorization/);
  assert.match(src, /validatePostBody/);
  assert.match(src, /uploadPrevalidatedCommunityImage/);
  assert.doesNotMatch(src, /validateCommunityImageUpload/);
  assert.doesNotMatch(src, /\.from\("platform_admins"\)/);
  assert.doesNotMatch(src, /object\/public\/florist-community/);
  assert.doesNotMatch(src, /\.from\("orders"\)/);
  assert.doesNotMatch(src, /\.from\("customers"\)/);
  assert.doesNotMatch(src, /\.from\("staff"\)/);
  assert.doesNotMatch(src, /\.from\("payments"\)/);
  assert.doesNotMatch(src, /florist_community_adjust_like_count/);
});

test("community R1/R2/R3 migration hardens membership, private storage, narrow moderation", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/legacy_migrations/20260731_florist_community_beta_v1_r1_security.sql"),
    "utf8"
  );
  assert.match(sql, /is_active_florist/);
  assert.match(sql, /sm\.status = 'active'/);
  assert.doesNotMatch(sql, /coalesce\s*\(\s*sm\.status/i);
  assert.doesNotMatch(sql, /exception\s+when others then/i);
  assert.match(sql, /Community security migration aborted/);
  assert.match(sql, /found_statuses is distinct from expected_statuses/);
  assert.match(sql, /not\\s\+in/);
  assert.doesNotMatch(sql, /check_def !~\* 'active'/);
  assert.match(sql, /public\s*=\s*false/);
  assert.match(sql, /on conflict \(post_id, reporter_user_id\) do nothing/);
  assert.match(sql, /florist_community_moderate_comment/);
  assert.match(sql, /drop policy if exists "community posts update moderator"/);
  assert.match(sql, /revoke all on table public\.florist_community_posts from anon/);
  assert.doesNotMatch(sql, /staff_time_entries/);

  const v1 = fs.readFileSync(
    path.join(process.cwd(), "supabase/legacy_migrations/20260731_florist_community_beta_v1.sql"),
    "utf8"
  );
  assert.match(v1, /LOCKED/);
  assert.match(v1, /public\s*=\s*false/);
  assert.doesNotMatch(v1, /to public\s*\n\s*using \(bucket_id = 'florist-community'\)/);
  assert.match(v1, /revoke all on function public\.is_platform_admin_user\(\) from authenticated/);
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

test("package pins sharp for real decode/re-encode", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(pkg.dependencies.sharp, "0.35.3");
  assert.equal(pkg.dependencies["image-size"], undefined);
  const shared = fs.readFileSync(path.join(process.cwd(), "netlify/functions/_shared/florist-community.js"), "utf8");
  assert.match(shared, /import sharp from "sharp"/);
  assert.doesNotMatch(shared, /image-size/);
  assert.match(shared, /Fully decode and sanitize/);
  assert.match(shared, /BEFORE decoding base64|before Buffer\.from/i);
});

test("parseDataUrl enforces size before base64 decode", () => {
  assert.equal(maxBase64LengthForBytes(3), 4);
  const overDeclared = parseDataUrl("data:image/png;base64,QQ==", {
    sizeBytes: COMMUNITY_IMAGE_MAX_BYTES + 5,
  });
  assert.equal(overDeclared.ok, false);
  const overLen = parseDataUrl(`data:image/png;base64,${"A".repeat(maxBase64LengthForBytes() + 4)}`);
  assert.equal(overLen.ok, false);
  const malformed = parseDataUrl("data:image/png;base64,@@@@");
  assert.equal(malformed.ok, false);
});

test("create/update use prevalidated v.image once; storage module has no sharp", () => {
  const handler = fs.readFileSync(path.join(process.cwd(), "netlify/functions/florist-community.js"), "utf8");
  assert.match(handler, /uploadPrevalidatedCommunityImage\(client, shopId, user\.id, v\.image\)/g);
  assert.equal(
    (handler.match(/uploadPrevalidatedCommunityImage\(client, shopId, user\.id, v\.image\)/g) || []).length,
    2
  );
  const storage = fs.readFileSync(
    path.join(process.cwd(), "netlify/functions/_shared/florist-community-storage.js"),
    "utf8"
  );
  assert.doesNotMatch(storage, /\bsharp\b|validateCommunityImageUpload|data_url|parseDataUrl/);
  assert.doesNotMatch(storage, /upload\([^)]*dataUrl/);
});
