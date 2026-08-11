/**
 * Florisyn AI provider abstraction — Cloudflare Workers AI (text + vision), optional local bridge.
 * No OpenAI. Tenant-safe payloads only.
 */

import { systemPromptFor, temperatureForPersona, normalizePersona } from "./florist-ai-personas.js";
import {
  resolveAiConfig,
  aiUnavailableMessage,
  DEFAULT_TEXT_MODEL,
  DEFAULT_VISION_MODEL,
} from "../../../lib/ai/provider-config.js";

const MAX_HISTORY_TURNS = 10;
const MAX_PROMPT_CHARS = 42000;
const MAX_STRING_CHARS = 2400;
const BLOCKED_KEY =
  /^(?:logo|logo_url|image|image_url|hero_image_url|receipt_data_url|photo|photo_url|data_url|file|attachment|canvas|base64)$/i;
const DATA_URL = /^data:[^;]+;base64,/i;

function safeText(value, max = MAX_STRING_CHARS) {
  const text = String(value ?? "");
  if (DATA_URL.test(text)) return "[embedded image omitted]";
  return text.length > max ? `${text.slice(0, max)}…[trimmed]` : text;
}

function compact(value, depth = 0, key = "") {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (BLOCKED_KEY.test(key)) return "[media omitted]";
  if (typeof value === "string") return safeText(value);
  if (depth >= 4) return "[nested data omitted]";
  if (Array.isArray(value)) return value.slice(0, 18).map((v) => compact(v, depth + 1, key));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 40)) {
      if (BLOCKED_KEY.test(k)) continue;
      out[k] = compact(v, depth + 1, k);
    }
    return out;
  }
  return safeText(value);
}

function jsonWithinLimit(value, maxChars = MAX_PROMPT_CHARS) {
  let text = JSON.stringify(compact(value));
  if (text.length <= maxChars) return text;
  return JSON.stringify({
    notice: "Florisyn trimmed oversized context for a safe AI request.",
    summary: safeText(text, maxChars - 120),
  });
}

export function extractCloudflareText(result) {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (typeof result.response === "string") return result.response;
  if (typeof result.result === "string") return result.result;
  if (typeof result.output === "string") return result.output;
  if (typeof result.description === "string") return result.description;
  if (Array.isArray(result.choices) && result.choices[0]?.message?.content) {
    return String(result.choices[0].message.content);
  }
  return "";
}

function normalizeHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .slice(-MAX_HISTORY_TURNS * 2)
    .map((row) => ({
      role: row.role === "assistant" ? "assistant" : "user",
      content: safeText(row.content || row.text || "", 2000),
    }))
    .filter((row) => row.content.trim());
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function cloudflareRun(model, body, config, retriesLeft = 0) {
  if (!config.accountId || !config.token) {
    const e = new Error(aiUnavailableMessage("Cloud AI is not configured."));
    e.statusCode = 503;
    throw e;
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${encodeURIComponent(model)}`;
  let response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      config.timeoutMs
    );
  } catch (err) {
    if (err.name === "AbortError") {
      const e = new Error(aiUnavailableMessage("The request timed out."));
      e.statusCode = 504;
      throw e;
    }
    throw err;
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    const e = new Error(aiUnavailableMessage(`Cloud AI returned a non-JSON response (${response.status}).`));
    e.statusCode = response.status || 502;
    throw e;
  }
  if (!response.ok || data.success === false) {
    const detail = data.errors?.[0]?.message || data.errors?.[0]?.code || `Cloud AI request failed (${response.status})`;
    if (retriesLeft > 0 && (response.status === 429 || response.status >= 500)) {
      await new Promise((r) => setTimeout(r, 400));
      return cloudflareRun(model, body, config, retriesLeft - 1);
    }
    const e = new Error(aiUnavailableMessage(detail));
    e.statusCode = response.status || 502;
    throw e;
  }
  return data.result;
}

export async function runTextChat(
  {
    persona = "Lily",
    prompt = "",
    context = {},
    history = [],
    mode = "chat",
    maxTokens,
    env = process.env,
  } = {}
) {
  const config = resolveAiConfig(env);
  const who = normalizePersona(persona);
  const chatMode = mode === "generate" ? "generate" : "chat";
  const system = systemPromptFor(who, chatMode);
  const temperature = temperatureForPersona(who, chatMode);
  const model = config.textModel || DEFAULT_TEXT_MODEL;
  const turns = normalizeHistory(history);
  const userContent =
    chatMode === "generate"
      ? `Task: ${safeText(prompt, 1200)}\nContext: ${jsonWithinLimit(context, 30000)}`
      : `Question: ${safeText(prompt, 4000)}\nRelevant Florisyn context: ${jsonWithinLimit(context, 28000)}`;

  const messages = [{ role: "system", content: system }, ...turns, { role: "user", content: userContent }];
  const tokens = Math.min(1200, Math.max(400, Number(maxTokens) || (chatMode === "generate" ? 800 : 550)));

  const result = await cloudflareRun(
    model,
    { messages, max_tokens: tokens, temperature },
    config,
    config.maxRetries
  );
  const text = extractCloudflareText(result).trim();
  if (!text) throw new Error(aiUnavailableMessage("Cloud AI returned an empty response."));
  return {
    answer: text,
    persona: who,
    provider: "Cloudflare Workers AI",
    model,
    promptChars: userContent.length,
  };
}

export async function runVisionAnalysis(
  { imageBase64, mime = "image/jpeg", prompt, maxTokens = 900, env = process.env } = {}
) {
  const config = resolveAiConfig(env);
  const model = config.visionModel || DEFAULT_VISION_MODEL;
  const buffer = Buffer.from(String(imageBase64 || ""), "base64");
  if (!buffer.length) {
    const e = new Error("Add a photo to analyze.");
    e.statusCode = 400;
    throw e;
  }

  const visionPrompt =
    prompt ||
    "Analyze this floral arrangement photo for a professional florist. Return structured JSON only.";

  let result;
  try {
    result = await cloudflareRun(
      model,
      {
        image: [...buffer],
        prompt: visionPrompt,
        max_tokens: Math.min(1200, Math.max(400, Number(maxTokens) || 900)),
      },
      config,
      config.maxRetries
    );
  } catch (visionErr) {
    result = await cloudflareRun(
      model,
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: visionPrompt },
              { type: "image_url", image_url: { url: `data:${mime};base64,${imageBase64}` } },
            ],
          },
        ],
        max_tokens: Math.min(1200, Math.max(400, Number(maxTokens) || 900)),
      },
      config,
      0
    );
  }

  const text = extractCloudflareText(result).trim();
  if (!text) throw new Error(aiUnavailableMessage("Vision AI returned an empty response."));
  return { text, provider: "Cloudflare Workers AI", model };
}

export { resolveAiConfig, jsonWithinLimit, compact, safeText, normalizeHistory };
