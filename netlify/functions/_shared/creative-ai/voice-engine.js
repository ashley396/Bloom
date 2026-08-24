/**
 * VoiceEngine — Florisyn's standalone provider-registry abstraction for
 * text-to-speech and voice cloning (Creative AI master plan, Phase A
 * Step 2 — see docs/production/FLORISYN_CREATIVE_AI_MASTER_PLAN.md).
 * Same fail-closed registry pattern as marketing-clone-providers.js /
 * ai-video-provider.js: selectVoiceProvider() returns notLiveVoiceProvider
 * whenever the registry is empty, and every method on that default throws
 * a typed VOICE_NOT_LIVE error rather than a fake success.
 *
 * ElevenLabs is the only real adapter today (createElevenLabsVoiceProvider)
 * — it wraps marketing-elevenlabs-client.js's existing HTTP functions
 * rather than re-implementing them, so this is a pure architectural
 * extraction: no vendor-calling logic changed, no behavior changed for
 * existing callers. Two call sites previously each ran their own
 * independent ElevenLabs HTTP client (assistant-tts.js for the Lily/Rose/
 * Daisy/Bud voices, and the Marketing Studio clone composite provider for
 * cloned voices) — both now go through this one engine instead.
 *
 * A future FlorisynVoice adapter registers here the same way the moment
 * it exists (buildConfiguredVoiceProviderRegistry gains a second entry) —
 * nothing else in the codebase changes to support it. Provider selection
 * is not "Florisyn always wins" — it stays whatever
 * selectVoiceProvider(criteria, registry) decides, so a real primary/
 * fallback policy can be added later without another architecture change.
 */

import {
  elevenLabsConfigured,
  cloneElevenLabsVoice,
  synthesizeElevenLabsSpeech,
  deleteElevenLabsVoice
} from "../marketing-elevenlabs-client.js";

export const VOICE_NOT_LIVE = "voice_provider_not_live";

function notLive(method) {
  const err = new Error(
    `Voice provider connection required — ${method}() has no live provider configured yet.`
  );
  err.code = VOICE_NOT_LIVE;
  err.statusCode = 501;
  return err;
}

/**
 * @typedef {Object} VoiceProvider
 * Conceptual interface every voice adapter implements. Methods return
 * { ok, ... } | { ok: false, error, httpStatus? } — never throw for an
 * expected failure, matching marketing-elevenlabs-client.js's own
 * contract. Callers that want throw-on-failure (e.g. the Marketing Studio
 * clone composite) convert at their own boundary, same as today.
 */

/** The default adapter: every capability, none of them live. */
export const notLiveVoiceProvider = Object.freeze({
  name: "not_live",
  async synthesize(_params) {
    throw notLive("synthesize");
  },
  async clone(_params) {
    throw notLive("clone");
  },
  async delete(_params) {
    throw notLive("delete");
  }
});

export function elevenLabsVoiceConfigured(env = process.env) {
  return elevenLabsConfigured(env);
}

/** Wraps the real ElevenLabs HTTP client behind the VoiceEngine contract.
 * This file owns no HTTP logic of its own — marketing-elevenlabs-
 * client.js's existing 8 tests remain the real coverage for the wire
 * format; this is a thin delegate. */
export function createElevenLabsVoiceProvider({ env = process.env } = {}) {
  const apiKey = String(env.ELEVENLABS_API_KEY || "").trim();
  return Object.freeze({
    name: "elevenlabs",
    isConfigured: (e = env) => elevenLabsConfigured(e),

    /** voiceSettings is optional and passed straight through — some
     * callers (assistant personas) tune stability/similarity/style,
     * others (Marketing Studio clone) never have, and must keep not
     * sending anything so ElevenLabs' own defaults keep applying exactly
     * as before this extraction. */
    async synthesize({ voiceId, text, modelId, voiceSettings } = {}) {
      return synthesizeElevenLabsSpeech({ apiKey, voiceId, text, modelId, voiceSettings });
    },

    async clone({ name, audioFiles, description } = {}) {
      return cloneElevenLabsVoice({ apiKey, name, audioFiles, description });
    },

    async delete({ voiceId } = {}) {
      return deleteElevenLabsVoice({ apiKey, voiceId });
    }
  });
}

/** Real registry, built only from actually-configured env credentials —
 * mirrors buildConfiguredCloneProviderRegistry()'s pattern exactly. */
export function buildConfiguredVoiceProviderRegistry({ env = process.env } = {}) {
  const registry = {};
  if (elevenLabsVoiceConfigured(env)) {
    registry.elevenlabs = createElevenLabsVoiceProvider({ env });
  }
  return registry;
}

/** Same selection contract as selectCloneProvider(): first configured
 * provider in the registry, or the fail-closed default. `criteria` is
 * accepted (unused today) so future FlorisynVoice-vs-ElevenLabs routing
 * (quality gate passed, cost, latency, health) has a stable call shape to
 * grow into later without a breaking signature change. */
export function selectVoiceProvider(_criteria, registry = {}) {
  const names = Object.keys(registry);
  if (names.length === 0) return notLiveVoiceProvider;
  return registry[names[0]];
}
