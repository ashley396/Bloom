/**
 * Cloud TTS endpoint (architecture only — keys stay server-side).
 * Browser calls this first; on 503/501 it falls back to speechSynthesis.
 *
 * Configure later (not required for login/POS):
 *   AZURE_SPEECH_KEY + AZURE_SPEECH_REGION, or ELEVENLABS_API_KEY
 */
import { json, preflight, methodNotAllowed, bodyOf } from "./_shared/http.js";
import { prepareAssistantSpeechText } from "./_shared/assistant-voice.js";

function cloudConfigured(env = process.env) {
  return Boolean(
    (env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION) ||
      env.ELEVENLABS_API_KEY ||
      env.OPENAI_API_KEY
  );
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  if (!cloudConfigured()) {
    return json(503, {
      fallback: true,
      error: "Cloud voice is not configured on this environment. Using browser speech."
    });
  }

  const body = bodyOf(event);
  const text = prepareAssistantSpeechText(body.text, 800);
  const persona = body.persona === "Rose" ? "Rose" : "Lily";
  if (!text) return json(400, { fallback: true, error: "No text to speak." });

  // Provider wiring ships in a follow-up; never expose keys to the client.
  return json(501, {
    fallback: true,
    persona,
    error: "Cloud TTS provider hook not enabled in this build."
  });
}
