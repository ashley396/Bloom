/**
 * Cloudflare Workers AI — arrangement photo analysis for Lily recipes.
 */

import { cloudflareAiToken, extractCloudflareText } from "../ai-assistant.js";

const VISION_MODEL_DEFAULT = "@cf/meta/llama-3.2-11b-vision-instruct";
const VISION_MODEL_FALLBACK = "@cf/llava-hf/llava-1.5-7b-hf";

const ARRANGEMENT_VISION_PROMPT = `You are Lily, a professional florist studying an arrangement photo.
List every flower and foliage you can see using real wholesale florist names
(Freedom rose, spray rose, garden rose, hydrangea, peony, ranunculus, tulip,
alstroemeria, gerbera, carnation, chrysanthemum, sunflower, stock, snapdragon,
eucalyptus, Israeli ruscus, leatherleaf, pittosporum, etc.).
Reply with one comma-separated line of stem names only — no intro, no customer data.
If uncertain, prefix with "possibly".`;

function mimeFromPath(path = "") {
  const ext = String(path).split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
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

async function runVisionModel(model, image, prompt) {
  const account = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const token = cloudflareAiToken();
  if (!account || !token) {
    const e = new Error("Cloud AI is not configured for photo vision.");
    e.statusCode = 503;
    throw e;
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${encodeURIComponent(model)}`;
  const isLlava = /llava/i.test(model);
  const body = isLlava
    ? { prompt, image, max_tokens: 400 }
    : {
        messages: [
          { role: "system", content: "Identify florist flowers and foliage in photos using wholesale names." },
          { role: "user", content: prompt },
        ],
        image,
        max_tokens: 450,
      };
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let d = {};
  try {
    d = await r.json();
  } catch {
    const e = new Error(`Vision AI returned a non-JSON response (${r.status}).`);
    e.statusCode = r.status || 502;
    throw e;
  }
  if (!r.ok || d.success === false) {
    const detail = d.errors?.[0]?.message || d.errors?.[0]?.code || `Vision AI failed (${r.status})`;
    throw new Error(detail);
  }
  const text = extractCloudflareText(d.result).trim();
  if (!text) throw new Error("Vision AI returned an empty flower analysis.");
  return { text, model, provider: "Cloudflare Workers AI Vision" };
}

/**
 * Analyze an arrangement photo and return a comma-separated wholesale flower list.
 */
export async function analyzeArrangementPhoto(imagePayload, { caption = "" } = {}) {
  const image = toVisionImagePayload(imagePayload);
  if (!image) return null;
  const prompt = caption
    ? `${ARRANGEMENT_VISION_PROMPT}\nCaption hint (secondary to the photo): ${String(caption).slice(0, 280)}`
    : ARRANGEMENT_VISION_PROMPT;
  const primary = process.env.CLOUDFLARE_VISION_MODEL || VISION_MODEL_DEFAULT;
  try {
    return await runVisionModel(primary, image, prompt);
  } catch (primaryError) {
    if (primary === VISION_MODEL_FALLBACK) throw primaryError;
    try {
      return await runVisionModel(VISION_MODEL_FALLBACK, image, prompt);
    } catch {
      throw primaryError;
    }
  }
}
