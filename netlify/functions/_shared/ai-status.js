/**
 * Honest AI availability — never report "online" without a configured provider.
 */

import { isFeatureEnabled } from "./feature-flags.js";

export const AI_STATUS = {
  ONLINE: "online",
  LIMITED: "limited",
  OFFLINE: "offline",
  CONFIGURATION_REQUIRED: "configuration_required",
};

export function getAiProviderStatus(env = process.env) {
  const cloudflare =
    Boolean(env.CLOUDFLARE_AI_API_TOKEN || env.CLOUDFLARE_AI_TOKEN) &&
    Boolean(env.CLOUDFLARE_ACCOUNT_ID);
  const ollamaUrl = String(env.OLLAMA_URL || env.BLOOM_AI_HOST || "").trim();

  if (cloudflare) {
    return {
      state: AI_STATUS.ONLINE,
      provider: "cloudflare",
      label: "Online",
      message: "Cloud AI is configured for Lily and Rose.",
      lily: "online",
      rose: "online",
    };
  }

  if (ollamaUrl && !/localhost|127\.0\.0\.1/i.test(ollamaUrl)) {
    return {
      state: AI_STATUS.LIMITED,
      provider: "ollama-remote",
      label: "Limited",
      message: "Remote Ollama URL is set. Verify network access from Netlify functions.",
      lily: "limited",
      rose: "limited",
    };
  }

  return {
    state: AI_STATUS.CONFIGURATION_REQUIRED,
    provider: null,
    label: "Configuration Required",
    message:
      "AI is not configured in this environment. Set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_API_TOKEN, or use the free local AI fallback. POS, orders, and payments continue to work.",
    lily: "offline",
    rose: "offline",
    voice_wake_enabled: isFeatureEnabled("VOICE_WAKE", env),
  };
}
