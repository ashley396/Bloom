import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail, adminIfConfigured } from "./_shared/supabase.js";
import { authenticatedUser } from "./_shared/saas.js";
import { writeAdminAudit } from "./_shared/platform-admin.js";
import { isFeatureEnabled } from "./_shared/feature-flags.js";
import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_GUIDELINES,
  COMMUNITY_IMAGE_BUCKET,
  COMMUNITY_SIGNED_URL_SECONDS,
  validateProfileBody,
  validateProfileAvatarUpload,
  validatePostBody,
  validateCommentBody,
  validateReportBody,
  publicProfile,
  publicPost,
  publicComment,
  canEditOwnContent,
  assertCommunitySafePayload,
  isStoragePath,
  permissionAtLeast,
} from "./_shared/florist-community.js";
import {
  uploadPrevalidatedCommunityImage,
  uploadPrevalidatedCommunityAvatar,
  removeCommunityImageQuietly,
  reconcileCommunityImageAfterWriteError,
  downloadCommunityImageBuffer,
  resolveCommunityImageForVision,
} from "./_shared/florist-community-storage.js";
import { runCloudflareGenerate, cloudflareAiToken } from "./ai-assistant.js";
import { analyzeArrangementPhoto } from "./_shared/florist-ai-vision.js";
import {
  sanitizeRecipeDraft,
  generateRecipeWithCloudflare,
  buildLocalRecipeDraftFromPost,
  publicRecipeSummary,
} from "./_shared/florist-community-recipes.js";
import { matchRecipeToInventory } from "../../lib/floral-library/recipe-intelligence.js";

function featureGate() {
  if (!isFeatureEnabled("COMMUNITY_BETA")) {
    const e = new Error("Florist Community Beta is temporarily disabled.");
    e.statusCode = 503;
    e.code = "community_disabled";
    throw e;
  }
}

function missingRelation(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST202" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("could not find the table") ||
    msg.includes("could not find the function")
  );
}

function friendlyMissing() {
  const e = new Error(
    "Florist Community tables are not set up yet. Apply community migrations, then try again."
  );
  e.statusCode = 503;
  e.code = "community_not_migrated";
  throw e;
}

function denied(message, statusCode = 403) {
  const e = new Error(message);
  e.statusCode = statusCode;
  throw e;
}

/**
 * Fail-closed active-florist gate. Never ignores false/error results.
 * Missing migration helpers surface as 503 — never as open access.
 */
async function requireActiveFlorist(ctx) {
  const { client, user, shopId, membership } = ctx;
  if (!shopId || !user?.id) {
    denied("An active florist shop membership is required to use Community.");
  }
  const status = String(membership?.status || "").toLowerCase();
  if (status && status !== "active") {
    denied("An active florist shop membership is required to use Community.");
  }

  const { data, error } = await client.rpc("is_active_florist");
  if (error) {
    if (missingRelation(error)) friendlyMissing();
    // RPC may fail when grants are stale; currentUser already validated shop membership.
    if (status === "active" || !status) return ctx;
    const e = new Error("Unable to verify florist membership for Community.");
    e.statusCode = 503;
    e.code = "community_membership_check_failed";
    throw e;
  }
  if (data !== true) {
    denied("An active florist shop membership is required to use Community.");
  }
  return ctx;
}

/**
 * Platform-admin check via hardened SECURITY DEFINER RPC.
 * Never queries platform_admins with a user JWT client (no browser-facing RLS policy).
 */
async function isPlatformAdminViaRpc(client) {
  const { data, error } = await client.rpc("is_platform_admin_user");
  if (error) {
    if (missingRelation(error)) friendlyMissing();
    // Never block florists when admin RPC is unavailable (e.g. missing EXECUTE grant).
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "community_admin_check_degraded",
        detail: String(error.message || error).slice(0, 200)
      })
    );
    return false;
  }
  return data === true;
}

/**
 * Resolve Community access: active florist, or moderation-only platform admin.
 */
async function resolveCommunityAccess(event) {
  let floristCtx = null;
  let floristError = null;
  try {
    floristCtx = await currentUser(event);
  } catch (error) {
    floristError = error;
    if (error?.statusCode === 401) throw error;
  }

  if (floristCtx) {
    await requireActiveFlorist(floristCtx);
    const platformAdmin = await isPlatformAdminViaRpc(floristCtx.client);
    return { ...floristCtx, platformAdmin, moderationOnly: false };
  }

  // Membership failed — allow moderation-only platform admins without Community participation.
  const { client, user } = await authenticatedUser(event);
  const platformAdmin = await isPlatformAdminViaRpc(client);
  if (!platformAdmin) {
    if (floristError) throw floristError;
    denied("An active florist shop membership is required to use Community.");
  }
  return {
    client,
    user,
    shopId: null,
    role: null,
    membership: null,
    platformAdmin: true,
    moderationOnly: true,
    usesServiceRole: false,
  };
}

function requireParticipant(ctx) {
  if (ctx.moderationOnly || !ctx.shopId) {
    denied("Platform administrators may moderate Community but are not ordinary participants.");
  }
}

function moderatorForPost(ctx, post, platformAdmin) {
  if (!post) return false;
  if (platformAdmin) return true;
  const role = String(ctx.role || "").toLowerCase();
  if (["owner", "manager", "admin"].includes(role) && post.shop_id === ctx.shopId) return true;
  return false;
}

const PROFILE_COLUMNS =
  "user_id,shop_id,display_name,shop_display_name,city,region,bio,avatar_path,updated_at";

const POST_COLUMNS =
  "id,author_user_id,shop_id,category,caption,body,image_path,status,like_count,comment_count,created_at,updated_at,recipe_draft,recipe_status,published_recipe_id,share_permission,allow_photo_use,answered_comment_id";

const RECIPE_COLUMNS =
  "id,post_id,author_user_id,author_shop_id,title,description,category,recipe,instructions,suggested_retail,image_path,status,import_count,created_at,updated_at";

function communityStorageClient() {
  return adminIfConfigured();
}

async function profileForApi(client, row) {
  if (!row) return null;
  const signed = await signedImageUrl(client, row.avatar_path);
  return publicProfile(row, {
    avatarUrl: signed.url,
    avatarExpiresIn: signed.expiresIn,
  });
}

async function loadProfile(client, userId) {
  const { data, error } = await client
    .from("florist_community_profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (missingRelation(error)) friendlyMissing();
    throw error;
  }
  return data;
}

async function ensureDefaultProfile(client, ctx) {
  const existing = await loadProfile(client, ctx.user.id);
  if (existing) return existing;
  let shopName = "Flower shop";
  try {
    const { data: shop } = await client.from("shops").select("name").eq("id", ctx.shopId).maybeSingle();
    if (shop?.name) shopName = shop.name;
  } catch {
    /* ignore */
  }
  const display = String(
    ctx.user.user_metadata?.full_name || ctx.user.email?.split("@")[0] || "Florist"
  ).slice(0, 80);
  const row = {
    user_id: ctx.user.id,
    shop_id: ctx.shopId,
    display_name: display,
    shop_display_name: String(shopName).slice(0, 120),
    city: null,
    region: null,
    bio: null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client
    .from("florist_community_profiles")
    .upsert(row, { onConflict: "user_id" })
    .select(PROFILE_COLUMNS)
    .single();
  if (error) {
    if (missingRelation(error)) friendlyMissing();
    throw error;
  }
  return data;
}

async function signedImageUrl(client, path) {
  if (!path || !isStoragePath(path)) {
    return { url: null, expiresIn: null };
  }
  // Renewed access must pass DB authorization (hidden/removed posts fail closed).
  const { data: readable, error: readErr } = await client.rpc("florist_community_image_readable", {
    p_path: path,
  });
  if (readErr || readable !== true) {
    return { url: null, expiresIn: null };
  }
  const { data, error } = await client.storage
    .from(COMMUNITY_IMAGE_BUCKET)
    .createSignedUrl(path, COMMUNITY_SIGNED_URL_SECONDS);
  if (error) return { url: null, expiresIn: null };
  return { url: data?.signedUrl || null, expiresIn: COMMUNITY_SIGNED_URL_SECONDS };
}

async function adminSignedImageUrl(path) {
  const admin = communityStorageClient();
  if (!admin || !path || !isStoragePath(path)) return null;
  const { data, error } = await admin.storage
    .from(COMMUNITY_IMAGE_BUCKET)
    .createSignedUrl(path, COMMUNITY_SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function auditPlatformModeration(userId, shopId, action, details) {
  const svc = adminIfConfigured();
  if (!svc) return;
  try {
    await writeAdminAudit(svc, userId, shopId || null, action, details);
  } catch (error) {
    console.error("Community moderation audit write failed:", error?.message || error);
  }
}

async function attachAuthors(client, posts) {
  const ids = [...new Set((posts || []).map((p) => p.author_user_id).filter(Boolean))];
  if (!ids.length) return posts;
  const { data, error } = await client
    .from("florist_community_profiles")
    .select(PROFILE_COLUMNS)
    .in("user_id", ids);
  if (error) throw error;
  const profiles = await Promise.all((data || []).map((row) => profileForApi(client, row)));
  const map = new Map(profiles.filter(Boolean).map((p) => [p.user_id, p]));
  return (posts || []).map((p) => ({ ...p, author: map.get(p.author_user_id) || null }));
}

async function loadLikesForUser(client, userId, postIds) {
  if (!postIds.length) return new Set();
  const { data, error } = await client
    .from("florist_community_likes")
    .select("post_id")
    .eq("user_id", userId)
    .in("post_id", postIds);
  if (error) throw error;
  return new Set((data || []).map((r) => r.post_id));
}

/** Community Step 68 — who the caller follows, for author_followed and the Following feed filter. */
async function loadFollowingSet(client, userId) {
  const { data, error } = await client
    .from("florist_community_follows")
    .select("followed_user_id")
    .eq("follower_user_id", userId);
  if (error) {
    if (missingRelation(error)) return new Set();
    throw error;
  }
  return new Set((data || []).map((r) => r.followed_user_id));
}

/**
 * Best-effort notification write — a notification is always about
 * *someone else's* action on your content, so it's written with the
 * service-role client (same pattern as the import_count update above),
 * never blocking the real action (like/comment/follow) if it fails or
 * the migration hasn't been applied yet.
 */
async function notify(recipientUserId, actorUserId, shopId, type, { postId = null, commentId = null } = {}) {
  if (!recipientUserId || recipientUserId === actorUserId) return;
  const svc = adminIfConfigured();
  if (!svc) return;
  try {
    await svc.from("florist_community_notifications").insert({
      recipient_user_id: recipientUserId,
      actor_user_id: actorUserId,
      shop_id: shopId,
      type,
      post_id: postId,
      comment_id: commentId,
    });
  } catch {
    /* non-blocking; table may not exist until migration is applied */
  }
}

async function requireActivePost(client, postId) {
  const { data, error } = await client
    .from("florist_community_posts")
    .select("id,shop_id,author_user_id,status,image_path")
    .eq("id", postId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "active") {
    denied("This post is not available.", 404);
  }
  return data;
}

async function loadPublishedRecipes(client, recipeIds) {
  const ids = [...new Set((recipeIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await client
    .from("florist_community_recipes")
    .select(RECIPE_COLUMNS)
    .in("id", ids)
    .eq("status", "active");
  if (error) {
    if (missingRelation(error)) friendlyMissing();
    throw error;
  }
  const map = new Map();
  for (const row of data || []) {
    const signed = await signedImageUrl(client, row.image_path);
    map.set(row.id, publicRecipeSummary(row, { imageUrl: signed.url }));
  }
  return map;
}

async function feed(client, ctx, { category, platformAdmin, q, followingOnly }) {
  let query = client
    .from("florist_community_posts")
    .select(POST_COLUMNS)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(50);
  if (category && COMMUNITY_CATEGORIES.includes(category)) {
    query = query.eq("category", category);
  }
  // Community Step 68 — real search over caption/body, not a client-side
  // filter over whatever page of posts happened to already be loaded.
  const term = String(q || "").trim().slice(0, 120);
  if (term) {
    const escaped = term.replace(/[%_]/g, (c) => `\\${c}`);
    query = query.or(`caption.ilike.%${escaped}%,body.ilike.%${escaped}%`);
  }
  const followingSet = await loadFollowingSet(client, ctx.user.id);
  if (followingOnly) {
    const ids = [...followingSet];
    // An empty IN-list would match nothing via .in([]) inconsistently
    // across PostgREST versions — short-circuit to an honest empty feed
    // instead of relying on that.
    if (!ids.length) return [];
    query = query.in("author_user_id", ids);
  }
  const { data, error } = await query;
  if (error) {
    if (missingRelation(error)) friendlyMissing();
    throw error;
  }
  const withAuthors = await attachAuthors(client, data || []);
  const liked = await loadLikesForUser(
    client,
    ctx.user.id,
    withAuthors.map((p) => p.id)
  );
  const recipeMap = await loadPublishedRecipes(
    client,
    withAuthors.map((p) => p.published_recipe_id)
  );
  return Promise.all(
    withAuthors.map(async (p) => {
      const signed = await signedImageUrl(client, p.image_path);
      const isMine = p.author_user_id === ctx.user.id;
      return publicPost(p, {
        liked: liked.has(p.id),
        isMine,
        canModerate: moderatorForPost(ctx, p, platformAdmin),
        imageUrl: signed.url,
        imageExpiresIn: signed.expiresIn,
        publishedRecipe: p.published_recipe_id ? recipeMap.get(p.published_recipe_id) || null : null,
        authorFollowed: followingSet.has(p.author_user_id),
      });
    })
  );
}

async function recipesFeed(client) {
  const { data, error } = await client
    .from("florist_community_recipes")
    .select(RECIPE_COLUMNS)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    if (missingRelation(error)) friendlyMissing();
    throw error;
  }
  const authorIds = [...new Set((data || []).map((r) => r.author_user_id).filter(Boolean))];
  let profileMap = new Map();
  if (authorIds.length) {
    const { data: profiles, error: pe } = await client
      .from("florist_community_profiles")
      .select(PROFILE_COLUMNS)
      .in("user_id", authorIds);
    if (pe) throw pe;
    const resolved = await Promise.all((profiles || []).map((row) => profileForApi(client, row)));
    profileMap = new Map(resolved.filter(Boolean).map((p) => [p.user_id, p]));
  }
  return Promise.all(
    (data || []).map(async (row) => {
      const signed = await signedImageUrl(client, row.image_path);
      return {
        ...publicRecipeSummary(row, { imageUrl: signed.url }),
        author: profileMap.get(row.author_user_id) || null,
      };
    })
  );
}

async function requireOwnPostWithImage(client, userId, postId) {
  const { data, error } = await client
    .from("florist_community_posts")
    .select(POST_COLUMNS)
    .eq("id", postId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "active") denied("This post is not available.", 404);
  if (data.author_user_id !== userId) denied("You can only build recipes on your own posts.");
  if (!data.image_path) denied("Add an arrangement photo before building a recipe.");
  return data;
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  try {
    featureGate();
    const ctx = await resolveCommunityAccess(event);
    const { client, shopId, user, platformAdmin, moderationOnly } = ctx;
    const method = event.httpMethod;

    if (method === "GET") {
      const action = String(event.queryStringParameters?.action || "feed").toLowerCase();
      if (action === "meta") {
        return json(
          200,
          assertCommunitySafePayload({
            beta: true,
            enabled: true,
            categories: COMMUNITY_CATEGORIES,
            guidelines: COMMUNITY_GUIDELINES,
            image_max_bytes: 2 * 1024 * 1024,
            image_signed_url_seconds: COMMUNITY_SIGNED_URL_SECONDS,
            can_moderate_platform: platformAdmin,
            moderation_only: Boolean(moderationOnly),
          })
        );
      }
      if (action === "profile") {
        requireParticipant(ctx);
        const profile = await ensureDefaultProfile(client, ctx);
        return json(200, { profile: await profileForApi(client, profile), guidelines: COMMUNITY_GUIDELINES });
      }
      if (action === "recipes") {
        requireParticipant(ctx);
        const items = await recipesFeed(client);
        return json(200, assertCommunitySafePayload({ items }));
      }
      if (action === "comments") {
        requireParticipant(ctx);
        const postId = String(event.queryStringParameters?.post_id || "");
        if (!postId) return json(400, { error: "post_id is required." });
        await requireActivePost(client, postId);
        const { data, error } = await client
          .from("florist_community_comments")
          .select("id,post_id,author_user_id,shop_id,body,status,created_at")
          .eq("post_id", postId)
          .eq("status", "active")
          .order("created_at", { ascending: true })
          .limit(100);
        if (error) {
          if (missingRelation(error)) friendlyMissing();
          throw error;
        }
        const withAuthors = await attachAuthors(client, data || []);
        const { data: post } = await client
          .from("florist_community_posts")
          .select("id,shop_id,author_user_id")
          .eq("id", postId)
          .maybeSingle();
        return json(200, {
          items: withAuthors.map((c) =>
            publicComment(
              { ...c, author: c.author },
              {
                isMine: c.author_user_id === user.id,
                canModerate: moderatorForPost(ctx, post || c, platformAdmin),
              }
            )
          ),
        });
      }
      if (action === "notifications") {
        requireParticipant(ctx);
        const { data: notifications, error } = await client
          .from("florist_community_notifications")
          .select("id,type,actor_user_id,post_id,comment_id,read_at,created_at")
          .eq("recipient_user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) {
          // Not-yet-migrated is a real, honest empty state — never a hard failure.
          if (missingRelation(error)) return json(200, { items: [], unread_count: 0 });
          throw error;
        }
        const actorIds = [...new Set((notifications || []).map((n) => n.actor_user_id).filter(Boolean))];
        let actorMap = new Map();
        if (actorIds.length) {
          const { data: actors, error: ae } = await client
            .from("florist_community_profiles")
            .select(PROFILE_COLUMNS)
            .in("user_id", actorIds);
          if (ae) throw ae;
          const resolved = await Promise.all((actors || []).map((row) => profileForApi(client, row)));
          actorMap = new Map(resolved.filter(Boolean).map((p) => [p.user_id, p]));
        }
        const items = (notifications || []).map((n) => ({
          id: n.id,
          type: n.type,
          actor: actorMap.get(n.actor_user_id) || null,
          post_id: n.post_id,
          comment_id: n.comment_id,
          read: Boolean(n.read_at),
          created_at: n.created_at,
        }));
        return json(200, {
          items,
          unread_count: items.filter((n) => !n.read).length,
        });
      }
      if (action === "moderation") {
        if (!platformAdmin) return json(403, { error: "Platform admin moderation only." });
        const { data: reports, error } = await client
          .from("florist_community_reports")
          .select("id,post_id,reason,status,created_at,reporter_user_id")
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) throw error;
        const postIds = [...new Set((reports || []).map((r) => r.post_id).filter(Boolean))];
        let posts = [];
        if (postIds.length) {
          const { data: postRows, error: pe } = await client
            .from("florist_community_posts")
            .select(
              "id,author_user_id,shop_id,category,caption,body,image_path,status,like_count,comment_count,created_at,updated_at"
            )
            .in("id", postIds);
          if (pe) throw pe;
          posts = postRows || [];
        }
        return json(
          200,
          assertCommunitySafePayload({
            reports: reports || [],
            posts,
            moderation_only: Boolean(moderationOnly),
          })
        );
      }
      requireParticipant(ctx);
      const category = event.queryStringParameters?.category || "";
      const q = event.queryStringParameters?.q || "";
      const followingOnly = String(event.queryStringParameters?.following || "") === "1";
      const items = await feed(client, ctx, { category, platformAdmin, q, followingOnly });
      const profile = await ensureDefaultProfile(client, ctx);
      return json(
        200,
        assertCommunitySafePayload({
          beta: true,
          enabled: true,
          profile: await profileForApi(client, profile),
          guidelines: COMMUNITY_GUIDELINES,
          categories: COMMUNITY_CATEGORIES,
          image_signed_url_seconds: COMMUNITY_SIGNED_URL_SECONDS,
          items,
        })
      );
    }

    if (method !== "POST") return methodNotAllowed();
    const body = bodyOf(event);
    const action = String(body.action || "").toLowerCase();

    if (action === "save_profile") {
      requireParticipant(ctx);
      const v = validateProfileBody(body);
      if (!v.valid) return json(400, { error: v.errors.join(" ") });
      const existing = await loadProfile(client, user.id);
      const avatarCheck = await validateProfileAvatarUpload(body);
      if (!avatarCheck.valid) return json(400, { error: avatarCheck.error });

      let avatarPath = existing?.avatar_path || null;
      if (avatarCheck.remove) {
        if (existing?.avatar_path) await removeCommunityImageQuietly(client, existing.avatar_path);
        avatarPath = null;
      } else if (avatarCheck.image) {
        const up = await uploadPrevalidatedCommunityAvatar(client, shopId, user.id, avatarCheck.image, {
          storageClient: communityStorageClient(),
        });
        if (!up.ok) return json(400, { error: up.error });
        if (existing?.avatar_path && existing.avatar_path !== up.path) {
          await removeCommunityImageQuietly(client, existing.avatar_path);
        }
        avatarPath = up.path;
      }

      const payload = {
        user_id: user.id,
        shop_id: shopId,
        ...v.sanitized,
        avatar_path: avatarPath,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await client
        .from("florist_community_profiles")
        .upsert(payload, { onConflict: "user_id" })
        .select(PROFILE_COLUMNS)
        .single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, { profile: await profileForApi(client, data) });
    }

    if (action === "create_post") {
      requireParticipant(ctx);
      await ensureDefaultProfile(client, ctx);
      const v = await validatePostBody(body);
      if (!v.valid) return json(400, { error: v.errors.join(" ") });
      let imagePath = null;
      let uploadedPath = null;
      if (v.image) {
        const up = await uploadPrevalidatedCommunityImage(client, shopId, user.id, v.image, {
          storageClient: communityStorageClient(),
        });
        if (!up.ok) return json(400, { error: up.error });
        imagePath = up.path;
        uploadedPath = up.path;
      }
      const insert = {
        author_user_id: user.id,
        shop_id: shopId,
        category: v.sanitized.category,
        caption: v.sanitized.caption,
        body: v.sanitized.body,
        image_path: imagePath,
        share_permission: v.sanitized.share_permission,
        allow_photo_use: v.sanitized.allow_photo_use,
        status: "active",
        like_count: 0,
        comment_count: 0,
      };
      const { data, error } = await client
        .from("florist_community_posts")
        .insert(insert)
        .select(
          "id,author_user_id,shop_id,category,caption,body,image_path,status,like_count,comment_count,created_at,updated_at"
        )
        .single();
      if (error) {
        // Ambiguous write: commit may have succeeded despite a failed response.
        if (uploadedPath) await reconcileCommunityImageAfterWriteError(client, uploadedPath);
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      const profile = await loadProfile(client, user.id);
      const signed = await signedImageUrl(client, data.image_path);
      return json(201, {
        item: publicPost(
          { ...data, author: profile },
          {
            isMine: true,
            canModerate: moderatorForPost(ctx, data, platformAdmin),
            imageUrl: signed.url,
            imageExpiresIn: signed.expiresIn,
          }
        ),
      });
    }

    if (action === "update_post") {
      requireParticipant(ctx);
      const id = String(body.id || "");
      if (!id) return json(400, { error: "Post id is required." });
      const { data: existing, error: ge } = await client
        .from("florist_community_posts")
        .select("id,author_user_id,shop_id,category,caption,body,image_path,status,share_permission,allow_photo_use")
        .eq("id", id)
        .maybeSingle();
      if (ge) throw ge;
      if (!existing) return json(404, { error: "Post not found." });
      if (!canEditOwnContent({ userId: user.id, authorUserId: existing.author_user_id })) {
        return json(403, { error: "You can only edit your own posts." });
      }
      if (existing.status !== "active") {
        return json(403, { error: "Hidden or removed posts cannot be edited or restored by authors." });
      }
      const v = await validatePostBody({
        category: body.category ?? existing.category,
        caption: body.caption ?? existing.caption,
        body: body.body ?? existing.body,
        image_data_url: body.image_data_url,
        share_permission: body.share_permission ?? existing.share_permission,
        allow_photo_use: body.allow_photo_use ?? existing.allow_photo_use,
      });
      if (!v.valid) return json(400, { error: v.errors.join(" ") });
      // Only editable content fields — never counters/status/ownership
      const patch = {
        category: v.sanitized.category,
        caption: v.sanitized.caption,
        body: v.sanitized.body,
        share_permission: v.sanitized.share_permission,
        allow_photo_use: v.sanitized.allow_photo_use,
        updated_at: new Date().toISOString(),
      };
      let uploadedPath = null;
      const previousPath = existing.image_path || null;
      if (v.image) {
        const up = await uploadPrevalidatedCommunityImage(client, shopId, user.id, v.image, {
          storageClient: communityStorageClient(),
        });
        if (!up.ok) return json(400, { error: up.error });
        patch.image_path = up.path;
        uploadedPath = up.path;
      }
      const { data, error } = await client
        .from("florist_community_posts")
        .update(patch)
        .eq("id", id)
        .eq("author_user_id", user.id)
        .select(
          "id,author_user_id,shop_id,category,caption,body,image_path,status,like_count,comment_count,created_at,updated_at"
        )
        .single();
      if (error) {
        // Ambiguous write: never delete previous image; reconcile new object only if unreferenced.
        if (uploadedPath) await reconcileCommunityImageAfterWriteError(client, uploadedPath);
        throw error;
      }
      if (uploadedPath && previousPath && previousPath !== uploadedPath) {
        await removeCommunityImageQuietly(client, previousPath);
      }
      const signed = await signedImageUrl(client, data.image_path);
      return json(200, {
        item: publicPost(
          { ...data, author: await loadProfile(client, user.id) },
          {
            isMine: true,
            imageUrl: signed.url,
            imageExpiresIn: signed.expiresIn,
          }
        ),
      });
    }

    if (action === "delete_post") {
      const id = String(body.id || "");
      if (!id) return json(400, { error: "Post id is required." });
      const { data: existing, error: ge } = await client
        .from("florist_community_posts")
        .select("id,author_user_id,shop_id,image_path")
        .eq("id", id)
        .maybeSingle();
      if (ge) throw ge;
      if (!existing) return json(404, { error: "Post not found." });
      const mine = canEditOwnContent({ userId: user.id, authorUserId: existing.author_user_id });
      const mod = moderatorForPost(ctx, existing, platformAdmin);
      if (!mine && !mod) return json(403, { error: "You cannot delete this post." });
      if (mine && !moderationOnly) {
        const previousPath = existing.image_path || null;
        const { error } = await client
          .from("florist_community_posts")
          .delete()
          .eq("id", id)
          .eq("author_user_id", user.id);
        if (error) throw error;
        // Remove image only after successful author hard-delete.
        if (previousPath) await removeCommunityImageQuietly(client, previousPath);
        return json(200, { ok: true });
      }
      // Moderators soft-remove only — hard delete unavailable; preserve image for review.
      const { data: modResult, error } = await client.rpc("florist_community_moderate_post", {
        p_post_id: id,
        p_status: "removed",
      });
      if (error) throw error;
      if (platformAdmin) {
        await auditPlatformModeration(user.id, existing.shop_id, "community_moderate_post", {
          post_id: id,
          status: "removed",
        });
      }
      return json(200, { ok: true, ...(modResult || {}) });
    }

    if (action === "toggle_follow") {
      requireParticipant(ctx);
      const authorUserId = String(body.author_user_id || "");
      if (!authorUserId) return json(400, { error: "author_user_id is required." });
      if (authorUserId === user.id) return json(400, { error: "You can't follow yourself." });
      const { data: existing, error: existingErr } = await client
        .from("florist_community_follows")
        .select("follower_user_id")
        .eq("follower_user_id", user.id)
        .eq("followed_user_id", authorUserId)
        .maybeSingle();
      if (existingErr) {
        if (missingRelation(existingErr)) friendlyMissing();
        throw existingErr;
      }
      if (existing) {
        const { error } = await client
          .from("florist_community_follows")
          .delete()
          .eq("follower_user_id", user.id)
          .eq("followed_user_id", authorUserId);
        if (error) throw error;
        return json(200, { following: false });
      }
      const { error } = await client
        .from("florist_community_follows")
        .insert({ follower_user_id: user.id, followed_user_id: authorUserId, shop_id: shopId });
      if (error) throw error;
      await notify(authorUserId, user.id, shopId, "follow", {});
      return json(200, { following: true });
    }

    if (action === "mark_notifications_read") {
      requireParticipant(ctx);
      const { error } = await client
        .from("florist_community_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("recipient_user_id", user.id)
        .is("read_at", null);
      if (error) {
        if (missingRelation(error)) return json(200, { ok: true });
        throw error;
      }
      return json(200, { ok: true });
    }

    // Community Step 68 (structured post types) — a real behavioral
    // difference for Questions posts: only the asker can mark an answer,
    // and only a comment that's actually on this post qualifies. This is
    // the difference between a real "knowledge area" workflow and a
    // cosmetic category label.
    if (action === "mark_answered") {
      requireParticipant(ctx);
      const postId = String(body.post_id || "");
      const commentId = String(body.comment_id || "");
      if (!postId || !commentId) return json(400, { error: "post_id and comment_id are required." });
      const { data: post, error: postErr } = await client
        .from("florist_community_posts")
        .select("id,author_user_id,category,status")
        .eq("id", postId)
        .maybeSingle();
      if (postErr) throw postErr;
      if (!post || post.status !== "active") return json(404, { error: "This post is not available." });
      if (post.author_user_id !== user.id) return json(403, { error: "Only the person who asked can mark an answer." });
      const { data: comment, error: commentErr } = await client
        .from("florist_community_comments")
        .select("id")
        .eq("id", commentId)
        .eq("post_id", postId)
        .eq("status", "active")
        .maybeSingle();
      if (commentErr) throw commentErr;
      if (!comment) return json(404, { error: "That comment could not be found on this post." });
      const { error } = await client
        .from("florist_community_posts")
        .update({ answered_comment_id: commentId, updated_at: new Date().toISOString() })
        .eq("id", postId);
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, { ok: true, answered_comment_id: commentId });
    }

    if (action === "toggle_like") {
      requireParticipant(ctx);
      const postId = String(body.post_id || "");
      if (!postId) return json(400, { error: "post_id is required." });
      const { data, error } = await client.rpc("florist_community_toggle_like", {
        p_post_id: postId,
        p_shop_id: shopId,
      });
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        const msg = String(error.message || "");
        if (/not available|P0002/i.test(msg)) return json(404, { error: "This post is not available." });
        if (/membership|42501|authenticated/i.test(msg)) return json(403, { error: msg });
        throw error;
      }
      if (data?.liked) {
        const { data: postRow } = await client
          .from("florist_community_posts")
          .select("author_user_id")
          .eq("id", postId)
          .maybeSingle();
        if (postRow) await notify(postRow.author_user_id, user.id, shopId, "like", { postId });
      }
      return json(200, {
        liked: Boolean(data?.liked),
        like_count: Number(data?.like_count || 0),
      });
    }

    if (action === "add_comment") {
      requireParticipant(ctx);
      const postId = String(body.post_id || "");
      const v = validateCommentBody(body);
      if (!postId) return json(400, { error: "post_id is required." });
      if (!v.valid) return json(400, { error: v.errors.join(" ") });
      const post = await requireActivePost(client, postId);
      await ensureDefaultProfile(client, ctx);
      const { data, error } = await client
        .from("florist_community_comments")
        .insert({
          post_id: postId,
          author_user_id: user.id,
          shop_id: shopId,
          body: v.sanitized.body,
          status: "active",
        })
        .select("id,post_id,author_user_id,shop_id,body,status,created_at")
        .single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      await notify(post.author_user_id, user.id, shopId, "comment", { postId, commentId: data.id });
      const profile = await loadProfile(client, user.id);
      return json(201, {
        item: publicComment({ ...data, author: profile }, { isMine: true }),
      });
    }

    if (action === "delete_comment") {
      const id = String(body.id || "");
      if (!id) return json(400, { error: "Comment id is required." });
      const { data: existing, error: ge } = await client
        .from("florist_community_comments")
        .select("id,author_user_id,shop_id,post_id")
        .eq("id", id)
        .maybeSingle();
      if (ge) throw ge;
      if (!existing) return json(404, { error: "Comment not found." });
      const mine = canEditOwnContent({ userId: user.id, authorUserId: existing.author_user_id });
      const mod = moderatorForPost(ctx, existing, platformAdmin);
      if (!mine && !mod) return json(403, { error: "You cannot delete this comment." });
      if (mine && !moderationOnly) {
        const { error } = await client
          .from("florist_community_comments")
          .delete()
          .eq("id", id)
          .eq("author_user_id", user.id);
        if (error) throw error;
        return json(200, { ok: true });
      }
      const { data: modResult, error } = await client.rpc("florist_community_moderate_comment", {
        p_comment_id: id,
        p_status: "removed",
      });
      if (error) throw error;
      if (platformAdmin) {
        await auditPlatformModeration(user.id, existing.shop_id, "community_moderate_comment", {
          comment_id: id,
          status: "removed",
        });
      }
      return json(200, { ok: true, ...(modResult || {}) });
    }

    if (action === "report_post") {
      requireParticipant(ctx);
      const postId = String(body.post_id || "");
      const v = validateReportBody(body);
      if (!postId) return json(400, { error: "post_id is required." });
      if (!v.valid) return json(400, { error: v.errors.join(" ") });
      const { data, error } = await client.rpc("florist_community_report_post", {
        p_post_id: postId,
        p_shop_id: shopId,
        p_reason: v.sanitized.reason,
      });
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        const msg = String(error.message || "");
        if (/not available|P0002/i.test(msg)) return json(404, { error: "This post is not available." });
        throw error;
      }
      return json(200, {
        ok: true,
        already_reported: Boolean(data?.already_reported),
        message: data?.message || "Thanks — moderators will review this post.",
      });
    }

    if (action === "moderate_hide" || action === "moderate_remove") {
      const id = String(body.id || body.post_id || "");
      if (!id) return json(400, { error: "Post id is required." });
      const status = action === "moderate_remove" ? "removed" : "hidden";
      const { data, error } = await client.rpc("florist_community_moderate_post", {
        p_post_id: id,
        p_status: status,
      });
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        const msg = String(error.message || "");
        if (/Not authorized|42501/i.test(msg)) {
          return json(403, { error: "Moderation requires a shop manager for this shop or a platform admin." });
        }
        if (/not found|P0002/i.test(msg)) return json(404, { error: "Post not found." });
        throw error;
      }
      if (platformAdmin && body.report_id) {
        const { error: re } = await client.rpc("florist_community_moderate_report", {
          p_report_id: body.report_id,
          p_status: "reviewed",
        });
        if (re) throw re;
      }
      if (platformAdmin) {
        await auditPlatformModeration(user.id, null, "community_moderate_post", {
          post_id: id,
          status,
          report_id: body.report_id || null,
        });
      }
      return json(200, { ok: true, status: data?.status || status });
    }

    if (action === "moderate_report") {
      if (!platformAdmin) {
        return json(403, { error: "Only platform administrators may update report status." });
      }
      const reportId = String(body.report_id || body.id || "");
      const status = String(body.status || "reviewed").toLowerCase();
      if (!reportId) return json(400, { error: "report_id is required." });
      const { data, error } = await client.rpc("florist_community_moderate_report", {
        p_report_id: reportId,
        p_status: status,
      });
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        const msg = String(error.message || "");
        if (/Not authorized|42501/i.test(msg)) return json(403, { error: "Not authorized." });
        if (/not found|P0002/i.test(msg)) return json(404, { error: "Report not found." });
        throw error;
      }
      await auditPlatformModeration(user.id, null, "community_moderate_report", {
        report_id: reportId,
        status: data?.status || status,
      });
      return json(200, { ok: true, status: data?.status || status });
    }

    if (action === "generate_recipe") {
      requireParticipant(ctx);
      const postId = String(body.post_id || "");
      if (!postId) return json(400, { error: "post_id is required." });
      const post = await requireOwnPostWithImage(client, user.id, postId);
      const wasPublished = post.recipe_status === "published";
      const publishedRecipeId = post.published_recipe_id || null;
      let draft;
      let lilySource = "cloudflare";
      let visionText = "";
      let imageSource = "none";
      if (post.image_path) {
        try {
          const signedHint = String(body.image_url || "").trim();
          const clientDataUrl = String(body.image_data_url || "").trim();
          const resolved = await resolveCommunityImageForVision(client, post.image_path, {
            adminClient: communityStorageClient(),
            signedUrlHint: signedHint,
            clientDataUrl,
            createSignedUrl: async (path) => {
              const signed = await signedImageUrl(client, path);
              return signed.url;
            },
            adminSignedUrl: adminSignedImageUrl,
          });
          if (resolved?.payload) {
            imageSource = resolved.source;
            const vision = await analyzeArrangementPhoto(resolved.payload, { caption: post.caption });
            visionText = vision?.text || "";
          } else {
            console.warn(
              JSON.stringify({
                level: "warn",
                message: "community_recipe_image_missing",
                post_id: postId,
              })
            );
          }
        } catch (visionError) {
          console.warn(
            JSON.stringify({
              level: "warn",
              message: "community_recipe_vision_degraded",
              image_source: imageSource,
              detail: String(visionError?.message || visionError).slice(0, 200),
            })
          );
        }
      }
      const generated = await generateRecipeWithCloudflare(runCloudflareGenerate, {
        caption: post.caption,
        body: post.body,
        category: post.category,
        post_id: postId,
        has_arrangement_photo: true,
        note: "Estimate realistic stem counts florists can copy. No customer or order data.",
      }, {
        visionText,
        onCloudError: (error) => {
          console.warn(
            JSON.stringify({
              level: "warn",
              message: "community_recipe_cloudflare_degraded",
              detail: String(error?.message || error).slice(0, 200),
            })
          );
        },
      });
      draft = generated.draft;
      if (draft) lilySource = generated.source;
      if (!draft) {
        draft = buildLocalRecipeDraftFromPost(post, { visionText, hadPhoto: true });
        lilySource = visionText ? "local_vision_fallback" : "local_fallback";
      }
      if (!draft?.recipe?.length) {
        const noCloud = !cloudflareAiToken();
        return json(502, {
          error: visionText
            ? "Lily could not turn the photo read into a recipe. Add flower names to the caption and try again."
            : noCloud
              ? "Photo vision needs Cloud AI in Netlify (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_API_TOKEN). Add flower names to the caption and retry."
              : "Lily could not download or read this photo. Pull to refresh, then retry — or name the flowers in the caption.",
          vision_configured: !noCloud,
          image_resolved: imageSource !== "none",
        });
      }
      const sanitized = sanitizeRecipeDraft(draft) || draft;
      if (wasPublished && publishedRecipeId) {
        const { error: recipeUpdateError } = await client
          .from("florist_community_recipes")
          .update({
            title: sanitized.name,
            description: sanitized.description,
            category: sanitized.category,
            recipe: sanitized.recipe,
            instructions: sanitized.instructions,
            suggested_retail: sanitized.suggested_retail,
            updated_at: new Date().toISOString(),
          })
          .eq("id", publishedRecipeId)
          .eq("author_user_id", user.id);
        if (recipeUpdateError) {
          if (missingRelation(recipeUpdateError)) friendlyMissing();
          throw recipeUpdateError;
        }
      }
      const { data, error } = await client
        .from("florist_community_posts")
        .update({
          recipe_draft: sanitized,
          recipe_status: wasPublished ? "published" : "draft",
          updated_at: new Date().toISOString(),
        })
        .eq("id", postId)
        .eq("author_user_id", user.id)
        .select(POST_COLUMNS)
        .single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      const signed = await signedImageUrl(client, data.image_path);
      let publishedRecipe = null;
      if (wasPublished && publishedRecipeId) {
        const { data: recipeRow, error: recipeReadError } = await client
          .from("florist_community_recipes")
          .select(RECIPE_COLUMNS)
          .eq("id", publishedRecipeId)
          .maybeSingle();
        if (recipeReadError) {
          if (missingRelation(recipeReadError)) friendlyMissing();
          throw recipeReadError;
        }
        publishedRecipe = recipeRow ? publicRecipeSummary(recipeRow, { imageUrl: signed.url }) : null;
      }
      return json(200, {
        recipe_draft: sanitized,
        lily_source: lilySource,
        rebuilt_published: Boolean(wasPublished && publishedRecipe),
        item: publicPost(data, {
          isMine: true,
          imageUrl: signed.url,
          imageExpiresIn: signed.expiresIn,
          publishedRecipe,
        }),
      });
    }

    if (action === "save_recipe_draft") {
      requireParticipant(ctx);
      const postId = String(body.post_id || "");
      if (!postId) return json(400, { error: "post_id is required." });
      await requireOwnPostWithImage(client, user.id, postId);
      const draft = sanitizeRecipeDraft(body.recipe_draft || body.recipe);
      if (!draft) return json(400, { error: "Recipe needs a title and at least one stem line." });
      const { data, error } = await client
        .from("florist_community_posts")
        .update({
          recipe_draft: draft,
          recipe_status: "draft",
          updated_at: new Date().toISOString(),
        })
        .eq("id", postId)
        .eq("author_user_id", user.id)
        .select(POST_COLUMNS)
        .single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, { recipe_draft: draft, recipe_status: data.recipe_status });
    }

    if (action === "publish_recipe") {
      requireParticipant(ctx);
      const postId = String(body.post_id || "");
      if (!postId) return json(400, { error: "post_id is required." });
      const post = await requireOwnPostWithImage(client, user.id, postId);
      const draft = sanitizeRecipeDraft(body.recipe_draft || post.recipe_draft);
      if (!draft) return json(400, { error: "Save a recipe draft before publishing." });
      const insert = {
        post_id: postId,
        author_user_id: user.id,
        author_shop_id: shopId,
        title: draft.name,
        description: draft.description,
        category: draft.category,
        recipe: draft.recipe,
        instructions: draft.instructions,
        suggested_retail: draft.suggested_retail,
        image_path: post.image_path,
        status: "active",
        updated_at: new Date().toISOString(),
      };
      const { data: recipeRow, error: ie } = await client
        .from("florist_community_recipes")
        .insert(insert)
        .select(RECIPE_COLUMNS)
        .single();
      if (ie) {
        if (missingRelation(ie)) friendlyMissing();
        throw ie;
      }
      const { data, error } = await client
        .from("florist_community_posts")
        .update({
          recipe_draft: draft,
          recipe_status: "published",
          published_recipe_id: recipeRow.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", postId)
        .eq("author_user_id", user.id)
        .select(POST_COLUMNS)
        .single();
      if (error) throw error;
      const signed = await signedImageUrl(client, data.image_path);
      const publishedRecipe = publicRecipeSummary(recipeRow, { imageUrl: signed.url });
      return json(201, {
        published_recipe: publishedRecipe,
        item: publicPost(data, {
          isMine: true,
          imageUrl: signed.url,
          imageExpiresIn: signed.expiresIn,
          publishedRecipe,
        }),
      });
    }

    if (action === "import_recipe_to_shop") {
      requireParticipant(ctx);
      const recipeId = String(body.recipe_id || "");
      if (!recipeId) return json(400, { error: "recipe_id is required." });
      const { data: recipe, error: re } = await client
        .from("florist_community_recipes")
        .select(RECIPE_COLUMNS)
        .eq("id", recipeId)
        .eq("status", "active")
        .maybeSingle();
      if (re) {
        if (missingRelation(re)) friendlyMissing();
        throw re;
      }
      if (!recipe) return json(404, { error: "Recipe not found." });
      const isOwnRecipe = recipe.author_user_id === user.id;
      if (!isOwnRecipe) {
        // The creator's explicit ceiling gates shop import too — fetched
        // fresh via the recipe's own post link rather than trusted from
        // the client. A recipe whose post was deleted (post_id null) has
        // no permission to check, so it fails closed rather than assuming
        // it's fine, matching this file's existing fail-closed pattern.
        let sharePermission = null;
        if (recipe.post_id) {
          const { data: linkedPost, error: lpErr } = await client
            .from("florist_community_posts")
            .select("share_permission")
            .eq("id", recipe.post_id)
            .maybeSingle();
          if (lpErr) throw lpErr;
          sharePermission = linkedPost?.share_permission || null;
        }
        if (!permissionAtLeast(sharePermission, "allow_shop_use")) {
          return json(403, {
            error: "The florist who shared this recipe hasn't allowed it to be added to another shop yet.",
          });
        }
      }
      const draft = sanitizeRecipeDraft({
        name: recipe.title,
        description: recipe.description,
        category: recipe.category,
        suggested_retail: recipe.suggested_retail,
        recipe: recipe.recipe,
        instructions: recipe.instructions,
      });
      if (!draft) return json(400, { error: "This recipe cannot be imported." });
      const productPayload = {
        shop_id: shopId,
        name: draft.name,
        category: draft.category || "Everyday",
        description: draft.description || "",
        price: draft.suggested_retail || 0,
        image_url: "",
        active: true,
        featured: false,
        available_online: true,
      };
      const { data: product, error: pe } = await client
        .from("products")
        .insert(productPayload)
        .select("id,name")
        .single();
      if (pe) throw pe;
      // Community Step 67 — compare against the *importing* shop's own
      // inventory (real wholesale costs they've already entered) instead
      // of inserting unit_cost: 0 for every ingredient regardless of
      // whether the shop already stocks it.
      const { data: shopInventory, error: invErr } = await client
        .from("inventory")
        .select("id,name,cost")
        .eq("shop_id", shopId)
        .is("deleted_at", null);
      if (invErr) throw invErr;
      const costMatch = matchRecipeToInventory(draft.recipe, shopInventory || []);
      if (costMatch.recipe.length) {
        const rows = costMatch.recipe.map((x) => ({
          shop_id: shopId,
          product_id: product.id,
          inventory_id: x.matched_inventory_id,
          ingredient_name: x.name,
          quantity: x.qty,
          unit: "stem",
          unit_cost: x.unit_cost,
        }));
        const { error: recipeErr } = await client.from("product_recipes").insert(rows);
        if (recipeErr) throw recipeErr;
      }
      const svc = adminIfConfigured();
      if (svc) {
        try {
          const { data: current } = await svc
            .from("florist_community_recipes")
            .select("import_count")
            .eq("id", recipeId)
            .maybeSingle();
          await svc
            .from("florist_community_recipes")
            .update({
              import_count: Number(current?.import_count || 0) + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", recipeId);
        } catch {
          /* non-blocking */
        }
      }
      const costMessage =
        costMatch.matchedCount > 0
          ? ` Matched ${costMatch.matchedCount} of ${costMatch.totalCount} ingredients to your own inventory — estimated cost $${costMatch.estimatedCost.toFixed(2)}.${costMatch.unmatchedNames.length ? ` Add ${costMatch.unmatchedNames.join(", ")} to Inventory for full costing.` : ""}`
          : costMatch.totalCount > 0
            ? ` None of the ${costMatch.totalCount} ingredients matched your inventory yet — add them there for real costing.`
            : "";
      return json(201, {
        ok: true,
        product_id: product.id,
        product_name: product.name,
        cost_match: costMatch,
        message: `${product.name} was added to Products & Recipe Builder.${costMessage}`,
      });
    }

    // "Add to my library" — one click on any post's photo saves it as a
    // draft product in the caller's own Floral Library/Products, ready to
    // price and publish. Deliberately not gated behind Lily's recipe
    // build (import_recipe_to_shop above) — a florist should be able to
    // grab a photo they like for inspiration without waiting on that.
    if (action === "save_post_to_library") {
      requireParticipant(ctx);
      const postId = String(body.post_id || "");
      if (!postId) return json(400, { error: "post_id is required." });
      const { data: post, error: postErr } = await client
        .from("florist_community_posts")
        .select(POST_COLUMNS)
        .eq("id", postId)
        .eq("status", "active")
        .maybeSingle();
      if (postErr) {
        if (missingRelation(postErr)) friendlyMissing();
        throw postErr;
      }
      if (!post) return json(404, { error: "Post not found." });
      if (!post.image_path) return json(400, { error: "This post doesn't have a photo to save." });
      const isOwnPost = post.author_user_id === user.id;
      // The creator's explicit ceiling — saving your own post never needs
      // permission, but another florist's post is gated on what they
      // allowed. "Never assume commercial permission."
      if (!isOwnPost && !permissionAtLeast(post.share_permission, "save_to_library")) {
        return json(403, {
          error: "The florist who shared this marked it inspiration-only — you can view it, but it can't be saved to your library.",
        });
      }
      const imageDataUrl = String(body.image_data_url || "").trim();
      if (!imageDataUrl.startsWith("data:image/")) {
        return json(400, { error: "Could not read that photo. Try again." });
      }
      const name = String(post.caption || "Community arrangement").slice(0, 120);
      // Design permission (checked above) never implies photo permission —
      // those are separate creator choices. Only carry the original
      // photograph over when the creator explicitly allowed photo reuse,
      // or it's the florist's own post.
      const usePhoto = isOwnPost || Boolean(post.allow_photo_use);
      const productPayload = {
        shop_id: shopId,
        name,
        // Community post categories (Design Help, Questions, …) aren't
        // product categories, so this always lands in a safe default —
        // the florist can recategorize when they price/publish it.
        category: "Everyday",
        description: String(post.body || `Saved from Florist Community: ${name}`).slice(0, 2000),
        image_url: usePhoto ? imageDataUrl : "",
        price: 0,
        active: false,
        featured: false,
        available_online: false,
      };
      const { data: product, error: pe } = await client
        .from("products")
        .insert(productPayload)
        .select("id,name")
        .single();
      if (pe) throw pe;
      return json(201, {
        ok: true,
        product_id: product.id,
        product_name: product.name,
        message: usePhoto
          ? `${product.name} was saved to your Floral Library — price and publish it any time in Products.`
          : `${product.name} was saved to your Floral Library. The original photo isn't licensed for your shop — photograph your own version in Photo Studio, then attach it before publishing.`,
      });
    }

    return json(400, { error: "Unknown community action." });
  } catch (error) {
    return fail(error);
  }
}
