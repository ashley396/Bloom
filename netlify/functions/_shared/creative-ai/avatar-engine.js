/**
 * AvatarEngine — Florisyn's standalone provider-registry abstraction for
 * avatar/digital-clone video generation (Creative AI master plan, Phase A
 * Step 2 — see docs/production/FLORISYN_CREATIVE_AI_MASTER_PLAN.md). Same
 * fail-closed registry pattern as VoiceEngine / marketing-clone-
 * providers.js. HeyGen is the only real adapter today
 * (createHeygenAvatarProvider) — wraps marketing-heygen-client.js's
 * existing HTTP functions rather than re-implementing them.
 *
 * Deliberately separate from VoiceEngine (not bundled into one "clone"
 * engine) so a future FlorisynVoice can pass its production gate and go
 * primary independently of FlorisynAvatar, and mixed combinations like
 * FlorisynVoice + HeyGenAvatar (or ElevenLabsVoice + FlorisynAvatar) are
 * possible once both exist. The Marketing Studio clone composite
 * (marketing-clone-provider-heygen-elevenlabs.js) is what still combines
 * both engines into one adapter for the one caller that genuinely needs
 * both together (an avatar video lip-synced to a cloned voice) — it's now
 * built FROM these two engines rather than owning its own vendor HTTP
 * calls.
 */

import {
  heygenConfigured,
  createHeygenVideo,
  getHeygenVideoStatus,
  createHeygenPhotoAvatarGroup,
  trainHeygenPhotoAvatarGroup
} from "../marketing-heygen-client.js";

export const AVATAR_NOT_LIVE = "avatar_provider_not_live";

function notLive(method) {
  const err = new Error(
    `Avatar provider connection required — ${method}() has no live provider configured yet.`
  );
  err.code = AVATAR_NOT_LIVE;
  err.statusCode = 501;
  return err;
}

/**
 * @typedef {Object} AvatarProvider
 * Conceptual interface every avatar adapter implements. Methods return
 * { ok, ... } | { ok: false, error } — never throw for an expected
 * failure, matching marketing-heygen-client.js's own contract.
 */

/** The default adapter: every capability, none of them live. */
export const notLiveAvatarProvider = Object.freeze({
  name: "not_live",
  async createProfile(_params) {
    throw notLive("createProfile");
  },
  async generateVideo(_params) {
    throw notLive("generateVideo");
  },
  async getJobStatus(_jobId) {
    throw notLive("getJobStatus");
  },
  async cancelJob(_jobId) {
    throw notLive("cancelJob");
  }
});

export function heygenAvatarConfigured(env = process.env) {
  return heygenConfigured(env);
}

/** Wraps HeyGen's HTTP client behind the AvatarEngine contract.
 * createProfile() bundles HeyGen's two-step Photo Avatar Group flow
 * (create group, then start training) into one call — the same bundling
 * the Marketing Studio composite already did directly before this
 * extraction. Callers get back { ok, groupId, status: 'training' } once
 * training has *started*, not once the avatar is ready to render — HeyGen
 * doesn't document a dedicated training-complete poll separate from the
 * group's own detail endpoint (see marketing-heygen-client.js). */
export function createHeygenAvatarProvider({ env = process.env } = {}) {
  const apiKey = String(env.HEYGEN_API_KEY || "").trim();
  return Object.freeze({
    name: "heygen",
    isConfigured: (e = env) => heygenConfigured(e),

    async createProfile({ personName, referencePhotoUrls } = {}) {
      const group = await createHeygenPhotoAvatarGroup({ apiKey, name: personName, photoUrls: referencePhotoUrls });
      if (!group.ok) return group;
      const trained = await trainHeygenPhotoAvatarGroup({ apiKey, groupId: group.groupId });
      if (!trained.ok) return trained;
      return { ok: true, groupId: group.groupId, status: "training", provider: "heygen" };
    },

    async generateVideo({ avatarId, audioUrl, voiceId, script, title, aspectRatio } = {}) {
      return createHeygenVideo({ apiKey, avatarId, audioUrl, voiceId, script, title, aspectRatio });
    },

    async getJobStatus(jobId) {
      return getHeygenVideoStatus({ apiKey, videoId: jobId });
    },

    /** HeyGen does not document a video-cancellation endpoint — honest
     * "not supported" rather than guessing one that might not exist. */
    async cancelJob(_jobId) {
      return { ok: false, error: "HeyGen does not support canceling an in-progress video render." };
    }
  });
}

/** Real registry, built only from actually-configured env credentials —
 * mirrors buildConfiguredCloneProviderRegistry()'s pattern exactly. */
export function buildConfiguredAvatarProviderRegistry({ env = process.env } = {}) {
  const registry = {};
  if (heygenAvatarConfigured(env)) {
    registry.heygen = createHeygenAvatarProvider({ env });
  }
  return registry;
}

/** Same selection contract as selectCloneProvider()/selectVoiceProvider().
 * `criteria` is accepted (unused today) for the same forward-compatibility
 * reason as VoiceEngine's selector. */
export function selectAvatarProvider(_criteria, registry = {}) {
  const names = Object.keys(registry);
  if (names.length === 0) return notLiveAvatarProvider;
  return registry[names[0]];
}
