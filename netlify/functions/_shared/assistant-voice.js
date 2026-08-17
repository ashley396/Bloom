/** Florisyn assistant voice — pure selection & text prep (testable, no DOM). */

export const ASSISTANT_PERSONAS = ["Lily", "Rose", "Daisy", "Bud"];

export const VOICE_DEFAULTS = {
  Lily: {
    rate: 0.94,
    pitch: 1.08,
    volume: 0.95,
    preview:
      "Hey! I'm Lily — your upbeat creative partner. Let's dream up gorgeous designs, recipes, and fresh ideas for the shop!"
  },
  Rose: {
    rate: 0.88,
    pitch: 0.94,
    volume: 0.95,
    preview:
      "Good morning, dear. I'm Rose. Let's look at what's due today, what's unpaid, and what needs your wise attention — calmly and clearly."
  },
  Daisy: {
    rate: 0.98,
    pitch: 1.12,
    volume: 0.9,
    preview:
      "Hi! I'm Daisy — cheerful, funny, and here with a little shop sparkle whenever you need a smile."
  },
  Bud: {
    rate: 0.92,
    pitch: 0.9,
    volume: 0.95,
    preview:
      "Hey there, I'm Bud. Something acting up? Tell me what's going on and I gotcha — let's get it fixed."
  }
};

const ROBOTIC = /compact|desktop|legacy|espeak|android|sapi|robot|monotone/i;

export function prepareAssistantSpeechText(raw, maxLen = 1200) {
  if (raw == null) return "";
  let t = String(raw)
    .replace(/[🌸💕✨💐😂🌷🌹⭐️⭐]/g, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  if (t.length > maxLen) t = `${t.slice(0, maxLen - 1).trim()}…`;
  return t;
}

export function splitSpeechSentences(text) {
  const t = prepareAssistantSpeechText(text);
  if (!t) return [];
  const parts = t.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g);
  return (parts || [t]).map((p) => p.trim()).filter(Boolean);
}

/** Higher score = better match for persona on this device. */
export function scoreVoiceForPersona(voice, persona) {
  if (!voice) return -999;
  const name = voice.name || "";
  const lang = voice.lang || "";
  let score = 0;

  if (!/^en/i.test(lang)) score -= 80;
  if (voice.localService === false) score += 14;
  if (/natural|neural|online|premium|enhanced|multilingual/i.test(name)) score += 60;
  if (/microsoft/i.test(name)) score += 14;
  if (/google us english|google uk english/i.test(name)) score += 22;
  if (/siri|samantha|ava|allison|susan|victoria/i.test(name)) score += 14;
  if (/jenny|aria|sonia|libby|samantha|ava|emma/i.test(name) && /natural|neural|online/i.test(name)) score += 22;

  if (persona === "Lily") {
    if (/aria|emma|ava|sara|jenny|susan|michelle/i.test(name)) score += 28;
    if (/zira|samantha|karen|moira/i.test(name)) score += 6;
    if (/david|guy|mark|james|male/i.test(name)) score -= 45;
  } else if (persona === "Rose") {
    if (/samantha|zira|michelle|karen|moira|sonia|libby/i.test(name)) score += 30;
    if (/aria|jenny/i.test(name)) score += 12;
    if (/david|guy|mark|james|male|child|kid/i.test(name)) score -= 60;
  } else if (persona === "Daisy") {
    if (/ava|emma|sara|aria|jenny/i.test(name)) score += 24;
    if (/child|kid|junior|david|guy|mark|james|male/i.test(name)) score -= 55;
  } else if (persona === "Bud") {
    if (/guy|david|mark|james|male|christopher|eric|ryan|tony/i.test(name)) score += 28;
    if (/female|woman|zira|samantha|aria|jenny|susan|victoria|ava|emma/i.test(name)) score -= 45;
  }

  if (ROBOTIC.test(name)) score -= 25;
  if (persona === "Bud") {
    if (/male/i.test(name)) score += 6;
  } else if (/female|woman/i.test(name)) {
    score += 6;
  }

  return score;
}

export function pickAssistantVoice(voices, persona, savedVoiceName = "") {
  const list = Array.isArray(voices) ? voices.filter((v) => /^en/i.test(v.lang || "en-US")) : [];
  const pool = list.length ? list : voices || [];
  if (!pool.length) return null;

  if (savedVoiceName) {
    const exact = pool.find((v) => v.name === savedVoiceName);
    if (exact) return exact;
  }

  let best = pool[0];
  let bestScore = -Infinity;
  for (const v of pool) {
    const s = scoreVoiceForPersona(v, persona);
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }
  return best;
}

export function mergeVoiceSettings(persona, stored = {}) {
  const base = VOICE_DEFAULTS[persona] || VOICE_DEFAULTS.Lily;
  const rate = Number(stored.rate);
  const pitch = Number(stored.pitch);
  const volume = Number(stored.volume);
  return {
    voiceName: typeof stored.voiceName === "string" ? stored.voiceName : "",
    rate: Number.isFinite(rate) ? Math.min(1.2, Math.max(0.75, rate)) : base.rate,
    pitch: Number.isFinite(pitch) ? Math.min(1.15, Math.max(0.85, pitch)) : base.pitch,
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0.5, volume)) : base.volume,
    engine: stored.engine === "cloud" ? "cloud" : "browser"
  };
}

export function storageKeyForAssistantVoice(scope, persona) {
  return `florisyn_assistant_voice_v1:${scope}:${persona}`;
}
