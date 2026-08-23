/**
 * ElevenLabs API client — real HTTP integration (Stage G activation).
 *
 * Endpoint shapes verified against ElevenLabs' own current documentation
 * (elevenlabs.io/docs) on 2026-08-23 — this is one of the longest-stable,
 * best-documented APIs in this space (voice cloning + TTS endpoints have
 * held their shape for years), so confidence here is HIGH across every
 * function in this file, unlike the mixed confidence in the HeyGen client.
 *
 * Every function returns { ok, ... } and never throws for an expected
 * failure — same contract as ai-image-engine.js's generateImage().
 */

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";

export function elevenLabsConfigured(env = process.env) {
  return Boolean(String(env.ELEVENLABS_API_KEY || "").trim());
}

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Clones a voice from real reference audio samples. `audioFiles` is an
 * array of { blob, filename } — real recorded audio the consented person
 * provided, never synthesized or borrowed audio (Section 11's consent
 * scope only ever covers audio the named person actually recorded).
 */
export async function cloneElevenLabsVoice({ apiKey, name, audioFiles, description } = {}) {
  if (!apiKey) return { ok: false, error: "ElevenLabs API key is required." };
  if (!name) return { ok: false, error: "name is required." };
  if (!Array.isArray(audioFiles) || audioFiles.length === 0) {
    return { ok: false, error: "At least one reference audio file is required." };
  }

  const form = new FormData();
  form.set("name", name);
  if (description) form.set("description", description);
  for (const file of audioFiles) {
    form.append("files", file.blob, file.filename || "sample.mp3");
  }

  let response;
  try {
    response = await fetch(`${ELEVENLABS_API_BASE}/v1/voices/add`, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form
    });
  } catch (error) {
    return { ok: false, error: `ElevenLabs voice-clone request failed: ${String(error?.message || error).slice(0, 200)}` };
  }

  const payload = await parseJsonSafely(response);
  if (!response.ok) {
    const detail = payload?.detail?.message || payload?.message || `ElevenLabs returned ${response.status}`;
    return { ok: false, error: detail };
  }
  const voiceId = payload?.voice_id;
  if (!voiceId) return { ok: false, error: "ElevenLabs response carried no voice_id." };
  return { ok: true, voiceId, provider: "elevenlabs" };
}

/** Synthesizes speech from text using a cloned (or stock) voice. Returns
 * the raw audio bytes as a Buffer — the caller decides where those bytes
 * go (e.g. uploading through website-media.js to get a public URL a video
 * provider like HeyGen can fetch). Synchronous — ElevenLabs TTS returns
 * finished audio directly in the response, no job polling needed. */
export async function synthesizeElevenLabsSpeech({ apiKey, voiceId, text, modelId = DEFAULT_MODEL_ID } = {}) {
  if (!apiKey) return { ok: false, error: "ElevenLabs API key is required." };
  if (!voiceId) return { ok: false, error: "voiceId is required." };
  const cleanText = String(text || "").trim();
  if (!cleanText) return { ok: false, error: "text is required." };

  let response;
  try {
    response = await fetch(`${ELEVENLABS_API_BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text: cleanText.slice(0, 5000), model_id: modelId })
    });
  } catch (error) {
    return { ok: false, error: `ElevenLabs speech request failed: ${String(error?.message || error).slice(0, 200)}` };
  }

  if (!response.ok) {
    const payload = await parseJsonSafely(response);
    const detail = payload?.detail?.message || payload?.message || `ElevenLabs returned ${response.status}`;
    return { ok: false, error: detail };
  }

  let audioBuffer;
  try {
    const arrayBuffer = await response.arrayBuffer();
    audioBuffer = Buffer.from(arrayBuffer);
  } catch (error) {
    return { ok: false, error: `Failed to read ElevenLabs audio response: ${String(error?.message || error).slice(0, 200)}` };
  }
  if (!audioBuffer.length) return { ok: false, error: "ElevenLabs returned no audio data." };
  return { ok: true, audioBuffer, mime: "audio/mpeg", provider: "elevenlabs", modelId };
}

/** Permanently deletes a cloned voice — the real action behind Stage B's
 * consent revocation cascade (marketing_clone_consent revocation suspends
 * the profile row; an operator can additionally call this to delete the
 * underlying provider voice entirely). */
export async function deleteElevenLabsVoice({ apiKey, voiceId } = {}) {
  if (!apiKey) return { ok: false, error: "ElevenLabs API key is required." };
  if (!voiceId) return { ok: false, error: "voiceId is required." };

  let response;
  try {
    response = await fetch(`${ELEVENLABS_API_BASE}/v1/voices/${encodeURIComponent(voiceId)}`, {
      method: "DELETE",
      headers: { "xi-api-key": apiKey }
    });
  } catch (error) {
    return { ok: false, error: `ElevenLabs delete request failed: ${String(error?.message || error).slice(0, 200)}` };
  }

  if (!response.ok) {
    const payload = await parseJsonSafely(response);
    const detail = payload?.detail?.message || payload?.message || `ElevenLabs returned ${response.status}`;
    return { ok: false, error: detail };
  }
  return { ok: true };
}
