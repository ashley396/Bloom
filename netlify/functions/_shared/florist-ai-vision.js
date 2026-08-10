/**
 * Cloudflare Workers AI — arrangement photo analysis for Lily recipes.
 */

import sharp from "sharp";
import { cloudflareAiToken, extractCloudflareText } from "../ai-assistant.js";

const VISION_MODEL_DEFAULT = "@cf/meta/llama-3.2-11b-vision-instruct";
const VISION_MODEL_FALLBACK = "@cf/llava-hf/llava-1.5-7b-hf";

const ARRANGEMENT_VISION_PROMPT = `You are Lily, a professional florist studying an arrangement photo.
List ONLY flowers and foliage you can clearly see — use real wholesale florist names
(Freedom rose, spray rose, garden rose, hydrangea, peony, ranunculus, tulip, delphinium,
larkspur, alstroemeria, gerbera, carnation, chrysanthemum, sunflower, stock, snapdragon,
eucalyptus, Israeli ruscus, leatherleaf, pittosporum, etc.).
Do NOT guess oriental lilies, lily grass, or leather fern unless they are clearly visible.
Reply with one comma-separated line of stem names only — no intro, no customer data.
If uncertain, prefix with "possibly".`;

function mimeFromPath(path = "") {
  const ext = String(path).split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

/** Resize for vision models — smaller payloads, better latency. */
export async function prepareVisionImageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  try {
    return await sharp(buffer)
      .rotate()
      .resize(768, 768, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();
  } catch {
    return buffer;
  }
}

/** Normalize storage download or data URL to a vision-model image payload. */
export function toVisionImagePayload({ dataUrl, buffer, mime, path = "" } = {}) {
  if (dataUrl && /^data:image\//i.test(dataUrl)) return dataUrl;
  if (Buffer.isBuffer(buffer) && buffer.length) {
    const type = mime || mimeFromPath(path);
    return `data:${type};base64,${buffer.toString("base64")}`;
  }
  return null;
}

function imagePayloadVariants(imageDataUrl) {
  const raw = String(imageDataUrl || "");
  const base64Only = raw.replace(/^data:[^;]+;base64,/i, "");
  return [
    raw,
    base64Only,
    raw.startsWith("data:") ? undefined : `data:image/jpeg;base64,${base64Only}`,
  ].filter(Boolean);
}

function extractVisionText(result) {
  const direct = extractCloudflareText(result).trim();
  if (direct) return direct;
  if (typeof result?.description === "string") return result.description.trim();
  if (typeof result?.output === "string") return result.output.trim();
  return "";
}

async function runVisionModel(model, imageVariants, prompt) {
  const account = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const token = cloudflareAiToken();
  if (!account || !token) {
    const e = new Error("Cloud AI is not configured for photo vision.");
    e.statusCode = 503;
    throw e;
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${encodeURIComponent(model)}`;
  const isLlava = /llava/i.test(model);
  let lastError = null;

  for (const image of imageVariants) {
    const body = isLlava
      ? { prompt, image, max_tokens: 400 }
      : {
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}` } },
              ],
            },
          ],
          max_tokens: 450,
        };
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let d = {};
      try {
        d = await r.json();
      } catch {
        lastError = new Error(`Vision AI returned a non-JSON response (${r.status}).`);
        continue;
      }
      if (!r.ok || d.success === false) {
        lastError = new Error(
          d.errors?.[0]?.message || d.errors?.[0]?.code || `Vision AI failed (${r.status})`
        );
        continue;
      }
      const text = extractVisionText(d.result);
      if (text) return { text, model, provider: "Cloudflare Workers AI Vision" };
      lastError = new Error("Vision AI returned an empty flower analysis.");
    } catch (error) {
      lastError = error;
    }
  }

  // Legacy llama payload: top-level image field
  if (!isLlava) {
    for (const image of imageVariants) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [
              { role: "system", content: "Identify florist flowers in photos using wholesale names only." },
              { role: "user", content: prompt },
            ],
            image,
            max_tokens: 450,
          }),
        });
        const d = await r.json();
        if (r.ok && d.success !== false) {
          const text = extractVisionText(d.result);
          if (text) return { text, model, provider: "Cloudflare Workers AI Vision" };
        }
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw lastError || new Error("Vision AI could not analyze this photo.");
}

/**
 * Analyze an arrangement photo and return a comma-separated wholesale flower list.
 */
export async function analyzeArrangementPhoto(imagePayload, { caption = "" } = {}) {
  let buffer = imagePayload?.buffer;
  if (Buffer.isBuffer(buffer)) {
    buffer = await prepareVisionImageBuffer(buffer);
  }
  const imageDataUrl = toVisionImagePayload({ ...imagePayload, buffer, mime: "image/jpeg" });
  if (!imageDataUrl) return null;
  const imageVariants = imagePayloadVariants(imageDataUrl);
  const prompt = caption
    ? `${ARRANGEMENT_VISION_PROMPT}\nCaption hint (secondary to the photo): ${String(caption).slice(0, 280)}`
    : ARRANGEMENT_VISION_PROMPT;
  const primary = process.env.CLOUDFLARE_VISION_MODEL || VISION_MODEL_DEFAULT;
  try {
    return await runVisionModel(primary, imageVariants, prompt);
  } catch (primaryError) {
    if (primary === VISION_MODEL_FALLBACK) throw primaryError;
    try {
      return await runVisionModel(VISION_MODEL_FALLBACK, imageVariants, prompt);
    } catch {
      throw primaryError;
    }
  }
}
