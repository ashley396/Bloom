/**
 * Florisyn feature flags — unfinished modules stay off in production by default.
 * Override via env: FLORISYN_FLAG_<NAME>=true|false
 */

const DEFAULT_FLAGS = {
  /** Voice wake words / always-on mic — not production-ready */
  VOICE_WAKE: false,
  VOICE_TTS_CLOUD: false,
  MARKETPLACE_PUBLIC: true,
  WHOLESALE_SELLER: true,
  BUSINESS_ECOSYSTEM: true,
  INSTANT_WEBSITE: true,
  INVENTORY_AI_INTAKE: false,
  INVENTORY_RECIPE_DEDUCTIONS: false,
  DELIVERY_MAPS: true,
  LILY_SERVER_PERSISTENCE: true,
  REACT_ORDERS_PREVIEW: true,
};

function envFlag(name, fallback) {
  const key = `FLORISYN_FLAG_${name}`;
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw));
}

export function getFeatureFlags(env = process.env) {
  const flags = {};
  for (const [name, defaultValue] of Object.entries(DEFAULT_FLAGS)) {
    flags[name] = envFlag(name, defaultValue);
  }
  return Object.freeze(flags);
}

export function isFeatureEnabled(name, env = process.env) {
  return Boolean(getFeatureFlags(env)[name]);
}
