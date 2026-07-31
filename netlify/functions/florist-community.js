import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { isFeatureEnabled } from "./_shared/feature-flags.js";
import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_GUIDELINES,
  COMMUNITY_IMAGE_BUCKET,
  validateProfileBody,
  validatePostBody,
  validateCommentBody,
  validateReportBody,
  validateCommunityImageUpload,
  parseDataUrl,
  publicProfile,
  publicPost,
  publicComment,
  communityImagePath,
  communityImagePublicUrl,
  canEditOwnContent,
  assertCommunitySafePayload,
} from "./_shared/florist-community.js";

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
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("could not find the table")
  );
}

function friendlyMissing() {
  const e = new Error(
    "Florist Community tables are not set up yet. Apply migration 20260731_florist_community_beta_v1.sql, then try again."
  );
  e.statusCode = 503;
  e.code = "community_not_migrated";
  throw e;
}

async function isPlatformAdmin(client, userId) {
  try {
    const { data, error } = await client
      .from("platform_admins")
      .select("user_id,active")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      if (missingRelation(error)) return false;
      throw error;
    }
    return Boolean(data && data.active !== false);
  } catch {
    return false;
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
  const display =
    String(ctx.user.user_metadata?.full_name || ctx.user.email?.split("@")[0] || "Florist").slice(0, 80);
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

async function uploadCommunityImage(client, shopId, userId, dataUrl) {
  if (!dataUrl) return { ok: true, path: null };
  const validation = validateCommunityImageUpload({ dataUrl });
  if (!validation.valid) return { ok: false, error: validation.error };
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return { ok: false, error: "Invalid image encoding." };
  const path = communityImagePath(shopId, userId, parsed.mime);
  const { error } = await client.storage
    .from(COMMUNITY_IMAGE_BUCKET)
    .upload(path, parsed.buffer, { contentType: parsed.mime, upsert: false });
  if (error) return { ok: false, error: error.message || "Image upload failed." };
  return { ok: true, path };
}

function imageUrlFor(path) {
  return communityImagePublicUrl(process.env.SUPABASE_URL, path);
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
  return withAuthors.map((p) =>
    publicPost(p, {
      liked: liked.has(p.id),
      isMine: p.author_user_id === ctx.user.id,
      canModerate: moderatorForPost(ctx, p, platformAdmin),
      imageUrl: imageUrlFor(p.image_path),
    })
  );
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  try {
    featureGate();
    // Any active shop member may use Community; shop_id comes from JWT membership.
    const ctx = await currentUser(event);
    const { client, shopId, user } = ctx;
    const platformAdmin = await isPlatformAdmin(client, user.id);
    const method = event.httpMethod;

    if (method === "GET") {
      const action = String(event.queryStringParameters?.action || "feed").toLowerCase();
      if (action === "meta") {
        return json(
          200,
          assertCommunitySafePayload({
            beta: true,
            categories: COMMUNITY_CATEGORIES,
            guidelines: COMMUNITY_GUIDELINES,
            image_max_bytes: 2 * 1024 * 1024,
            can_moderate_platform: platformAdmin,
          })
        );
      }
      if (action === "profile") {
        const profile = await ensureDefaultProfile(client, ctx);
        return json(200, { profile: publicProfile(profile), guidelines: COMMUNITY_GUIDELINES });
      }
      if (action === "comments") {
        const postId = String(event.queryStringParameters?.post_id || "");
        if (!postId) return json(400, { error: "post_id is required." });
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
        const withAuthors = await attachAuthors(
          client,
          (data || []).map((c) => ({ ...c, author_user_id: c.author_user_id }))
        );
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
      if (action === "moderation" && platformAdmin) {
        const { data: reports, error } = await client
          .from("florist_community_reports")
          .select("id,post_id,reason,status,created_at,reporter_user_id")
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) throw error;
        return json(200, assertCommunitySafePayload({ reports: reports || [] }));
      }
      const category = event.queryStringParameters?.category || "";
      const items = await feed(client, ctx, { category, platformAdmin });
      const profile = await ensureDefaultProfile(client, ctx);
      return json(
        200,
        assertCommunitySafePayload({
          beta: true,
          profile: publicProfile(profile),
          guidelines: COMMUNITY_GUIDELINES,
          categories: COMMUNITY_CATEGORIES,
          items,
        })
      );
    }

    if (method !== "POST") return methodNotAllowed();
    const body = bodyOf(event);
    const action = String(body.action || "").toLowerCase();

    if (action === "save_profile") {
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
      await ensureDefaultProfile(client, ctx);
      const v = validatePostBody(body);
      if (!v.valid) return json(400, { error: v.errors.join(" ") });
      let imagePath = null;
      if (body.image_data_url) {
        const up = await uploadCommunityImage(client, shopId, user.id, body.image_data_url);
        if (!up.ok) return json(400, { error: up.error });
        imagePath = up.path;
      }
      const insert = {
        author_user_id: user.id,
        shop_id: shopId,
        category: v.sanitized.category,
        caption: v.sanitized.caption,
        body: v.sanitized.body,
        image_path: imagePath,
        status: "active",
      };
      const { data, error } = await client
        .from("florist_community_posts")
        .insert(insert)
        .select(
          "id,author_user_id,shop_id,category,caption,body,image_path,status,like_count,comment_count,created_at,updated_at"
        )
        .single();
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      const profile = await loadProfile(client, user.id);
      return json(201, {
        item: publicPost(
          { ...data, author: profile },
          {
            isMine: true,
            canModerate: true,
            imageUrl: imageUrlFor(data.image_path),
          }
        ),
      });
    }

    if (action === "update_post") {
      const id = String(body.id || "");
      if (!id) return json(400, { error: "Post id is required." });
      const { data: existing, error: ge } = await client
        .from("florist_community_posts")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (ge) throw ge;
      if (!existing) return json(404, { error: "Post not found." });
      if (!canEditOwnContent({ userId: user.id, authorUserId: existing.author_user_id })) {
        return json(403, { error: "You can only edit your own posts." });
      }
      const v = validatePostBody({
        category: body.category ?? existing.category,
        caption: body.caption ?? existing.caption,
        body: body.body ?? existing.body,
      });
      if (!v.valid) return json(400, { error: v.errors.join(" ") });
      const patch = {
        category: v.sanitized.category,
        caption: v.sanitized.caption,
        body: v.sanitized.body,
        updated_at: new Date().toISOString(),
      };
      if (body.image_data_url) {
        const up = await uploadCommunityImage(client, shopId, user.id, body.image_data_url);
        if (!up.ok) return json(400, { error: up.error });
        patch.image_path = up.path;
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
      if (error) throw error;
      return json(200, {
        item: publicPost(
          { ...data, author: await loadProfile(client, user.id) },
          { isMine: true, imageUrl: imageUrlFor(data.image_path) }
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
      if (mine) {
        const { error } = await client
          .from("florist_community_posts")
          .delete()
          .eq("id", id)
          .eq("author_user_id", user.id);
        if (error) throw error;
      } else {
        const { error } = await client
          .from("florist_community_posts")
          .update({ status: "removed", updated_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
      }
      return json(200, { ok: true });
    }

    if (action === "toggle_like") {
      const postId = String(body.post_id || "");
      if (!postId) return json(400, { error: "post_id is required." });
      const { data: existing } = await client
        .from("florist_community_likes")
        .select("post_id")
        .eq("post_id", postId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (existing) {
        const { error } = await client
          .from("florist_community_likes")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", user.id);
        if (error) throw error;
        await client.rpc("florist_community_adjust_like_count", { p_post_id: postId, p_delta: -1 }).then(
          () => {},
          async () => {
            const { data: post } = await client
              .from("florist_community_posts")
              .select("like_count")
              .eq("id", postId)
              .maybeSingle();
            if (post) {
              await client
                .from("florist_community_posts")
                .update({ like_count: Math.max(0, Number(post.like_count || 0) - 1) })
                .eq("id", postId);
            }
          }
        );
        return json(200, { liked: false });
      }
      const { error } = await client.from("florist_community_likes").insert({
        post_id: postId,
        user_id: user.id,
        shop_id: shopId,
      });
      if (error) throw error;
      const { data: post } = await client
        .from("florist_community_posts")
        .select("like_count")
        .eq("id", postId)
        .maybeSingle();
      if (post) {
        await client
          .from("florist_community_posts")
          .update({ like_count: Number(post.like_count || 0) + 1 })
          .eq("id", postId);
      }
      return json(200, { liked: true });
    }

    if (action === "add_comment") {
      const postId = String(body.post_id || "");
      const v = validateCommentBody(body);
      if (!postId) return json(400, { error: "post_id is required." });
      if (!v.valid) return json(400, { error: v.errors.join(" ") });
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
      const { data: post } = await client
        .from("florist_community_posts")
        .select("comment_count")
        .eq("id", postId)
        .maybeSingle();
      if (post) {
        await client
          .from("florist_community_posts")
          .update({ comment_count: Number(post.comment_count || 0) + 1 })
          .eq("id", postId);
      }
      const profile = await loadProfile(client, user.id);
      return json(201, {
        item: publicComment(
          { ...data, author: profile },
          { isMine: true }
        ),
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
      if (mine) {
        const { error } = await client
          .from("florist_community_comments")
          .delete()
          .eq("id", id)
          .eq("author_user_id", user.id);
        if (error) throw error;
      } else {
        const { error } = await client
          .from("florist_community_comments")
          .update({ status: "removed", updated_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
      }
      const { data: post } = await client
        .from("florist_community_posts")
        .select("comment_count")
        .eq("id", existing.post_id)
        .maybeSingle();
      if (post) {
        await client
          .from("florist_community_posts")
          .update({ comment_count: Math.max(0, Number(post.comment_count || 0) - 1) })
          .eq("id", existing.post_id);
      }
      return json(200, { ok: true });
    }

    if (action === "report_post") {
      const postId = String(body.post_id || "");
      const v = validateReportBody(body);
      if (!postId) return json(400, { error: "post_id is required." });
      if (!v.valid) return json(400, { error: v.errors.join(" ") });
      const { error } = await client.from("florist_community_reports").upsert(
        {
          post_id: postId,
          reporter_user_id: user.id,
          reporter_shop_id: shopId,
          reason: v.sanitized.reason,
          status: "open",
        },
        { onConflict: "post_id,reporter_user_id" }
      );
      if (error) {
        if (missingRelation(error)) friendlyMissing();
        throw error;
      }
      return json(200, { ok: true, message: "Thanks — moderators will review this post." });
    }

    if (action === "moderate_hide" || action === "moderate_remove") {
      const id = String(body.id || body.post_id || "");
      if (!id) return json(400, { error: "Post id is required." });
      const { data: existing, error: ge } = await client
        .from("florist_community_posts")
        .select("id,shop_id,author_user_id,status")
        .eq("id", id)
        .maybeSingle();
      if (ge) throw ge;
      if (!existing) return json(404, { error: "Post not found." });
      if (!moderatorForPost(ctx, existing, platformAdmin)) {
        return json(403, { error: "Moderation requires a shop manager for this shop or a platform admin." });
      }
      const status = action === "moderate_remove" ? "removed" : "hidden";
      const { error } = await client
        .from("florist_community_posts")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      if (platformAdmin && body.report_id) {
        await client
          .from("florist_community_reports")
          .update({ status: "reviewed" })
          .eq("id", body.report_id);
      }
      return json(200, { ok: true, status });
    }

    return json(400, { error: "Unknown community action." });
  } catch (error) {
    return fail(error);
  }
}
