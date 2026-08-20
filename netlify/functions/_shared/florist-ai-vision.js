/**
 * Cloudflare Workers AI — arrangement photo analysis for Lily recipes.
 */

import sharp from "sharp";
import { cloudflareAiToken, extractCloudflareText } from "../ai-assistant.js";

const VISION_MODEL_DEFAULT = "@cf/meta/llama-3.2-11b-vision-instruct";
const VISION_MODEL_FALLBACK = "@cf/llava-hf/llava-1.5-7b-hf";
const VISION_MODEL_CAPTION = "@cf/unum/uform-gen2-qwen-500m";

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
  // Model slug must stay literal in the path — encodeURIComponent turns its "/" into "%2F",
  // which Cloudflare rejects as "No route for that URI".
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`;
  const isLlava = /llava/i.test(model);
  const isUform = /uform/i.test(model);
  let lastError = null;

  for (const image of imageVariants) {
    const imageValue = image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`;
    // llava / uform expect the image as an array of uint8 bytes, NOT a base64 string
    // (base64 yields Cloudflare error 3016 "failed to decode u8").
    const imageBytes =
      isUform || isLlava
        ? Array.from(Buffer.from(image.replace(/^data:[^;]+;base64,/i, ""), "base64"))
        : null;
    const payloads = isUform
      ? [{ prompt, image: imageBytes }]
      : isLlava
        ? [{ prompt, image: imageBytes }]
        : [
            {
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: prompt },
                    { type: "image_url", image_url: { url: imageValue } },
                  ],
                },
              ],
              max_tokens: 450,
            },
            {
              messages: [{ role: "user", content: prompt }],
              image: imageValue,
              max_tokens: 450,
            },
            {
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: prompt },
                    { type: "image", image: image.replace(/^data:[^;]+;base64,/i, "") },
                  ],
                },
              ],
              max_tokens: 450,
            },
          ];

    for (const body of payloads) {
      if (!body.max_tokens && !isUform && !isLlava) body.max_tokens = 450;
      if (isUform || isLlava) body.max_tokens = 400;
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
  }

  throw lastError || new Error("Vision AI could not analyze this photo.");
}

/** Same no-license-first, llama-as-upgrade fallback order every vision
 * call in this module uses — factored out so a second vision task
 * (photo-quality assessment) doesn't duplicate it. */
async function runVisionWithFallback(imageVariants, prompt) {
  const configured = process.env.CLOUDFLARE_VISION_MODEL;
  const order = configured
    ? [configured, VISION_MODEL_FALLBACK, VISION_MODEL_CAPTION, VISION_MODEL_DEFAULT]
    : [VISION_MODEL_FALLBACK, VISION_MODEL_CAPTION, VISION_MODEL_DEFAULT];
  const models = [...new Set(order.filter(Boolean))];
  let lastError = null;
  for (const model of models) {
    try {
      return await runVisionModel(model, imageVariants, prompt);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Vision AI could not analyze this photo.");
}

function preparedImageVariants(imagePayload) {
  return (async () => {
    let buffer = imagePayload?.buffer;
    if (Buffer.isBuffer(buffer)) {
      buffer = await prepareVisionImageBuffer(buffer);
    }
    const imageDataUrl = toVisionImagePayload({ ...imagePayload, buffer, mime: "image/jpeg" });
    if (!imageDataUrl) return null;
    return imagePayloadVariants(imageDataUrl);
  })();
}

/**
 * Analyze an arrangement photo and return a comma-separated wholesale flower list.
 */
export async function analyzeArrangementPhoto(imagePayload, { caption = "" } = {}) {
  const imageVariants = await preparedImageVariants(imagePayload);
  if (!imageVariants) return null;
  const prompt = caption
    ? `${ARRANGEMENT_VISION_PROMPT}\nCaption hint (secondary to the photo): ${String(caption).slice(0, 280)}`
    : ARRANGEMENT_VISION_PROMPT;
  return runVisionWithFallback(imageVariants, prompt);
}

const PHOTO_QUALITY_VISION_PROMPT = `You are a professional product photographer reviewing a florist's arrangement photo before it goes on their website or social media.
Describe ONLY what you can actually see: lighting (too dark/bright/uneven/good), color balance (warm/cool/neutral cast), background (busy/plain/cluttered), and framing (centered/off-center/too close/too far).
Reply with one short paragraph. Do not invent details you cannot see. Do not suggest photographing a different arrangement.`;

/** Vision assessment of photo QUALITY (lighting/color/background/framing) —
 * a different task from analyzeArrangementPhoto's flower identification,
 * reusing the same model fallback order and image-prep pipeline. Feeds
 * Photo Studio's "make this look professional" suggestion, which maps the
 * result onto the studio's own existing presets/sliders rather than
 * generating or editing any pixels. */
export async function assessPhotoQuality(imagePayload) {
  const imageVariants = await preparedImageVariants(imagePayload);
  if (!imageVariants) return null;
  return runVisionWithFallback(imageVariants, PHOTO_QUALITY_VISION_PROMPT);
}
