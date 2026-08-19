/**
 * Platform Library Photo Manager — lets a Florisyn platform admin add real
 * photos (Floral Library items, Website Studio hero photos) from the admin
 * console, stored in Supabase (platform-library-media bucket +
 * platform_library_photos table — see the matching migration), instead of
 * a developer editing static files and pushing a deploy.
 *
 * Mirrors the upload pattern already used for Website Studio's own media
 * library (website-media.js): parseDataUrl → validate → upload → return path.
 */
import { parseDataUrl } from "./upload-validation.js";

export const PLATFORM_LIBRARY_MEDIA_BUCKET = "platform-library-media";
export const PLATFORM_LIBRARY_MEDIA_MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MIME_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export const PHOTO_CONTEXTS = new Set(["floral_library", "website_hero"]);

export function validatePlatformLibraryPhotoUpload({ dataUrl } = {}) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return { valid: false, error: "Invalid image encoding." };
  if (!ALLOWED_MIMES.has(parsed.mime)) {
    return { valid: false, error: "Images must be JPEG, PNG, WebP, or GIF." };
  }
  if (!parsed.buffer.length) return { valid: false, error: "Image file is empty." };
  if (parsed.buffer.length > PLATFORM_LIBRARY_MEDIA_MAX_BYTES) {
    return { valid: false, error: `Images must be under ${PLATFORM_LIBRARY_MEDIA_MAX_BYTES / (1024 * 1024)} MB.` };
  }
  return { valid: true, mime: parsed.mime, buffer: parsed.buffer };
}

/** Validates the non-image fields of a photo row before insert/update. */
export function validatePlatformLibraryPhotoFields(body = {}) {
  const errors = [];
  const context = String(body.context || "");
  if (!PHOTO_CONTEXTS.has(context)) errors.push('context must be "floral_library" or "website_hero".');
  if (!String(body.name || "").trim()) errors.push("Name is required.");
  if (!String(body.category || "").trim()) errors.push("Category is required.");
  if (!String(body.alt_text || "").trim()) errors.push("Alt text is required for accessibility.");

  let suggested_retail = null;
  if (context === "floral_library") {
    suggested_retail = Number(body.suggested_retail);
    if (!Number.isFinite(suggested_retail) || suggested_retail <= 0) {
      errors.push("Floral Library items need a positive price.");
    }
  }

  let recipe = [];
  if (body.recipe != null) {
    if (!Array.isArray(body.recipe)) {
      errors.push("Recipe must be a list of ingredient lines.");
    } else {
      recipe = body.recipe
        .map((r) => ({ name: String(r?.name || "").trim(), qty: Number(r?.qty) }))
        .filter((r) => r.name);
      for (const r of recipe) {
        if (!Number.isFinite(r.qty) || r.qty <= 0) errors.push(`Recipe line "${r.name}" needs a positive quantity.`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    fields: {
      context,
      name: String(body.name || "").trim().slice(0, 200),
      category: String(body.category || "").trim().slice(0, 80),
      short_description: String(body.short_description || "").trim().slice(0, 200) || null,
      description: String(body.description || "").trim().slice(0, 2000) || null,
      alt_text: String(body.alt_text || "").trim().slice(0, 300),
      recipe,
      suggested_retail
    }
  };
}

export async function uploadPlatformLibraryPhoto(client, context, { dataUrl, filename } = {}) {
  const validation = validatePlatformLibraryPhotoUpload({ dataUrl });
  if (!validation.valid) return { ok: false, error: validation.error };
  const ext = MIME_EXT[validation.mime] || "jpg";
  const path = `platform/${context}/${crypto.randomUUID()}.${ext}`;
  const { error } = await client.storage
    .from(PLATFORM_LIBRARY_MEDIA_BUCKET)
    .upload(path, validation.buffer, { contentType: validation.mime, upsert: false });
  if (error) return { ok: false, error: error.message || "Image upload failed." };
  return {
    ok: true,
    path,
    mime: validation.mime,
    sizeBytes: validation.buffer.length,
    filename: String(filename || "image").slice(0, 120)
  };
}

export function publicPlatformLibraryPhotoUrl(client, path) {
  const { data } = client.storage.from(PLATFORM_LIBRARY_MEDIA_BUCKET).getPublicUrl(path);
  return data?.publicUrl || null;
}

export async function deletePlatformLibraryPhotoFile(client, path) {
  if (!path) return { ok: true };
  const { error } = await client.storage.from(PLATFORM_LIBRARY_MEDIA_BUCKET).remove([path]);
  if (error) return { ok: false, error: error.message || "Image delete failed." };
  return { ok: true };
}

const ULTRA_REALISTIC_IMAGE_STANDARD = "ultra_realistic_professional_floral_photography";

/** Maps a platform_library_photos row (context=floral_library) into the
 * same product shape getPublicFloralLibraryCatalog() returns, so it can be
 * merged into the Floral Library catalog seamlessly. */
export function libraryPhotoRowToProduct(row, imageUrl) {
  const retail = Number(row.suggested_retail) || 0;
  return {
    id: `admin-${row.id}`,
    scope: "master",
    source: "platform_admin",
    name: row.name,
    categories: [row.category],
    arrangement_type: "bouquet",
    short_description: row.short_description,
    description: row.description,
    suggested_retail: {
      default: retail,
      min: Math.round(retail * 0.9 * 100) / 100,
      max: Math.round(retail * 1.2 * 100) / 100
    },
    suggested_cost: Math.round(retail * 0.42 * 100) / 100,
    primary_image: { url: imageUrl, alt: row.alt_text, hash: row.id },
    image_license: { source: "bloom_owned", attribution: "Provided by the Florisyn platform owner", review_status: "approved" },
    recipe: row.recipe || [],
    publish_status: "published",
    tags: ["admin_uploaded", "ultra_realistic"],
    metadata: {
      image_standard: ULTRA_REALISTIC_IMAGE_STANDARD,
      launch_quality: "everyday_verified",
      replaceable_by_shop: true
    }
  };
}

/** Maps a platform_library_photos row (context=website_hero) into the shape
 * the Website Studio hero picker's dynamic-photo loader expects. */
export function heroPhotoRowToPickerEntry(row, imageUrl) {
  return { id: `admin-${row.id}`, category: row.category, name: row.name, url: imageUrl };
}

/**
 * Shared read path for admin-uploaded photos, used by both
 * admin-photo-manager.js's public_list action and floral-library.js's
 * starter merge — one query implementation so the two can't drift.
 * Degrades to an empty list rather than throwing: this is additive
 * content on top of the static catalog, never something that should be
 * able to take the whole Floral Library / hero picker down.
 */
export async function fetchAdminLibraryPhotos(client, context) {
  if (!PHOTO_CONTEXTS.has(context)) return [];
  try {
    const { data, error } = await client
      .from("platform_library_photos")
      .select("*")
      .eq("context", context)
      .order("created_at", { ascending: false });
    if (error || !data) return [];
    return data.map((row) => {
      const url = publicPlatformLibraryPhotoUrl(client, row.image_path);
      return context === "floral_library" ? libraryPhotoRowToProduct(row, url) : heroPhotoRowToPickerEntry(row, url);
    });
  } catch {
    return [];
  }
}
