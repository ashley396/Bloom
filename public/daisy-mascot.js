/**
 * Daisy appears only in the top assistant dock (index.html).
 * Floating/bottom mascot and wag animation are intentionally disabled.
 */
(function () {
  function noop() {}

  window.BloomRose = {
    mount: noop,
    mountSettings: noop,
    gentleWag: noop,
    load: () => ({ mode: "stationary", hidden: true, reduceMotion: true, seasonal: "none" }),
    save: noop
  };
  window.BloomDaisy = window.BloomRose;
})();
