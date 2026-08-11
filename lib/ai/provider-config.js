/**
 * Florisyn AI provider configuration — env-driven, no OpenAI.
 */

export const DEFAULT_TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
export const DEFAULT_VISION_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";

export function cloudflareAiToken(env = process.env) {
  return String(env.CLOUDFLARE_AI_API_TOKEN || env.CLOUDFLARE_AI_TOKEN || "").trim();
}

export function resolveAiConfig(env = process.env) {
  const provider = String(env.AI_PROVIDER || "cloudflare").trim().toLowerCase();
  return {
    provider,
    textModel: String(env.AI_TEXT_MODEL || env.CLOUDFLARE_AI_MODEL || DEFAULT_TEXT_MODEL).trim(),
    visionModel: String(env.AI_VISION_MODEL || DEFAULT_VISION_MODEL).trim(),
    timeoutMs: Math.min(60000, Math.max(5000, Number(env.AI_TIMEOUT_MS || 28000))),
    dailyCapPerShop: Math.max(0, Number(env.AI_DAILY_CAP_PER_SHOP || 250)),
    maxRetries: Math.min(2, Math.max(0, Number(env.AI_RETRY_MAX || 1))),
    accountId: String(env.CLOUDFLARE_ACCOUNT_ID || "").trim(),
    token: cloudflareAiToken(env),
    localBridgeUrl: String(env.LOCAL_AI_BRIDGE_URL || "http://127.0.0.1:11435").trim(),
  };
}

export function aiUnavailableMessage(reason = "") {
  const detail = reason ? ` ${reason}` : "";
  return `Florisyn AI is temporarily unavailable.${detail} You can still use quick actions, manual recipe builder, and help guides.`;
}
