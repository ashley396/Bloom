/**
 * Cloud TTS endpoint — ElevenLabs, via VoiceEngine (keys stay server-side;
 * never exposed to the client). The browser calls this first; on any
 * non-2xx it falls back to speechSynthesis (see public/assistant-voice.js
 * — it only ever checks for `audioBase64` in the response, so the exact
 * status code/message below are diagnostic, not functional).
 *
 * Creative AI master plan, Phase A Step 2 (see
 * docs/production/FLORISYN_CREATIVE_AI_MASTER_PLAN.md): this used to run
 * its own independent fetch() to api.elevenlabs.io, duplicating
 * marketing-elevenlabs-client.js's HTTP client. Now goes through the same
 * VoiceEngine the Marketing Studio clone provider uses — one ElevenLabs
 * HTTP client in the codebase, not two.
 *
 * Netlify env (values only, no code):
 *   ELEVENLABS_API_KEY            — your ElevenLabs API key
 *   ELEVENLABS_VOICE_LILY         — ElevenLabs Voice ID for Lily
 *   ELEVENLABS_VOICE_ROSE         — ElevenLabs Voice ID for Rose
 *   ELEVENLABS_VOICE_DAISY        — ElevenLabs Voice ID for Daisy
 *   ELEVENLABS_VOICE_BUD          — ElevenLabs Voice ID for Bud
 *   ELEVENLABS_MODEL (optional)   — defaults to eleven_multilingual_v2
 */
import { json, preflight, methodNotAllowed, bodyOf } from "./_shared/http.js";
import { prepareAssistantSpeechText } from "./_shared/assistant-voice.js";
import { createElevenLabsVoiceProvider } from "./_shared/creative-ai/voice-engine.js";

const DEFAULT_MODEL = "eleven_multilingual_v2";
// Preserved exactly from the pre-VoiceEngine implementation — these tune
// the assistant personas' delivery specifically; the Marketing Studio
// clone voice path never sets these and must keep not setting them.
const ASSISTANT_VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true };

function personaKey(persona) {
  const p = String(persona || "").toLowerCase();
  if (p === "rose") return "Rose";
  if (p === "daisy") return "Daisy";
  if (p === "bud") return "Bud";
  return "Lily";
}

function voiceIdFor(persona, env = process.env) {
  const who = personaKey(persona).toUpperCase();
  // Per-assistant voice, with a shared default as a safety net.
  return env[`ELEVENLABS_VOICE_${who}`] || env.ELEVENLABS_VOICE_DEFAULT || "";
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return json(503, {
      fallback: true,
      error: "Cloud voice is not configured on this environment. Using browser speech."
    });
  }

  const body = bodyOf(event);
  const persona = personaKey(body.persona);
  const text = prepareAssistantSpeechText(body.text, 800);
  if (!text) return json(400, { fallback: true, error: "No text to speak." });

  const voiceId = voiceIdFor(persona);
  if (!voiceId) {
    return json(503, {
      fallback: true,
      persona,
      error: `No ElevenLabs voice configured for ${persona}. Set ELEVENLABS_VOICE_${persona.toUpperCase()}.`
    });
  }

  const voiceEngine = createElevenLabsVoiceProvider({ env: process.env });
  const result = await voiceEngine.synthesize({
    voiceId,
    text,
    modelId: process.env.ELEVENLABS_MODEL || DEFAULT_MODEL,
    voiceSettings: ASSISTANT_VOICE_SETTINGS
  });

  if (!result.ok) {
    // Detail stays server-side only — same as before this extraction.
    console.warn(JSON.stringify({ level: "warn", fn: "assistant-tts", status: result.httpStatus, detail: result.error }));
    return json(result.httpStatus === 401 ? 502 : 503, {
      fallback: true,
      persona,
      error: "Cloud voice unavailable right now. Using browser speech."
    });
  }

  return json(200, { persona, provider: "elevenlabs", audioBase64: result.audioBuffer.toString("base64") });
}
