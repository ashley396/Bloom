import { json, methodNotAllowed } from "./_shared/http.js";
import {
  platformAdmin,
  requireSuperAdmin,
  platformAdminErrorResponse,
  parsePlatformAdminJsonBody,
  writeCommandAudit
} from "./_shared/platform-admin.js";
import { admin as createServiceRoleClient } from "./_shared/supabase.js";
import {
  PHOTO_CONTEXTS,
  validatePlatformLibraryPhotoFields,
  uploadPlatformLibraryPhoto,
  publicPlatformLibraryPhotoUrl,
  deletePlatformLibraryPhotoFile,
  fetchAdminLibraryPhotos
} from "./_shared/platform-library-photos.js";

const TABLE = "platform_library_photos";

function rowWithUrl(client, row) {
  return { ...row, image_url: publicPlatformLibraryPhotoUrl(client, row.image_path) };
}

/**
 * The publicly-fetchable side of this function — no admin auth. Read-only,
 * returns only fields safe for any visitor: the same content florists
 * already see baked into the static Floral Library / Website Studio hero
 * picker, just sourced from admin uploads instead. Uses the service-role
 * client because platform_library_photos has no browser-facing RLS
 * policies (see the migration) — same reasoning as every other public
 * catalog read in this codebase (e.g. floral-library.js's `starter` action).
 */
async function handlePublicList(event, deps) {
  const context = String(event.queryStringParameters?.context || "").trim();
  if (!PHOTO_CONTEXTS.has(context)) return json(400, { error: 'context must be "floral_library" or "website_hero".' });
  const buildServerClient = deps.createServerClient || createServiceRoleClient;
  let client;
  try {
    client = buildServerClient();
  } catch {
    return json(200, { items: [] }); // no server key configured yet — degrade to empty, not an error
  }
  const items = await fetchAdminLibraryPhotos(client, context);
  return json(200, { items });
}

/** Test seam — production uses bound real dependencies via exported `handler`. */
export function createAdminPhotoManagerHandler(deps = {}) {
  return async function handler(event) {
    const action = event.queryStringParameters?.action || "list";

    // The florist-facing merge and the Website Studio picker call this
    // unauthenticated — everything else on this function requires an
    // active platform admin.
    if (action === "public_list" && event.httpMethod === "GET") {
      return handlePublicList(event, deps);
    }

    try {
      const { client, user, admin } = await platformAdmin(event, ["super_admin"], deps);
      const body = parsePlatformAdminJsonBody(event);

      if (action === "list" && event.httpMethod === "GET") {
        const context = event.queryStringParameters?.context;
        let query = client.from(TABLE).select("*").order("created_at", { ascending: false });
        if (context) query = query.eq("context", context);
        const { data, error } = await query;
        if (error) throw error;
        return json(200, { items: (data || []).map((r) => rowWithUrl(client, r)) });
      }

      if (action === "upload" && event.httpMethod === "POST") {
        requireSuperAdmin(admin);
        const validation = validatePlatformLibraryPhotoFields(body);
        if (!validation.valid) return json(400, { error: validation.errors.join(" ") });

        const uploadResult = await uploadPlatformLibraryPhoto(client, validation.fields.context, {
          dataUrl: body.dataUrl,
          filename: body.filename
        });
        if (!uploadResult.ok) return json(400, { error: uploadResult.error });

        const { data, error } = await client
          .from(TABLE)
          .insert({ ...validation.fields, image_path: uploadResult.path, created_by: user.id })
          .select("*")
          .single();
        if (error) {
          await deletePlatformLibraryPhotoFile(client, uploadResult.path);
          throw error;
        }

        await writeCommandAudit(client, user.id, "admin_photo_uploaded", {
          targetType: "platform_library_photo",
          targetId: data.id,
          context: data.context,
          name: data.name
        });
        return json(201, { item: rowWithUrl(client, data) });
      }

      if (action === "update" && event.httpMethod === "POST") {
        requireSuperAdmin(admin);
        if (!body.id) return json(400, { error: "id is required." });
        const validation = validatePlatformLibraryPhotoFields({ ...body });
        if (!validation.valid) return json(400, { error: validation.errors.join(" ") });

        const { data, error } = await client
          .from(TABLE)
          .update({ ...validation.fields, updated_at: new Date().toISOString() })
          .eq("id", body.id)
          .select("*")
          .maybeSingle();
        if (error) throw error;
        if (!data) return json(404, { error: "Photo not found." });

        await writeCommandAudit(client, user.id, "admin_photo_updated", {
          targetType: "platform_library_photo",
          targetId: data.id
        });
        return json(200, { item: rowWithUrl(client, data) });
      }

      if (action === "delete" && event.httpMethod === "POST") {
        requireSuperAdmin(admin);
        if (!body.id) return json(400, { error: "id is required." });

        const { data: existing } = await client.from(TABLE).select("id,image_path").eq("id", body.id).maybeSingle();
        if (!existing) return json(404, { error: "Photo not found." });

        const { error } = await client.from(TABLE).delete().eq("id", body.id);
        if (error) throw error;
        await deletePlatformLibraryPhotoFile(client, existing.image_path);

        await writeCommandAudit(client, user.id, "admin_photo_deleted", {
          targetType: "platform_library_photo",
          targetId: body.id
        });
        return json(200, { ok: true });
      }

      return methodNotAllowed();
    } catch (error) {
      return platformAdminErrorResponse(event, error);
    }
  };
}

export const handler = createAdminPhotoManagerHandler();
