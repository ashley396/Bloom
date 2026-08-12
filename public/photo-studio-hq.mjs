/**
 * Optional Photo Studio HQ path — lazy-loaded only when the fast flood
 * segmentation fails. Uses @imgly/background-removal (ONNX in-browser;
 * images never leave the device). Output still must pass FlorisynPhotoStudio
 * assessMaskQuality before it is shown as success.
 */
import { removeBackground as imglyRemoveBackground } from "/vendor/imgly-background-removal.mjs";

const HQ_MODEL = "isnet_fp16";

function studioApi() {
  return globalThis.FlorisynPhotoStudio || null;
}

function scaledSource(source, maxEdge) {
  const w0 = (source && (source.naturalWidth || source.width)) || 0;
  const h0 = (source && (source.naturalHeight || source.height)) || 0;
  if (!w0 || !h0) return { source: null, width: 0, height: 0 };
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  if (scale >= 1) return { source, width: w0, height: h0 };
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(source, 0, 0, w, h);
  return { source: canvas, width: w, height: h };
}

function blobToCanvas(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("HQ cut-out image could not be decoded"));
    };
    img.src = url;
  });
}

export function isHqRemovalSupported() {
  return typeof Blob !== "undefined" && typeof document !== "undefined" && Boolean(studioApi()?.assessMaskQuality);
}

/** Browser-only HQ removal; returns the same shape as FlorisynPhotoStudio.removeBackground. */
export async function removeBackgroundHq(source) {
  const studio = studioApi();
  if (!studio?.assessMaskQuality) return { ok: false, reason: "hq-unavailable", removedRatio: 0 };
  const maxEdge = studio.MAX_WORK_EDGE || 1600;
  const scaled = scaledSource(source, maxEdge);
  if (!scaled.source) return { ok: false, reason: "empty-image", removedRatio: 0 };

  let blob;
  try {
    blob = await imglyRemoveBackground(scaled.source, {
      model: HQ_MODEL,
      output: { format: "image/png", quality: 1 },
    });
  } catch (err) {
    return { ok: false, reason: "hq-failed", removedRatio: 0, error: String(err?.message || err) };
  }

  let canvas;
  try {
    canvas = await blobToCanvas(blob);
  } catch (err) {
    return { ok: false, reason: "hq-decode-failed", removedRatio: 0, error: String(err?.message || err) };
  }

  let imageData;
  try {
    imageData = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return { ok: false, reason: "canvas-blocked", removedRatio: 0 };
  }

  const gate = studio.assessMaskQuality(imageData);
  if (!gate.ok) {
    return {
      ok: false,
      reason: gate.reason || "mask-quality",
      removedRatio: 0,
      metrics: gate.metrics,
      method: "hq-local",
    };
  }

  let transparent = 0;
  const total = canvas.width * canvas.height;
  for (let t = 3; t < imageData.data.length; t += 4) if (imageData.data[t] < 128) transparent++;

  return {
    ok: true,
    canvas,
    width: canvas.width,
    height: canvas.height,
    removedRatio: transparent / total,
    metrics: gate.metrics,
    method: "hq-local",
  };
}
