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
  validatePostBody,
  validateCommentBody,
  validateReportBody,
  publicProfile,
  publicPost,
  publicComment,
  canEditOwnContent,
  assertCommunitySafePayload,
  isStoragePath,
} from "./_shared/florist-community.js";
import {
  uploadPrevalidatedCommunityImage,
  removeCommunityImageQuietly,
  reconcileCommunityImageAfterWriteError,
} from "./_shared/florist-community-storage.js";

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
    const e = new Error("Unable to verify platform admin authorization.");
    e.statusCode = 503;
    e.code = "community_admin_check_failed";
    throw e;
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

async function loadProfile(client, userId) {
  const { data, error } = await client
    .from("florist_community_profiles")
    .select("user_id,shop_id,display_name,shop_display_name,city,region,bio,updated_at")
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
    .select("user_id,shop_id,display_name,shop_display_name,city,region,bio,updated_at")
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
    .select("user_id,shop_id,display_name,shop_display_name,city,region,bio,updated_at")
    .in("user_id", ids);
  if (error) throw error;
  const map = new Map((data || []).map((p) => [p.user_id, p]));
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

async function feed(client, ctx, { category, platformAdmin }) {
  let query = client
    .from("florist_community_posts")
    .select(
      "id,author_user_id,shop_id,category,caption,body,image_path,status,like_count,comment_count,created_at,updated_at"
    )
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(50);
  if (category && COMMUNITY_CATEGORIES.includes(category)) {
    query = query.eq("category", category);
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
  return Promise.all(
    withAuthors.map(async (p) => {
      const signed = await signedImageUrl(client, p.image_path);
      return publicPost(p, {
        liked: liked.has(p.id),
        isMine: p.author_user_id === ctx.user.id,
        canModerate: moderatorForPost(ctx, p, platformAdmin),
        imageUrl: signed.url,
        imageExpiresIn: signed.expiresIn,
      });
    })
  );
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
        return json(200, { profile: publicProfile(profile), guidelines: COMMUNITY_GUIDELINES });
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
      const items = await feed(client, ctx, { category, platformAdmin });
      const profile = await ensureDefaultProfile(client, ctx);
      return json(
        200,
        assertCommunitySafePayload({
          beta: true,
          enabled: true,
          profile: publicProfile(profile),
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
      const payload = {
        user_id: user.id,
        shop_id: shopId,
        ...v.sanitized,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await client
        .from("florist_community_profiles")
        .upsert(payload, { onConflict: "user_id" })
        .select("user_id,shop_id,display_name,shop_display_name,city,region,bio,updated_at")
        .single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, { profile: publicProfile(data) });
    }

    if (action === "create_post") {
      requireParticipant(ctx);
      await ensureDefaultProfile(client, ctx);
      const v = await validatePostBody(body);
      if (!v.valid) return json(400, { error: v.errors.join(" ") });
      let imagePath = null;
      let uploadedPath = null;
      if (v.image) {
        const up = await uploadPrevalidatedCommunityImage(client, shopId, user.id, v.image);
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
        .select("id,author_user_id,shop_id,category,caption,body,image_path,status")
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
      });
      if (!v.valid) return json(400, { error: v.errors.join(" ") });
      // Only editable content fields — never counters/status/ownership
      const patch = {
        category: v.sanitized.category,
        caption: v.sanitized.caption,
        body: v.sanitized.body,
        updated_at: new Date().toISOString(),
      };
      let uploadedPath = null;
      const previousPath = existing.image_path || null;
      if (v.image) {
        const up = await uploadPrevalidatedCommunityImage(client, shopId, user.id, v.image);
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
      await requireActivePost(client, postId);
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

    return json(400, { error: "Unknown community action." });
  } catch (error) {
    return fail(error);
  }
}
