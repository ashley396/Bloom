import { json, preflight, methodNotAllowed } from "./_shared/http.js";
import { getAiProviderStatus } from "./_shared/ai-status.js";
import { getFeatureFlags } from "./_shared/feature-flags.js";

/** Public AI configuration status — no secrets, no fake "online". */
export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "GET") return methodNotAllowed();

  const ai = getAiProviderStatus(process.env);
  const flags = getFeatureFlags(process.env);

  return json(200, {
    ...ai,
    feature_flags: {
      voice_wake: flags.VOICE_WAKE,
      voice_tts_cloud: flags.VOICE_TTS_CLOUD,
      community_beta: flags.COMMUNITY_BETA,
    },
  });
}
