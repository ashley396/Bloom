/** Browser bundle mirror of netlify/functions/_shared/assistant-voice.js */
(function (global) {
  const VOICE_DEFAULTS = {
    Lily: {
      rate: 0.91,
      pitch: 1.02,
      volume: 0.93,
      preview:
        "Hi there. I'm Lily. I'll help you with designs, recipes, and the creative side of your shop — calmly and clearly."
    },
    Rose: {
      rate: 0.9,
      pitch: 0.96,
      volume: 0.94,
      preview:
        "Good morning. Rose here. Let's look at what's due today, what's unpaid, and what needs your attention — no fluff."
    }
  };

  const ROBOTIC = /compact|desktop|legacy|espeak|android|sapi/i;

  function prepareAssistantSpeechText(raw, maxLen = 1200) {
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

  function splitSpeechSentences(text) {
    const t = prepareAssistantSpeechText(text);
    if (!t) return [];
    const parts = t.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g);
    return (parts || [t]).map((p) => p.trim()).filter(Boolean);
  }

  function scoreVoiceForPersona(voice, persona) {
    if (!voice) return -999;
    const name = voice.name || "";
    const lang = voice.lang || "";
    let score = 0;
    if (!/^en/i.test(lang)) score -= 80;
    if (voice.localService === false) score += 8;
    if (/natural|neural|online|premium|enhanced/i.test(name)) score += 50;
    if (/microsoft/i.test(name)) score += 14;
    if (/google us english/i.test(name)) score += 20;
    if (/jenny|aria|sonia|libby|samantha/i.test(name) && /natural|neural|online/i.test(name)) score += 18;
    if (persona === "Lily") {
      if (/aria|jenny|emma|ava|susan|michelle|sara/i.test(name)) score += 22;
    } else if (persona === "Rose") {
      if (/zira|samantha|michelle|karen|moira|jenny|aria/i.test(name)) score += 22;
      if (/david|guy|mark|james|male|child|kid/i.test(name)) score -= 60;
    }
    if (ROBOTIC.test(name)) score -= 25;
    if (/female|woman/i.test(name)) score += 6;
    return score;
  }

  function pickAssistantVoice(voices, persona, savedVoiceName = "") {
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

  function mergeVoiceSettings(persona, stored = {}) {
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

  global.FlorisynAssistantVoiceCore = {
    VOICE_DEFAULTS,
    prepareAssistantSpeechText,
    splitSpeechSentences,
    scoreVoiceForPersona,
    pickAssistantVoice,
    mergeVoiceSettings
  };
})(typeof window !== "undefined" ? window : globalThis);
