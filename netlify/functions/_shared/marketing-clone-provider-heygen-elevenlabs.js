/**
 * The Marketing Studio clone.* adapter (Stage G activation) — HeyGen for
 * avatar video, ElevenLabs for voice cloning/synthesis, composed behind
 * the same clone.* interface every not-live stub implements
 * (marketing-clone-providers.js). Chosen per Ashley's Stage G provider
 * decision: both bill per-generation with no subscription floor, matching
 * this app's cost-ledger/job-queue architecture.
 *
 * Creative AI master plan, Phase A Step 2 (see
 * docs/production/FLORISYN_CREATIVE_AI_MASTER_PLAN.md): this file no
 * longer owns any vendor HTTP calls itself — it's built from the two
 * standalone provider engines (creative-ai/voice-engine.js,
 * creative-ai/avatar-engine.js), which is what those engines are also
 * used independently by (assistant-tts.js's Lily/Rose/Daisy/Bud voices go
 * through VoiceEngine now too). This file exists because Marketing
 * Studio's clone workflow is the one caller that genuinely needs both
 * engines together — an avatar video lip-synced to a freshly-cloned
 * voice — everything else about the two vendors stays reachable
 * independently through their own engine.
 *
 * Voice generation is synchronous (ElevenLabs TTS returns finished audio
 * directly); avatar video generation is asynchronous (HeyGen renders take
 * real time) — generateVideo() kicks off a HeyGen render and returns a
 * jobId immediately; callers must poll getJobStatus() rather than assume
 * completion. Confidence on the underlying HTTP calls is NOT uniform —
 * see marketing-heygen-client.js's file header: video creation/status are
 * verified against current docs, the Photo Avatar Group (createAvatarProfile)
 * flow is lower-confidence and needs a real smoke test before trusting it
 * beyond a first manual run.
 *
 * generateVideo() needs a real, publicly-fetchable URL to hand HeyGen the
 * ElevenLabs-synthesized audio — hosting those bytes is a Supabase Storage
 * concern (website-media.js), not something this composition layer should
 * own. `uploadAudio` is injected at construction time so this file stays
 * pure orchestration, testable without a database.
 */

import { createElevenLabsVoiceProvider, elevenLabsVoiceConfigured } from "./creative-ai/voice-engine.js";
import { createHeygenAvatarProvider, heygenAvatarConfigured } from "./creative-ai/avatar-engine.js";
import { estimateCostCents } from "./marketing-cost-config.js";

export const PROVIDER_NAME = "heygen_elevenlabs";

/** True only once BOTH vendor API keys are actually configured — matches
 * isPlatformConfigured()'s real-env-credential-check pattern for social
 * providers. Never true from a partial (avatar-only or voice-only) setup,
 * since this composite adapter's generateVideo() needs both. */
export function heygenElevenLabsConfigured(env = process.env) {
  return heygenAvatarConfigured(env) && elevenLabsVoiceConfigured(env);
}

function providerError(message) {
  const err = new Error(message);
  err.provider = PROVIDER_NAME;
  return err;
}

/**
 * @param {object} params
 * @param {object} [params.env] - defaults to process.env
 * @param {(buffer: Buffer, filename: string) => Promise<{ok: boolean, url?: string, error?: string}>} params.uploadAudio
 *   Required for generateVideo() specifically — every other method works without it.
 */
export function createHeygenElevenLabsCloneProvider({ env = process.env, uploadAudio } = {}) {
  const voiceProvider = createElevenLabsVoiceProvider({ env });
  const avatarProvider = createHeygenAvatarProvider({ env });

  return Object.freeze({
    name: PROVIDER_NAME,

    async createAvatarProfile({ personName, referencePhotoUrls } = {}) {
      const result = await avatarProvider.createProfile({ personName, referencePhotoUrls });
      if (!result.ok) throw providerError(result.error);
      return { providerProfileId: result.groupId, status: result.status, provider: "heygen" };
    },

    async createVoiceProfile({ personName, referenceAudioFiles, description } = {}) {
      const result = await voiceProvider.clone({ name: personName, audioFiles: referenceAudioFiles, description });
      if (!result.ok) throw providerError(result.error);
      // ElevenLabs voice cloning is immediate — no separate training wait
      // the way HeyGen's avatar flow has one.
      return { providerProfileId: result.voiceId, status: "ready", provider: "elevenlabs" };
    },

    async generateVoice({ voiceProfileId, text, modelId } = {}) {
      const result = await voiceProvider.synthesize({ voiceId: voiceProfileId, text, modelId });
      if (!result.ok) throw providerError(result.error);
      return { audioBuffer: result.audioBuffer, mime: result.mime, provider: "elevenlabs" };
    },

    async generateVideo({ avatarProfileId, voiceProfileId, script, title, aspectRatio } = {}) {
      if (typeof uploadAudio !== "function") {
        throw providerError("generateVideo requires an uploadAudio dependency to host the synthesized voice track for HeyGen.");
      }
      const speech = await voiceProvider.synthesize({ voiceId: voiceProfileId, text: script });
      if (!speech.ok) throw providerError(`Voice synthesis failed: ${speech.error}`);

      const uploaded = await uploadAudio(speech.audioBuffer, `clone-voice-${Date.now()}.mp3`);
      if (!uploaded.ok) throw providerError(`Could not host synthesized audio for HeyGen: ${uploaded.error}`);

      const video = await avatarProvider.generateVideo({ avatarId: avatarProfileId, audioUrl: uploaded.url, title, aspectRatio });
      if (!video.ok) throw providerError(video.error);
      return { jobId: video.videoId, status: "rendering", provider: "heygen", audioUrl: uploaded.url };
    },

    async preview({ voiceProfileId, avatarProfileId, script } = {}) {
      const shortScript = String(script || "").trim().slice(0, 200);
      if (!shortScript) throw providerError("preview requires a short script.");
      if (avatarProfileId) return this.generateVideo({ avatarProfileId, voiceProfileId, script: shortScript, title: "Preview" });
      return this.generateVoice({ voiceProfileId, text: shortScript });
    },

    async estimateCost({ purpose, unitType, units } = {}) {
      const cents = estimateCostCents({ purpose, unitType, units });
      if (cents == null) throw providerError(`Cannot estimate cost for purpose="${purpose}" unitType="${unitType}".`);
      return { estimatedCostCents: cents, currency: "USD" };
    },

    async getJobStatus(jobId) {
      // Only avatar video is a real async job here — voice synthesis is
      // synchronous and never produces a jobId to poll.
      const result = await avatarProvider.getJobStatus(jobId);
      if (!result.ok) throw providerError(result.error);
      return { status: result.status, terminal: result.terminal, resultUrl: result.videoUrl, error: result.error };
    },

    async cancelJob(jobId) {
      const result = await avatarProvider.cancelJob(jobId);
      // avatarProvider.cancelJob() never actually succeeds today (HeyGen
      // doesn't support it) — always throw with its real reason.
      throw providerError(result.error);
    },

    /** Accepts { profileId, kind: 'avatar' | 'voice' } — the base clone.*
     * interface's deleteProfile(_profileId) takes one generic param, so a
     * structured object here disambiguates which vendor's resource to
     * delete without changing the interface's call shape. */
    async deleteProfile({ profileId, kind } = {}) {
      if (kind === "voice") {
        const result = await voiceProvider.delete({ voiceId: profileId });
        if (!result.ok) throw providerError(result.error);
        return { deleted: true, provider: "elevenlabs" };
      }
      if (kind === "avatar") {
        // HeyGen's photo avatar group deletion is not covered by this
        // adapter yet — real deletion for an avatar profile currently
        // means suspending it in Florisyn's own marketing_avatar_profiles
        // row (Stage B's consent-revocation cascade already does this);
        // deleting the underlying HeyGen resource is a manual step today.
        throw providerError("Avatar profile deletion at the HeyGen provider is not implemented yet — the local profile row is suspended by consent revocation instead.");
      }
      throw providerError("deleteProfile requires kind: 'avatar' or 'voice'.");
    }
  });
}
