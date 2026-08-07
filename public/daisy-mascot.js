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
    if (load().hidden) return;
    if (document.getElementById("bloomDaisy")) return;
    const el = document.createElement("div");
    el.id = "bloomDaisy";
    el.className = "bloom-daisy bloom-daisy--resting";
    el.setAttribute("aria-hidden", load().mode === "stationary" ? "true" : "false");
    el.innerHTML = `<img src="/assets/daisy/daisy-portrait.png" width="112" height="112" alt="Daisy">`;
    document.body.appendChild(el);
    apply(load());
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
