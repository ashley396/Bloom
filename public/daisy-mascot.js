(function () {
  const KEY = "bloom_daisy_settings";
  const defaults = { mode: "stationary", hidden: false, reduceMotion: false, seasonal: "none" };

  function load() {
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    } catch {
      return { ...defaults };
    }
  }

  function save(partial) {
    const next = { ...load(), ...partial };
    localStorage.setItem(KEY, JSON.stringify(next));
    apply(next);
    return next;
  }

  function prefersReducedMotion() {
    return load().reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  let wagTimer = null;

  function mount() {
    // Removed: the floating on-screen Daisy dog mascot is retired (it overlapped
    // the sidebar). Daisy still appears as an avatar in the top assistant dock.
    // Also clean up any previously-mounted instance.
    const existing = document.getElementById("bloomDaisy");
    if (existing) existing.remove();
    return;
  }

  function apply(settings) {
    const el = document.getElementById("bloomDaisy");
    if (!el) return;
    el.hidden = !!settings.hidden;
    el.classList.toggle("bloom-daisy--interactive", settings.mode === "interactive");
    el.classList.toggle("bloom-daisy--reduced", prefersReducedMotion());
    if (settings.seasonal === "holiday") el.dataset.seasonal = "holiday";
    else el.removeAttribute("data-seasonal");
  }

  function gentleWag(reason) {
    if (load().hidden || prefersReducedMotion()) return;
    const el = document.getElementById("bloomDaisy");
    if (!el) return;
    clearTimeout(wagTimer);
    el.classList.add("bloom-daisy--wag");
    el.setAttribute("aria-label", reason || "Daisy acknowledges an update");
    wagTimer = setTimeout(() => {
      el.classList.remove("bloom-daisy--wag");
      el.classList.add("bloom-daisy--resting");
    }, 2200);
  }

  function mountSettings(root) {
    if (!root || root.querySelector("#daisySettingsPanel")) return;
    const s = load();
    root.insertAdjacentHTML(
      "beforeend",
      `<section class="panel bloom-daisy-settings" id="daisySettingsPanel">
        <p class="eyebrow">DAISY</p>
        <h2>Shop mascot</h2>
        <p class="subtle">Daisy stays nearby with Lily &amp; Rose — never blocks your work.</p>
        <label class="check"><input type="checkbox" id="daisyHide" ${s.hidden ? "checked" : ""}> Hide Daisy</label>
        <label>Mode<select id="daisyMode">
          <option value="stationary" ${s.mode === "stationary" ? "selected" : ""}>Stationary (default)</option>
          <option value="interactive" ${s.mode === "interactive" ? "selected" : ""}>Interactive</option>
        </select></label>
        <label class="check"><input type="checkbox" id="daisyReduce" ${s.reduceMotion ? "checked" : ""}> Reduce motion</label>
        <label>Seasonal accessory<select id="daisySeasonal">
          <option value="none">None</option>
          <option value="holiday" ${s.seasonal === "holiday" ? "selected" : ""}>Holiday bandana</option>
        </select></label>
      </section>`
    );
    const persist = () =>
      save({
        hidden: root.querySelector("#daisyHide")?.checked,
        mode: root.querySelector("#daisyMode")?.value,
        reduceMotion: root.querySelector("#daisyReduce")?.checked,
        seasonal: root.querySelector("#daisySeasonal")?.value
      });
    root.querySelector("#daisyHide")?.addEventListener("change", persist);
    root.querySelector("#daisyMode")?.addEventListener("change", persist);
    root.querySelector("#daisyReduce")?.addEventListener("change", persist);
    root.querySelector("#daisySeasonal")?.addEventListener("change", persist);
  }

  // Naming cleanup: this file's own settings panel, storage key, and every
  // label in it say "DAISY" — but the primary global it exported was named
  // after Rose instead (with BloomDaisy only aliased second), and app.js
  // booted the Daisy mascot through that Rose-named global. That collided
  // in name (though never in behavior — the real Rose business advisor
  // lives entirely separately in florisyn-luxury-business-os.js's
  // window.FlorisynBusinessOs) with an assistant this file has nothing to
  // do with. BloomDaisy is now the real export.
  window.BloomDaisy = {
    mount,
    mountSettings,
    gentleWag,
    load,
    save
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("app") && !document.getElementById("app").hidden) mount();
  });
})();
