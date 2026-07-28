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
        <p class="eyebrow">THEME GALLERY</p>
        <h2>Compare launch modes</h2>
        <p class="subtle">Switch styles without losing page content. Confirm before applying.</p>
        <div id="themeGalleryGrid" class="theme-gallery-grid"></div>
        <div class="card-actions">
          <button type="button" class="secondary" id="themeCompareBtn">Compare selected</button>
          <button type="button" class="primary" id="themeApplyBtn">Apply theme</button>
          <button type="button" class="secondary" id="themeRestoreBtn">Restore previous theme</button>
        </div>
        <p id="themeGalleryStatus" class="subtle" aria-live="polite"></p>
      </div>`
    );

    let modes = [];
    let selected = new Set();
    let previousTheme = null;
    let currentSite = null;

    api("launch_modes").then((d) => {
      modes = d.modes || [];
      renderCards();
    });

    function renderCards() {
      const grid = root.querySelector("#themeGalleryGrid");
      grid.innerHTML = modes
        .map(
          (m) => `<article class="theme-card" data-id="${esc(m.id)}">
            <h3>${esc(m.label)}</h3>
            <div class="theme-previews"><span class="preview-chip">Desktop</span><span class="preview-chip">Tablet</span><span class="preview-chip">Mobile</span></div>
            <div class="palette" style="background:linear-gradient(90deg,${m.palette.join(",")})" aria-hidden="true"></div>
            <p class="subtle">Font: ${esc(m.fontPair)}</p>
            <label class="check"><input type="checkbox" data-fav="${esc(m.id)}"> Favorite</label>
            <label class="check"><input type="checkbox" data-select="${esc(m.id)}"> Compare</label>
          </article>`
        )
        .join("");
    }

    root.querySelector("#themeApplyBtn")?.addEventListener("click", async () => {
      const id = [...selected][0] || modes[0]?.id;
      if (!id) return;
      if (!confirm("Apply this theme? Page content will stay the same.")) return;
      const status = root.querySelector("#themeGalleryStatus");
      status.textContent = "Applying theme…";
      try {
        const d = await api("switch_theme", { launch_mode: id, confirmed: true, persist: true, site: currentSite });
        previousTheme = d.previous_theme;
        currentSite = d.site;
        status.textContent = `${modes.find((m) => m.id === id)?.label || id} applied.`;
        window.toast?.("Theme updated");
      } catch (e) {
        status.textContent = e.message;
      }
    });

    root.querySelector("#themeRestoreBtn")?.addEventListener("click", async () => {
      if (!previousTheme) return root.querySelector("#themeGalleryStatus").textContent = "No previous theme saved.";
      const d = await api("restore_theme", { previous_theme: previousTheme, site: currentSite });
      root.querySelector("#themeGalleryStatus").textContent = d.restored ? "Previous theme restored." : "Nothing to restore.";
    });

    root.querySelector("#themeGalleryGrid")?.addEventListener("change", (e) => {
      const sel = e.target.closest("[data-select]");
      if (!sel) return;
      if (sel.checked) selected.add(sel.dataset.select);
      else selected.delete(sel.dataset.select);
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
