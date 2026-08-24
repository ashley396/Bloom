/**
 * REAL platform-transformation execution for images (Priority 4 of the
 * "as far as technically possible" pass) — the piece media-output-
 * planner.js's own header explicitly said this environment couldn't do
 * ("no ffmpeg binary, no transcoding service connected"). That was true
 * for VIDEO and remains true today (still no video-rendering provider —
 * see marketing-video-render-engine.js). It was never actually true for
 * IMAGES: `sharp` is a real dependency already used server-side in this
 * exact Netlify Functions runtime (florist-ai-vision.js's vision-image
 * preprocessing) — center-cropping and resizing a real image to a
 * platform's target aspect ratio needs no AI model and no new provider.
 *
 * This module executes exactly the CENTER_CROP strategy
 * media-output-planner.js already names and plans for — it does not
 * invent a new strategy, and AI_REFRAME (subject-aware reframing) stays
 * exactly as unimplemented as media-output-planner.js already says.
 */

import sharp from "sharp";
import { uploadWebsiteMedia, publicWebsiteMediaUrl } from "../website-media.js";
import { ASPECT_RATIO_CANVAS } from "./platform-media-specs.js";
import { persistGeneratedAsset } from "../ai-creative-engine.js";
import { planDerivedAssets } from "./media-output-planner.js";

/** Downloads a real, already-hosted image (a Florisyn website-media
 * public URL, or any http(s) URL) into a Buffer. Never trusts a
 * non-http(s) URL — this only ever reframes a real, fetchable image. */
async function fetchImageBuffer(url) {
  if (!/^https?:\/\//i.test(String(url || ""))) {
    return { ok: false, error: "Source image URL must be a real http(s) URL." };
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: `Could not fetch source image (${res.status}).` };
    const arrayBuffer = await res.arrayBuffer();
    return { ok: true, buffer: Buffer.from(arrayBuffer) };
  } catch (error) {
    return { ok: false, error: `Fetching source image failed: ${String(error?.message || error).slice(0, 200)}` };
  }
}

/**
 * Executes a real center-crop-and-resize of a source image to `aspectRatio`.
 * Returns a real derivative image (uploaded through the existing
 * website-media pipeline) — never a plan, never a metadata-only stub, for
 * the image case specifically. Video is intentionally out of scope here
 * (see module doc) — callers must not call this for a video source.
 */
export async function executeImageReframe(client, shopId, { sourceUrl, aspectRatio, filename } = {}) {
  const canvas = ASPECT_RATIO_CANVAS[aspectRatio];
  if (!canvas) return { ok: false, error: `Unknown aspect ratio "${aspectRatio}".` };

  const fetched = await fetchImageBuffer(sourceUrl);
  if (!fetched.ok) return fetched;

  let outputBuffer;
  try {
    outputBuffer = await sharp(fetched.buffer)
      .rotate() // respect EXIF orientation before cropping, same as florist-ai-vision.js
      .resize(canvas.width, canvas.height, { fit: "cover", position: "attention" })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    return { ok: false, error: `Image reframe failed: ${String(error?.message || error).slice(0, 200)}` };
  }

  const dataUrl = `data:image/jpeg;base64,${outputBuffer.toString("base64")}`;
  const uploaded = await uploadWebsiteMedia(client, shopId, { dataUrl, filename: filename || `reframe-${aspectRatio.replace(":", "x")}-${Date.now()}.jpg` });
  if (!uploaded.ok) return { ok: false, error: uploaded.error };

  return {
    ok: true,
    path: uploaded.path,
    url: publicWebsiteMediaUrl(client, uploaded.path),
    width: canvas.width,
    height: canvas.height,
    aspectRatio
  };
}

/**
 * Full pipeline: execute the reframe AND persist it as a real derived
 * `ai_generated_assets` row (transformation_type: 'reframe',
 * parent_asset_id: the master) — reuses persistGeneratedAsset rather than
 * a second insert path, and reuses the exact parent/transformation
 * columns the Aug-24 migration already added for this purpose.
 */
export async function transformImageForDestination(client, { shopId, userId, persona = "Lily", parentAssetId, sourceUrl, aspectRatio, destination } = {}) {
  // The DB's own ai_generated_assets_master_derived_consistency check
  // requires transformation_type is null OR parent_asset_id is set — a
  // derived asset row is never allowed to exist without knowing its
  // master. Enforced here too so a missing parentAssetId is a clear 400,
  // not an opaque DB constraint violation.
  if (!parentAssetId) return { ok: false, error: "transformImageForDestination requires parentAssetId — a derived variant must reference its master asset." };

  const result = await executeImageReframe(client, shopId, { sourceUrl, aspectRatio, filename: `${destination || "variant"}-${Date.now()}.jpg` });
  if (!result.ok) {
    const persisted = await persistGeneratedAsset(client, {
      shopId, userId, persona,
      assetType: "image",
      provider: "sharp",
      model: "center_crop",
      content: { destination, aspectRatio, sourceUrl },
      parentAssetId,
      transformationType: "reframe",
      status: "failed",
      error: result.error
    });
    return { ok: false, error: result.error, assetId: persisted.ok ? persisted.asset.id : null };
  }

  const persisted = await persistGeneratedAsset(client, {
    shopId, userId, persona,
    assetType: "image",
    provider: "sharp",
    model: "center_crop",
    content: { url: result.url, destination, aspectRatio, width: result.width, height: result.height, sourceUrl, strategy: "center_crop" },
    parentAssetId,
    transformationType: "reframe",
    status: "completed"
  });
  if (!persisted.ok) return { ok: false, error: persisted.error };
  return { ok: true, assetId: persisted.asset.id, url: result.url, aspectRatio, destination };
}

/**
 * Batch entry point: given a master IMAGE asset and a set of target
 * publish platforms, plans (via media-output-planner.js's existing
 * planDerivedAssets — never a second planning implementation) which
 * destinations actually need a reframe, then EXECUTES each one for real
 * via transformImageForDestination(). A destination whose spec already
 * matches the master's aspect ratio needs no derivative at all and is
 * correctly skipped — never a wasted reframe. Video destinations are
 * planned (so the gap is visible) but never executed here — see the
 * module doc and marketing-video-render-engine.js for why.
 */
export async function transformMasterImageForPlatforms(client, { shopId, userId, persona = "Lily", masterAssetId, masterUrl, masterAspectRatio, targetPlatforms = [] } = {}) {
  if (!masterAssetId || !masterUrl) return { ok: false, error: "transformMasterImageForPlatforms requires masterAssetId and masterUrl." };
  const { derivedAssets, overallWarnings } = planDerivedAssets({
    masterAsset: { assetType: "image", aspectRatio: masterAspectRatio || "1:1" },
    targetPlatforms
  });

  const results = [];
  for (const derived of derivedAssets) {
    const reframeStep = derived.transformations.find((t) => t.type === "reframe");
    if (!reframeStep) {
      // Master already fits this destination — the master URL itself is
      // the correct "variant" for it, no new asset needed.
      results.push({ destination: derived.destination, platform: derived.platform, executed: false, reason: "master_aspect_ratio_already_fits", url: masterUrl });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const outcome = await transformImageForDestination(client, {
      shopId, userId, persona,
      parentAssetId: masterAssetId,
      sourceUrl: masterUrl,
      aspectRatio: reframeStep.to,
      destination: derived.destination
    });
    results.push({ destination: derived.destination, platform: derived.platform, executed: true, ...outcome });
  }

  return { ok: true, results, warnings: overallWarnings };
}
