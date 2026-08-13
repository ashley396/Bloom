/**
 * Cloud TTS endpoint — ElevenLabs (keys stay server-side; never exposed to the client).
 * The browser calls this first; on 501/503 it falls back to speechSynthesis.
 *
 * Netlify env (values only, no code):
 *   ELEVENLABS_API_KEY            — your ElevenLabs API key
 *   ELEVENLABS_VOICE_LILY         — ElevenLabs Voice ID for Lily
 *   ELEVENLABS_VOICE_ROSE         — ElevenLabs Voice ID for Rose
 *   ELEVENLABS_VOICE_DAISY        — ElevenLabs Voice ID for Daisy
 *   ELEVENLABS_MODEL (optional)   — defaults to eleven_multilingual_v2
 */
import { json, preflight, methodNotAllowed, bodyOf } from "./_shared/http.js";
import { prepareAssistantSpeechText } from "./_shared/assistant-voice.js";

const DEFAULT_MODEL = "eleven_multilingual_v2";

function personaKey(persona) {
  const p = String(persona || "").toLowerCase();
  if (p === "rose") return "Rose";
  if (p === "daisy") return "Daisy";
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

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg"
        },
        body: JSON.stringify({
          text,
          model_id: process.env.ELEVENLABS_MODEL || DEFAULT_MODEL,
          voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true }
        })
      }
    );

    if (!res.ok) {
      // Surface a graceful fallback; log detail server-side only.
      let detail = "";
      try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
      console.warn(JSON.stringify({ level: "warn", fn: "assistant-tts", status: res.status, detail }));
      return json(res.status === 401 ? 502 : 503, {
        fallback: true,
        persona,
        error: "Cloud voice unavailable right now. Using browser speech."
      });
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) {
      return json(503, { fallback: true, persona, error: "Empty audio from provider." });
    }
    return json(200, { persona, provider: "elevenlabs", audioBase64: buffer.toString("base64") });
  } catch (error) {
    console.warn(JSON.stringify({ level: "warn", fn: "assistant-tts", error: String(error?.message || error) }));
    return json(503, { fallback: true, persona, error: "Cloud voice request failed. Using browser speech." });
  }
}
