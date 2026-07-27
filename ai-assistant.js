import { json, preflight, methodNotAllowed, bodyOf } from "./_shared/http.js";
import { currentUser } from "./_shared/supabase.js";

const MODEL_DEFAULT = "@cf/meta/llama-3.1-8b-instruct-fast";
const MAX_PROMPT_CHARS = 42000;
const MAX_STRING_CHARS = 5000;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 35;
const MAX_DEPTH = 4;

function cleanJson(text) {
  const raw = String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return null;
}

function systemPrompt(persona) {
  const name = persona === "Rose" ? "Rose" : "Lily";
  const personality = name === "Rose"
    ? "You are an experienced, witty florist-business mentor. Be direct, practical, and kind."
    : "You are a warm, encouraging florist assistant. Be practical, concise, and helpful.";
  return `${personality} Never claim an action was saved, published, paid, ordered, or completed unless Bloom confirms it. Suggestions are editable and require florist approval. Protect private employee and customer information. Favor low-cost workflows and avoid unnecessary services.`;
}

function text(value, max = MAX_STRING_CHARS) {
  const stringValue = String(value ?? "");
  if (/^data:[^;]+;base64,/i.test(stringValue)) {
    return `[embedded file omitted: ${stringValue.length} characters]`;
  }
  return stringValue.length > max
    ? `${stringValue.slice(0, max)}…[trimmed]`
    : stringValue;
}

function compact(value, depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return text(value);
  if (typeof value !== "object") return text(value);
  if (depth >= MAX_DEPTH) return "[nested data omitted]";
  if (seen.has(value)) return "[circular data omitted]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map(item => compact(item, depth + 1, seen));
  }

  const result = {};
  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
  for (const [key, item] of entries) {
    if (/password|secret|token|api[_-]?key|authorization/i.test(key)) continue;
    if (/image|photo|logo|receipt|attachment|file/i.test(key) && typeof item === "string" && item.length > 1000) {
      result[key] = `[large ${key} omitted]`;
      continue;
    }
    result[key] = compact(item, depth + 1, seen);
  }
  return result;
}

function safeJson(value, maxChars = MAX_PROMPT_CHARS) {
  let output = JSON.stringify(compact(value));
  if (output.length <= maxChars) return output;
  output = JSON.stringify({
    notice: "Bloom trimmed oversized context before sending it to AI.",
    preview: output.slice(0, maxChars - 120)
  });
  return output.slice(0, maxChars);
}

function routeFor(payload) {
  const source = `${payload.task || ""} ${payload.prompt || ""}`.toLowerCase();
  if (/inventory|stem|flower count|receipt|stock|vase life/.test(source)) return "inventory";
  if (/price|profit|cost|markup|margin|payroll|business/.test(source)) return "business";
  if (/website|seo|product description|homepage|tagline/.test(source)) return "website";
  if (/facebook|instagram|marketing|caption|email campaign|sms/.test(source)) return "marketing";
  if (/customer|recipient|crm|follow.?up/.test(source)) return "customer";
  if (/delivery|route|mileage|driver/.test(source)) return "delivery";
  if (/report|sales|revenue|expense|forecast/.test(source)) return "reports";
  return "florist";
}

function buildUserPrompt(payload) {
  const route = routeFor(payload);
  if (payload.mode === "generate") {
    return [
      `Bloom specialty: ${route}`,
      `Task: ${text(payload.task, 2000)}`,
      `Input: ${safeJson(payload.input || {}, 30000)}`,
      `Return ONLY valid JSON matching this shape: ${safeJson(payload.schema || { text: "result" }, 6000)}`
    ].join("\n");
  }
  return [
    `Bloom specialty: ${route}`,
    `Question: ${text(payload.prompt, 6000)}`,
    `Relevant Bloom shop context: ${safeJson(payload.context || {}, 30000)}`
  ].join("\n");
}

async function cloudflareAi(payload) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_AI_API_TOKEN;
  if (!account || !token) {
    const error = new Error("Cloud AI is not configured; Bloom will try the free local AI fallback.");
    error.statusCode = 503;
    throw error;
  }

  const model = process.env.CLOUDFLARE_AI_MODEL || MODEL_DEFAULT;
  const user = buildUserPrompt(payload);
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt(payload.persona) },
        { role: "user", content: user }
      ],
      max_tokens: payload.mode === "generate" ? 650 : 500,
      temperature: 0.35
    })
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    const message = data.errors?.[0]?.message || "Cloud AI request failed";
    const error = new Error(/context window|tokens/i.test(message)
      ? "This request still contained too much information. Bloom trimmed it, but please try a shorter request."
      : message);
    error.statusCode = response.status || 500;
    throw error;
  }

  const answer = data.result?.response || data.result?.result || "";
  if (payload.mode === "generate") {
    return {
      result: cleanJson(answer) || { text: answer },
      provider: "Cloudflare Workers AI",
      model
    };
  }
  return {
    answer,
    persona: payload.persona === "Rose" ? "Rose" : "Lily",
    provider: "Cloudflare Workers AI",
    model
  };
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  try {
    await currentUser(event);
    const payload = bodyOf(event);
    if (!payload.prompt && !payload.task) return json(400, { error: "Add a prompt or task." });
    return json(200, await cloudflareAi(payload));
  } catch (error) {
    return json(error.statusCode || 500, { error: error.message || "AI unavailable" });
  }
}

export const __test = { compact, safeJson, buildUserPrompt, routeFor };
