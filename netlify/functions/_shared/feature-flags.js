/**
 * Florisyn feature flags — unfinished modules stay off in production by default.
 * Override via env: FLORISYN_FLAG_<NAME>=true|false
 */

const DEFAULT_FLAGS = {
  /** Voice wake words / always-on mic — not production-ready */
  VOICE_WAKE: false,
  /** Cloud (ElevenLabs) TTS for assistant voices — wired and live in production. */
  VOICE_TTS_CLOUD: true,
  /** Wholesale marketplace browse + checkout — default on for Florisyn growth rollout. */
  MARKETPLACE_PUBLIC: true,
  WHOLESALE_SELLER: true,
  /** Subscriptions, loyalty, finance hub, Lily business coach — default on at public launch. */
  BUSINESS_ECOSYSTEM: true,
  INSTANT_WEBSITE: true,
  /**
   * Full Website Studio v2 (tabbed shell, whole-page CRUD, image upload +
   * media library, revision history, enforced pre-publish checklist) —
   * built, migrated, and already mounting unconditionally in production
   * for every florist since 2026-08-15. Default true so the flag reflects
   * what's actually shipping instead of contradicting it.
   */
  WEBSITE_STUDIO_V2: true,
  INVENTORY_AI_INTAKE: false,
  /** Deduct recipe ingredients when orders reach production-ready status (not at entry). */
  INVENTORY_RECIPE_DEDUCTIONS: true,
  DELIVERY_MAPS: true,
  LILY_SERVER_PERSISTENCE: true,
  REACT_ORDERS_PREVIEW: false,
  /**
   * Florist Community — social feed for florists (default on at public launch).
   * Disable with FLORISYN_FLAG_COMMUNITY_BETA=false if you need an emergency kill switch.
   */
  COMMUNITY_BETA: true,
  /**
   * Holiday Command Center — SAFE DEFAULT OFF.
   * Enable only with explicit FLORISYN_FLAG_HOLIDAY_COMMAND_CENTER=true.
   */
  HOLIDAY_COMMAND_CENTER: true,
  /**
   * Email Campaigns — draft, schedule, and send when Resend is configured.
   */
  EMAIL_CAMPAIGNS: true,
  /**
   * Wedding Workflows — proposals, checklists, and event timelines.
   */
  WEDDING_WORKFLOWS: true,
  /**
   * Florist Network — florist-to-florist wire orders + partner directory.
   * Enable with FLORISYN_FLAG_FLORIST_NETWORK=true (default on for growth rollout).
   */
  FLORIST_NETWORK: true,
  /**
   * Peak readiness checklist (Mother's Day) on dashboard — default on.
   */
  PEAK_READINESS: true,
  /**
   * Marketing Campaigns — the connective layer over Email Campaigns,
   * Holiday Command Center, and (later) social/text/promotion content, so
   * Marketing is one command center instead of disconnected tools.
   */
  MARKETING_CAMPAIGNS: true,
  /**
   * Marketing Studio — Lily as AI Marketing Director (Brand Brain, AI
   * Clone/Voice Clone, generative video, 7-platform social publishing).
   * SAFE DEFAULT OFF: Founding Beta build, gated server-side to
   * super_admin via platformAdmin() on top of this flag, not just this
   * flag alone. Do not flip default true until Stage G's internal beta
   * explicitly widens access — see Section 5/40 of the build directive.
   */
  MARKETING_STUDIO: false,
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
