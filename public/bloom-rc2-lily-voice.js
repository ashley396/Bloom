/** Back-compat shim — Lily voice settings delegate to FlorisynAssistantVoice. */
(function () {
  window.BloomLilyVoice = {
    load: () => window.FlorisynAssistantVoice?.loadSettings?.("Lily"),
    save: (partial) => window.FlorisynAssistantVoice?.saveSettings?.("Lily", partial),
    speakLily: (text) => window.FlorisynAssistantVoice?.speak?.("Lily", text, { force: true }),
    mountSettings: (root) => window.FlorisynAssistantVoice?.mountSettings?.(root),
    patchSpeakAssistant: () => window.FlorisynAssistantVoice?.patchLegacyHooks?.()
  };
})();
