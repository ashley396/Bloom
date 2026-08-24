/**
 * AI Clone (Digital Twin Studio) provider-independent adapter interface —
 * Section 12 of the build directive: "Florisyn owns the workflow, not the
 * model." Every avatar/voice provider (HeyGen, Creatify, JoggAI, Captions,
 * ElevenLabs, Cartesia, ...) plugs in behind this exact interface so
 * swapping a provider is a new adapter object, never a business-logic
 * change in marketing-studio.js or anywhere else.
 *
 * Stage G: the HeyGen (avatar) + ElevenLabs (voice) composite adapter is
 * now real (marketing-clone-provider-heygen-elevenlabs.js) — see
 * buildConfiguredCloneProviderRegistry() below. It only ever appears in
 * the registry once BOTH vendor API keys are actually configured; with
 * neither (or only one) set, selectCloneProvider() still falls back to
 * notLiveCloneProvider exactly as before. Every method on the not-live
 * adapter still throws a clearly-labeled "not live" error rather than
 * silently returning a fake success — per Section 40, a missing
 * integration must never be reported as working. UI code calling these
 * must catch marketing.CLONE_NOT_LIVE and render the "not live yet"
 * state, never swallow it into a generic error.
 */

import { heygenElevenLabsConfigured, createHeygenElevenLabsCloneProvider, PROVIDER_NAME as HEYGEN_ELEVENLABS_PROVIDER_NAME } from "./marketing-clone-provider-heygen-elevenlabs.js";

export const CLONE_NOT_LIVE = "clone_provider_not_live";

function notLive(method) {
  const err = new Error(
    `AI Clone provider connection required — ${method}() has no live provider configured yet.`
  );
  err.code = CLONE_NOT_LIVE;
  err.statusCode = 501;
  return err;
}

/**
 * @typedef {Object} CloneProvider
 * Conceptual interface every avatar/voice provider adapter implements.
 * Params/returns are intentionally loose here (documented per-adapter once
 * a real provider is wired) — this file's job is the contract shape and
 * the fail-closed default, not a real implementation.
 */

/** The default adapter: every provider capability, none of them live. */
export const notLiveCloneProvider = Object.freeze({
  name: "not_live",

  async createAvatarProfile(_params) {
    throw notLive("createAvatarProfile");
  },
  async createVoiceProfile(_params) {
    throw notLive("createVoiceProfile");
  },
  async generateVideo(_params) {
    throw notLive("generateVideo");
  },
  async generateVoice(_params) {
    throw notLive("generateVoice");
  },
  async preview(_params) {
    throw notLive("preview");
  },
  async estimateCost(_params) {
    throw notLive("estimateCost");
  },
  async getJobStatus(_jobId) {
    throw notLive("getJobStatus");
  },
  async cancelJob(_jobId) {
    throw notLive("cancelJob");
  },
  async deleteProfile(_profileId) {
    throw notLive("deleteProfile");
  }
});

/**
 * Provider-independent AI Router stub (Section 13). Selects an adapter by
 * task/quality/cost/tenant-allowance/etc — currently always resolves to
 * the not-live adapter, since zero real providers are connected. Extend
 * the `providers` registry (keyed by provider name) as each is wired in
 * Stage D; never let this function claim a provider is available unless
 * it is genuinely configured (real API key present) and health-checked.
 */
export function selectCloneProvider(_criteria = {}, providers = {}) {
  const configured = Object.values(providers).filter(Boolean);
  if (configured.length === 0) return notLiveCloneProvider;
  // Placeholder selection: first healthy configured provider. Real
  // scoring (quality/cost/speed/availability) becomes meaningful once
  // more than one real adapter exists — with exactly one (HeyGen +
  // ElevenLabs) there is nothing to score between yet.
  return configured[0];
}

/**
 * Builds the real provider registry from environment credentials —
 * exactly the isPlatformConfigured() pattern marketing-social-providers.js
 * uses, applied to AI Clone providers. Only ever includes a provider once
 * its real API key(s) are genuinely present; an unconfigured environment
 * (e.g. local dev, or before Ashley adds the keys in Netlify) returns {},
 * so selectCloneProvider() correctly falls back to notLiveCloneProvider.
 *
 * `uploadAudio` is forwarded to the HeyGen/ElevenLabs adapter's
 * constructor — see that file's header for why generateVideo() needs it
 * (hosting synthesized speech somewhere HeyGen can fetch it from).
 */
export function buildConfiguredCloneProviderRegistry({ env = process.env, uploadAudio } = {}) {
  const registry = {};
  if (heygenElevenLabsConfigured(env)) {
    registry[HEYGEN_ELEVENLABS_PROVIDER_NAME] = createHeygenElevenLabsCloneProvider({ env, uploadAudio });
  }
  return registry;
}
