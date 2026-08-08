/**
 * Lily & Rose voice playback — cloud-first architecture, browser speechSynthesis fallback.
 */
(function () {
  const Core = window.FlorisynAssistantVoiceCore;
  if (!Core) return;

  const LEGACY = {
    Lily: "bloom_lily_voice_rc2",
    Rose: { voice: "bloomRoseVoice", rate: "bloomRoseVoiceRate", pitch: "bloomRoseVoicePitch" }
  };

  let voiceCache = [];
  let voicesReady = false;
  let speaking = false;
  let ctx = { getScope: () => "device:local", getSpeakEnabled: () => true };

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function scopeKey() {
    try {
      return ctx.getScope?.() || "device:local";
    } catch {
      return "device:local";
    }
  }

  function storageKey(persona) {
    return `florisyn_assistant_voice_v1:${scopeKey()}:${persona}`;
  }

  function loadRaw(persona) {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey(persona)) || "null");
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* ignore */
    }
    return migrateLegacy(persona);
  }

  function migrateLegacy(persona) {
    const out = {};
    if (persona === "Lily") {
      try {
        Object.assign(out, JSON.parse(localStorage.getItem(LEGACY.Lily) || "{}"));
      } catch {
        /* ignore */
      }
    } else {
      const v = localStorage.getItem(LEGACY.Rose.voice);
      if (v) out.voiceName = v;
      const r = localStorage.getItem(LEGACY.Rose.rate);
      const p = localStorage.getItem(LEGACY.Rose.pitch);
      if (r) out.rate = Number(r);
      if (p) out.pitch = Number(p);
    }
    return out;
  }

  function loadSettings(persona) {
    return Core.mergeVoiceSettings(persona, loadRaw(persona));
  }

  function saveSettings(persona, partial) {
    const next = { ...loadRaw(persona), ...partial };
    localStorage.setItem(storageKey(persona), JSON.stringify(next));
    if (persona === "Rose" && partial.voiceName !== undefined) {
      localStorage.setItem(LEGACY.Rose.voice, partial.voiceName);
    }
    if (persona === "Rose" && partial.rate !== undefined) {
      localStorage.setItem(LEGACY.Rose.rate, String(partial.rate));
    }
    if (persona === "Rose" && partial.pitch !== undefined) {
      localStorage.setItem(LEGACY.Rose.pitch, String(partial.pitch));
    }
    if (persona === "Lily") {
      localStorage.setItem(LEGACY.Lily, JSON.stringify(next));
    }
    return Core.mergeVoiceSettings(persona, next);
  }

  function restoreDefaults(persona) {
    localStorage.removeItem(storageKey(persona));
    if (persona === "Lily") localStorage.removeItem(LEGACY.Lily);
    if (persona === "Rose") {
      localStorage.removeItem(LEGACY.Rose.voice);
      localStorage.removeItem(LEGACY.Rose.rate);
      localStorage.removeItem(LEGACY.Rose.pitch);
    }
    return loadSettings(persona);
  }

  function refreshVoices() {
    if (!window.speechSynthesis) return [];
    voiceCache = window.speechSynthesis.getVoices() || [];
    voicesReady = voiceCache.length > 0;
    return voiceCache;
  }

  function initVoices() {
    refreshVoices();
    if (!window.speechSynthesis) return;
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      refreshVoices();
      document.dispatchEvent(new CustomEvent("florisyn-voices-ready"));
    });
    let tries = 0;
    const poll = setInterval(() => {
      refreshVoices();
      tries += 1;
      if (voicesReady || tries > 12) clearInterval(poll);
    }, 250);
  }

  function resolveVoice(persona, cfg) {
    const voices = refreshVoices();
    return Core.pickAssistantVoice(voices, persona, cfg.voiceName);
  }

  function speakBrowser(persona, text, cfg, force) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) {
        resolve(false);
        return;
      }
      const sentences = Core.splitSpeechSentences(text);
      if (!sentences.length) {
        resolve(false);
        return;
      }
      window.speechSynthesis.cancel();
      speaking = true;
      let idx = 0;
      const voice = resolveVoice(persona, cfg);

      function speakNext() {
        if (idx >= sentences.length) {
          speaking = false;
          resolve(true);
          return;
        }
        const u = new SpeechSynthesisUtterance(sentences[idx++]);
        if (voice) u.voice = voice;
        u.rate = cfg.rate;
        u.pitch = cfg.pitch;
        u.volume = cfg.volume;
        u.lang = voice?.lang || "en-US";
        u.onend = () => {
          if (idx < sentences.length) setTimeout(speakNext, persona === "Rose" ? 120 : 90);
          else {
            speaking = false;
            resolve(true);
          }
        };
        u.onerror = () => {
          speaking = false;
          resolve(false);
        };
        window.speechSynthesis.speak(u);
      }
      speakNext();
    });
  }

  async function tryCloudSpeak(persona, text) {
    try {
      const res = await fetch("/.netlify/functions/assistant-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona, text: Core.prepareAssistantSpeechText(text, 800) })
      });
      const data = await res.json().catch(() => ({}));
      if (data.audioBase64 && typeof Audio !== "undefined") {
        const audio = new Audio(`data:audio/mpeg;base64,${data.audioBase64}`);
        await audio.play();
        return true;
      }
    } catch {
      /* fall through */
    }
    return false;
  }

  async function speak(persona, text, options = {}) {
    const who = persona === "Rose" ? "Rose" : persona === "Daisy" ? "Daisy" : "Lily";
    const force = Boolean(options.force);
    const respectToggle = options.respectToggle !== false;
    if (respectToggle && !force && ctx.getSpeakEnabled?.() === false) return false;

    const clean = Core.prepareAssistantSpeechText(text);
    if (!clean) return false;

    const cfg = loadSettings(who);
    if (cfg.engine === "cloud") {
      const cloudOk = await tryCloudSpeak(who, clean);
      if (cloudOk) return true;
    }

    return speakBrowser(who, clean, cfg, force);
  }

  function mountPersonaPanel(root, persona) {
    const id = persona === "Rose" ? "roseVoicePanel" : persona === "Daisy" ? "daisyVoicePanel" : "lilyVoicePanel";
    if (!root || root.querySelector(`#${id}`)) return;
    const cfg = loadSettings(persona);
    const def = Core.VOICE_DEFAULTS[persona];
    const blurb =
      persona === "Lily"
        ? "Warm, friendly, cheerful — creative partner energy."
        : persona === "Rose"
          ? "Mature, confident, lightly humorous — never harsh."
          : "Bright, gentle, encouraging — a soft mascot voice.";

    root.insertAdjacentHTML(
      "beforeend",
      `<section class="panel assistant-voice-panel" id="${id}" data-persona="${persona}">
        <p class="eyebrow">${persona.toUpperCase()} VOICE</p>
        <h2>Natural speech</h2>
        <p class="subtle">${blurb} Uses your device's best English voice when cloud voice is unavailable.</p>
        <label>${persona} voice
          <select class="assistant-voice-select" data-persona="${persona}">
            <option value="">Best available on this device</option>
          </select>
        </label>
        <div class="two">
          <label>Speaking speed
            <input type="range" class="assistant-voice-rate" data-persona="${persona}" min="0.75" max="1.15" step="0.02" value="${cfg.rate}">
          </label>
          <label>Pitch / warmth
            <input type="range" class="assistant-voice-pitch" data-persona="${persona}" min="0.85" max="1.12" step="0.02" value="${cfg.pitch}">
          </label>
        </div>
        <div class="dialog-tools">
          <button type="button" class="secondary assistant-voice-preview" data-persona="${persona}">Preview ${persona}</button>
          <button type="button" class="secondary assistant-voice-restore" data-persona="${persona}">Restore defaults</button>
        </div>
      </section>`
    );

    const panel = root.querySelector(`#${id}`);
    const sel = panel.querySelector(".assistant-voice-select");

    function fillSelect() {
      const voices = refreshVoices().filter((v) => /^en/i.test(v.lang || "en-US"));
      const current = loadSettings(persona).voiceName;
      sel.innerHTML =
        '<option value="">Best available on this device</option>' +
        voices
          .map(
            (v) =>
              `<option value="${esc(v.name)}" ${v.name === current ? "selected" : ""}>${esc(v.name)}${
                v.lang ? ` (${esc(v.lang)})` : ""
              }</option>`
          )
          .join("");
    }

    fillSelect();
    document.addEventListener("florisyn-voices-ready", fillSelect);

    sel.addEventListener("change", () => {
      saveSettings(persona, { voiceName: sel.value });
      window.toast?.(`${persona} voice saved for this shop on this device`);
    });
    panel.querySelector(".assistant-voice-rate")?.addEventListener("input", (e) => {
      saveSettings(persona, { rate: Number(e.target.value) });
    });
    panel.querySelector(".assistant-voice-pitch")?.addEventListener("input", (e) => {
      saveSettings(persona, { pitch: Number(e.target.value) });
    });
    panel.querySelector(".assistant-voice-preview")?.addEventListener("click", () => {
      speak(persona, def.preview, { force: true, respectToggle: false });
    });
    panel.querySelector(".assistant-voice-restore")?.addEventListener("click", () => {
      const next = restoreDefaults(persona);
      sel.value = next.voiceName || "";
      panel.querySelector(".assistant-voice-rate").value = String(next.rate);
      panel.querySelector(".assistant-voice-pitch").value = String(next.pitch);
      window.toast?.(`${persona} voice reset to Florisyn defaults`);
    });
  }

  function mountSettings(root) {
    if (!root) return;
    const host = root.querySelector("#assistantVoiceSettingsHost") || root;
    if (!host.querySelector("#assistantVoiceSettingsIntro")) {
      host.insertAdjacentHTML(
        "afterbegin",
        `<div id="assistantVoiceSettingsIntro" class="assistant-voice-intro">
          <p class="eyebrow">LILY, ROSE &amp; DAISY</p>
          <h2>Assistant voices</h2>
          <p class="subtle">Tune how Lily, Rose, and Daisy sound on this device. Settings are saved per shop and user.</p>
        </div>`
      );
    }
    mountPersonaPanel(host, "Lily");
    mountPersonaPanel(host, "Rose");
    mountPersonaPanel(host, "Daisy");
    const legacyLily = host.querySelector("#lilyVoiceRc2");
    if (legacyLily) legacyLily.remove();
  }

  function init(options = {}) {
    ctx = { ...ctx, ...options };
    initVoices();
  }

  function patchLegacyHooks() {
    if (window.__florisynVoicePatched) return;
    window.__florisynVoicePatched = true;
  }

  window.FlorisynAssistantVoice = {
    init,
    speak,
    loadSettings,
    saveSettings,
    restoreDefaults,
    refreshVoices,
    mountSettings,
    mountPersonaPanel,
    patchLegacyHooks
  };

  init({
    getScope: () => {
      const shop =
        window.shopSettings?.shop_id ||
        window.session?.shopId ||
        window.session?.user?.default_shop_id ||
        "shop";
      const user = window.session?.user?.id || "local";
      return `${shop}:${user}`;
    },
    getSpeakEnabled: () => {
      const el = document.querySelector("#assistantSpeak");
      return el ? el.checked : true;
    }
  });
})();
