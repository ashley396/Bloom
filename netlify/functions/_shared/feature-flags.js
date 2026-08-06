/**
 * Florisyn feature flags — unfinished modules stay off in production by default.
 * Override via env: FLORISYN_FLAG_<NAME>=true|false
 */

const DEFAULT_FLAGS = {
  /** Voice wake words / always-on mic — not production-ready */
  VOICE_WAKE: false,
  VOICE_TTS_CLOUD: false,
  /** Deferred until after the florist-core launch. Explicit opt-in only. */
  MARKETPLACE_PUBLIC: false,
  WHOLESALE_SELLER: false,
  BUSINESS_ECOSYSTEM: false,
  INSTANT_WEBSITE: true,
  /** Full Website Studio v2 (Lily quick start, visual editor, checkout) — not production until phased rollout */
  WEBSITE_STUDIO_V2: false,
  INVENTORY_AI_INTAKE: false,
  INVENTORY_RECIPE_DEDUCTIONS: false,
  DELIVERY_MAPS: true,
  LILY_SERVER_PERSISTENCE: true,
  REACT_ORDERS_PREVIEW: false,
  /**
   * Florist Community Beta — SAFE DEFAULT OFF.
   * Missing FLORISYN_FLAG_COMMUNITY_BETA => disabled.
   * Enable only with explicit FLORISYN_FLAG_COMMUNITY_BETA=true.
   */
  COMMUNITY_BETA: false,
};

function envFlag(name, fallback, env = process.env) {
  const key = `FLORISYN_FLAG_${name}`;
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw));
}

export function getFeatureFlags(env = process.env) {
  const flags = {};
  for (const [name, defaultValue] of Object.entries(DEFAULT_FLAGS)) {
    flags[name] = envFlag(name, defaultValue, env);
  }
  return Object.freeze(flags);
}

export function isFeatureEnabled(name, env = process.env) {
  return Boolean(getFeatureFlags(env)[name]);
}
