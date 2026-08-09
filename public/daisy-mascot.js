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
    // Retired: the floating bottom-of-page mascot has been removed. Daisy now
    // appears as an avatar in the top assistant dock (Lily · Rose · Daisy).
    // Kept as a safe no-op so existing callers (showApp) don't break.
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
    el.setAttribute("aria-label", reason || "Rose companion acknowledges an update");
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
      `<section class="panel bloom-daisy-settings" id="roseSettingsPanel">
        <p class="eyebrow">ROSE COMPANION</p>
        <h2>Optional shop companion</h2>
        <p class="subtle">A quiet on-screen companion for Lily &amp; Rose — never blocks your work. (Legacy mascot; assistants are Lily and Rose.)</p>
        <label class="check"><input type="checkbox" id="daisyHide" ${s.hidden ? "checked" : ""}> Hide companion</label>
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

  window.BloomRose = {
    mount,
    mountSettings,
    gentleWag,
    load,
    save
  };
  window.BloomDaisy = window.BloomRose;

  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("app") && !document.getElementById("app").hidden) mount();
  });
})();
