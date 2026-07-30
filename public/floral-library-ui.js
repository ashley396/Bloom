(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;

  let masterCache = null;
  let libraryVisible = 60;

  async function loadMaster() {
    if (masterCache) return masterCache;
    if (window.api) {
      try {
        const d = await window.api("floral-library?action=starter", { method: "GET" });
        masterCache = d.products || [];
        return masterCache;
      } catch {
        masterCache = [];
      }
    }
    return masterCache || [];
  }

  function getMaster() {
    return masterCache || [];
  }

  function ensurePreviewDialog() {
    let dlg = document.getElementById("libraryPreviewDialog");
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.id = "libraryPreviewDialog";
    dlg.className = "rc2-ws-dialog library-preview-dialog";
    dlg.innerHTML = `<div class="dialog-shell"><div class="heading"><div><p class="eyebrow">FLORAL LIBRARY</p><h2 id="libraryPreviewTitle">Arrangement</h2><p class="subtle" id="libraryPreviewTier"></p></div><button class="close" type="button" aria-label="Close">×</button></div><img id="libraryPreviewImage" alt="" class="library-preview-image" width="640" height="480"><div class="library-preview-grid"><section><p class="eyebrow">RECIPE</p><ul id="libraryPreviewRecipe"></ul></section><section><p class="eyebrow">PRODUCTION</p><dl id="libraryPreviewMeta"></dl></section></div><section><p class="eyebrow">BUILD STEPS</p><ol id="libraryPreviewSteps"></ol></section><section><p class="eyebrow">WHY THIS DESIGN WORKS</p><p id="libraryPreviewWhy"></p></section><div class="dialog-tools"><button type="button" class="secondary close">Close</button><button type="button" class="primary" id="libraryPreviewAdd">Add to My Shop</button></div></div>`;
    document.body.appendChild(dlg);
    dlg.querySelectorAll(".close").forEach((btn) =>
      btn.addEventListener("click", () => dlg.close())
    );
    window.FlorisynRC2?.enhanceDialogs?.();
    return dlg;
  }

  function openPreview(id) {
    const p = getMaster().find((x) => x.id === id);
    if (!p) return;
    const dlg = ensurePreviewDialog();
    dlg.dataset.libraryId = id;
    document.getElementById("libraryPreviewTitle").textContent = p.name;
    document.getElementById("libraryPreviewTier").textContent = [
      p.catalog_tier || p.categories?.[0],
      p.design_style || p.style,
      p.color_palette,
    ]
      .filter(Boolean)
      .join(" · ");
    const img = document.getElementById("libraryPreviewImage");
    img.src = p.primary_image?.url || "";
    img.alt = p.primary_image?.alt || p.name;
    document.getElementById("libraryPreviewRecipe").innerHTML = (p.recipe || [])
      .map((r) => `<li><strong>${esc(r.qty)}</strong> ${esc(r.name)}</li>`)
      .join("");
    document.getElementById("libraryPreviewMeta").innerHTML = [
      ["Container", p.container],
      ["Mechanics", p.mechanics],
      ["Foliage", p.foliage],
      ["Est. design time", p.estimated_design_minutes ? `${p.estimated_design_minutes} min` : null],
      ["Suggested retail", money(p.suggested_retail?.default)],
    ]
      .filter(([, v]) => v)
      .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
      .join("");
    document.getElementById("libraryPreviewSteps").innerHTML = (p.instructions || [])
      .map((s) => `<li>${esc(s)}</li>`)
      .join("");
    document.getElementById("libraryPreviewWhy").textContent = p.why_it_works || "";
    document.getElementById("libraryPreviewAdd").onclick = () => {
      dlg.close();
      addToShop(id, "published");
    };
    dlg.showModal();
    window.FlorisynRC2?.enhanceDialogs?.();
  }

  async function renderLibrary() {
    const list = document.getElementById("libraryList");
    if (!list) return;
    const q = (document.getElementById("librarySearch")?.value || "").toLowerCase();
    const cat = document.getElementById("libraryCategory")?.value || "";
    const products = getMaster();
    const rows = products.filter((p) => {
      const text = `${p.name} ${(p.categories || []).join(" ")} ${p.description} ${p.catalog_tier || ""}`.toLowerCase();
      return (!q || text.includes(q)) && (!cat || (p.categories || []).includes(cat));
    });
    const visible = rows.slice(0, libraryVisible);
    list.innerHTML = visible.length
      ? visible
          .map((p) => {
            const stems = (p.recipe || []).reduce((s, r) => s + Number(r.qty || 0), 0);
            const retail = Number(p.suggested_retail?.default || 0);
            const cost = Number(p.suggested_cost || retail * 0.42);
            const profit = Math.max(0, retail - cost);
            const designMin = p.estimated_design_minutes || 12 + (stems % 18);
            const recipeLine = (p.recipe || [])
              .map((r) => `${r.qty} ${esc(r.name)}`)
              .join(" · ");
            return `<article class="product-card floral-library-card" data-library-id="${esc(p.id)}">
        <img src="${esc(p.primary_image?.url)}" alt="${esc(p.primary_image?.alt || p.name)}" loading="lazy" width="480" height="360">
        <div class="body"><span class="badge">${esc(p.catalog_tier || p.categories?.[0] || "Floral")}</span>
        <h3>${esc(p.name)}</h3><p>${esc(p.short_description || p.description)}</p>
        <div class="price">${money(p.suggested_retail?.default)}</div>
        <div class="recipe-preview"><strong>Recipe</strong><span>${recipeLine || "Starter stems included"}</span></div>
        <div class="library-recipe-meta"><span>${stems} stems</span><span>~${designMin} min design</span><span>Est. profit ${money(profit)}</span></div>
        <p class="subtle">${esc(p.container || "Retail container")} · ${esc(p.design_style || p.style || "classic")}</p>
        <div class="card-actions">
          <button type="button" class="secondary" data-library-preview="${esc(p.id)}">View recipe</button>
          <button type="button" class="primary" data-library-add="${esc(p.id)}">Add to My Shop</button>
          <button type="button" class="secondary" data-library-draft="${esc(p.id)}">Add as draft</button>
        </div></div></article>`;
          })
          .join("") +
        (rows.length > libraryVisible
          ? `<div class="card-actions"><button type="button" class="secondary" id="libraryLoadMore">Show more (${rows.length - libraryVisible} remaining)</button><p class="subtle">${rows.length} retail-ready designs in Florisyn catalog</p></div>`
          : `<p class="subtle">${rows.length} retail-ready designs in Florisyn catalog</p>`)
      : `<div class="bloom-empty-luxury" role="status"><strong>No library designs match your search.</strong><p>Try roses, hydrangea, sympathy, or budget-friendly.</p></div>`;
    document.getElementById("libraryLoadMore")?.addEventListener("click", () => {
      libraryVisible += 60;
      renderLibrary();
    });
    bindActions();
  }

  function bindActions() {
    document.querySelectorAll("[data-library-add]").forEach((btn) =>
      btn.addEventListener("click", () => addToShop(btn.dataset.libraryAdd, "published"))
    );
    document.querySelectorAll("[data-library-draft]").forEach((btn) =>
      btn.addEventListener("click", () => addToShop(btn.dataset.libraryDraft, "draft"))
    );
    document.querySelectorAll("[data-library-preview]").forEach((btn) =>
      btn.addEventListener("click", () => openPreview(btn.dataset.libraryPreview))
    );
  }

  async function addToShop(id, status) {
    const p = getMaster().find((x) => x.id === id);
    if (!p) return;
    window.toast?.(`Adding ${p.name} to your shop catalog…`);
    try {
      if (window.api) {
        await window.api("products", {
          method: "POST",
          body: JSON.stringify({
            name: p.name,
            description: p.description,
            price: p.suggested_retail?.default,
            category: p.categories?.[0],
            image_url: p.primary_image?.url,
            recipe: p.recipe,
            library_master_id: p.id,
            publish_status: status,
          }),
        });
      }
      window.toast?.(`${p.name} copied to your shop — master library unchanged.`);
    } catch (e) {
      window.toast?.(e.message);
    }
  }

  let libraryUiBound = false;

  async function init() {
    await loadMaster();
    if (!libraryUiBound) {
      libraryUiBound = true;
      document.getElementById("librarySearch")?.addEventListener("input", () => renderLibrary());
      document.getElementById("libraryCategory")?.addEventListener("change", () => renderLibrary());
    }
    await renderLibrary();
  }

  window.BloomFloralLibraryUI = { renderLibrary, init, getMaster, openPreview };
})();
