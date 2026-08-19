(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  async function api(action, extra = {}) {
    return window.api("instant-website", { method: "POST", body: JSON.stringify({ action, ...extra }) });
  }

  function mountGallery(root) {
    if (!root || root.querySelector(".theme-gallery-shell")) return;
    root.insertAdjacentHTML(
      "afterbegin",
      `<div class="theme-gallery-shell panel">
        <p class="eyebrow">WEBSITE LOOK &amp; FEEL</p>
        <h2>Visual theme previews</h2>
        <p class="subtle">Preview any look with your real content — no save required. Apply only when you're ready.</p>
        <div id="themeGalleryGrid" class="theme-gallery-grid"></div>
        <dialog id="themePreviewDialog" class="theme-preview-modal">
          <div class="panel-heading"><h3 id="themePreviewTitle">Preview</h3><button type="button" class="secondary" id="themePreviewClose">Close</button></div>
          <div class="theme-preview-frame" id="themePreviewFrame"></div>
          <div class="card-actions">
            <button type="button" class="primary" id="themePreviewApply">Apply theme</button>
          </div>
        </dialog>
        <p id="themeGalleryStatus" class="subtle" aria-live="polite"></p>
      </div>`
    );

    let modes = [];
    let previewModeId = null;
    let previousTheme = null;
    let currentSite = null;

    // Every other api() call in this file catches its own failure and
    // shows it inline via #themeGalleryStatus — this one didn't, so any
    // transient failure (network blip, session refresh racing this
    // request, a backend hiccup) became an unhandled promise rejection.
    // app.js's global window.addEventListener("unhandledrejection", ...)
    // turns that into an unrelated-looking toast the moment a florist
    // opens Website Builder, with no obvious cause and no way to retry —
    // exactly the "Error occurred" report this fixes.
    api("launch_modes")
      .then((d) => {
        modes = d.modes || [];
        renderCards();
      })
      .catch((e) => {
        const status = root.querySelector("#themeGalleryStatus");
        if (status) status.textContent = e.message || "Website templates could not be loaded. Try again.";
      });

    function deviceMock(mode, device) {
      const w = device === "mobile" ? "100%" : device === "tablet" ? "768px" : "100%";
      return `<div class="theme-preview-device" style="--preview-bg:${mode.palette[0]};max-width:${w}">
        <span>${device}</span>
        <div style="padding:12px;font-family:serif;color:${mode.palette[2] || "#333"}">
          <div style="height:8px;width:60%;background:${mode.palette[1]};border-radius:4px;margin-bottom:8px"></div>
          <strong style="font-size:${device === "mobile" ? "14px" : "18px"}">${esc(window.shopSettings?.name || "Your Florist")}</strong>
          <p style="font-size:12px;opacity:.8;margin:8px 0">Featured arrangements · Shop · Sympathy</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
            <div style="aspect-ratio:1;background:${mode.palette[1]}33;border-radius:8px"></div>
            <div style="aspect-ratio:1;background:${mode.palette[1]}33;border-radius:8px"></div>
          </div>
        </div>
      </div>`;
    }

    function openPreview(mode) {
      previewModeId = mode.id;
      const dlg = root.querySelector("#themePreviewDialog");
      root.querySelector("#themePreviewTitle").textContent = mode.label;
      root.querySelector("#themePreviewFrame").innerHTML =
        deviceMock(mode, "desktop") + deviceMock(mode, "tablet") + deviceMock(mode, "mobile");
      dlg.showModal();
    }

    // Readable style description per fontPair id — every template card was
    // previously showing the identical hardcoded caption ("Serif + sans ·
    // product cards · soft buttons") regardless of which template it was,
    // with no name anywhere. Eight anonymous gradient blocks with the same
    // subtitle is why templates were hard to find/tell apart.
    const FONT_PAIR_DESCRIPTIONS = {
      elegant_serif_sans: "Cormorant Garamond + Source Sans",
      romantic_script_accent: "Cormorant Garamond + script accent",
      modern_luxury_serif: "Playfair Display + Inter",
      traditional_florist: "Libre Baskerville + Nunito Sans",
      clean_contemporary: "Clean, contemporary sans"
    };

    function renderCards() {
      const grid = root.querySelector("#themeGalleryGrid");
      grid.innerHTML = modes
        .map(
          (m) => `<article class="theme-card panel" data-id="${esc(m.id)}">
            <div class="theme-card-preview" style="background:linear-gradient(145deg,${m.palette.join(",")});min-height:100px;border-radius:12px"></div>
            <h3 class="theme-card-name">${esc(m.label || m.id)}</h3>
            <p class="subtle">${esc(FONT_PAIR_DESCRIPTIONS[m.fontPair] || "Serif + sans")} · product cards · soft buttons</p>
            <div class="card-actions">
              <button type="button" class="secondary" data-preview="${esc(m.id)}">Preview</button>
              <button type="button" class="primary" data-apply="${esc(m.id)}">Apply theme</button>
            </div>
          </article>`
        )
        .join("");
    }

    root.querySelector("#themeGalleryGrid")?.addEventListener("click", async (e) => {
      const prev = e.target.closest("[data-preview]");
      if (prev) {
        const mode = modes.find((m) => m.id === prev.dataset.preview);
        if (mode) openPreview(mode);
        return;
      }
      const apply = e.target.closest("[data-apply]");
      if (apply) {
        const mode = modes.find((m) => m.id === apply.dataset.apply);
        if (!mode) return;
        if (!confirm(`Apply ${mode.label}? Your page content stays the same.`)) return;
        try {
          const d = await api("switch_theme", { launch_mode: mode.id, confirmed: true, persist: true, site: currentSite });
          previousTheme = d.previous_theme;
          currentSite = d.site;
          root.querySelector("#themeGalleryStatus").textContent = `${mode.label} applied.`;
          window.toast?.("Theme updated");
        } catch (err) {
          root.querySelector("#themeGalleryStatus").textContent = err.message;
        }
      }
    });

    root.querySelector("#themePreviewClose")?.addEventListener("click", () => root.querySelector("#themePreviewDialog").close());
    root.querySelector("#themePreviewApply")?.addEventListener("click", async () => {
      const mode = modes.find((m) => m.id === previewModeId);
      if (!mode) return;
      root.querySelector("#themePreviewDialog").close();
      root.querySelector(`[data-apply="${mode.id}"]`)?.click();
    });

    api("get_project")
      .then((d) => {
        currentSite = { project: d.project, pages: d.pages, theme_settings: d.project?.theme_settings };
      })
      .catch(() => {});
  }

  function load() {
    const page = document.getElementById("websitePage");
    if (page) mountGallery(page);
  }

  window.BloomThemeGallery = { load };
})();
