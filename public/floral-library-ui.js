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

  async function renderLibrary() {
    const list = document.getElementById("libraryList");
    if (!list) return;
    const q = (document.getElementById("librarySearch")?.value || "").toLowerCase();
    const cat = document.getElementById("libraryCategory")?.value || "";
    const products = getMaster();
    const rows = products.filter((p) => {
      const text = `${p.name} ${(p.categories || []).join(" ")} ${p.description}`.toLowerCase();
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
            const designMin = 12 + (stems % 18);
            const recipeLine = (p.recipe || [])
              .map((r) => `${r.qty} ${esc(r.name)}`)
              .join(" · ");
            const imageHtml =
              window.FlorisynMedia && window.FlorisynMedia.mediaImg
                ? window.FlorisynMedia.mediaImg({
                    url: p.primary_image?.url,
                    alt: p.primary_image?.alt || p.name,
                    width: 480,
                    height: 360
                  })
                : `<img src="${esc(p.primary_image?.url)}" alt="${esc(p.primary_image?.alt || p.name)}" loading="lazy" width="480" height="360">`;
            return `<article class="product-card floral-library-card" data-library-id="${esc(p.id)}">
        ${imageHtml}
        <div class="body"><span class="badge">${esc(p.categories?.[0] || "Floral")}</span>
        <h3>${esc(p.name)}</h3><p>${esc(p.short_description || p.description)}</p>
        <div class="price">${money(p.suggested_retail?.default)}</div>
        <div class="recipe-preview"><strong>Recipe</strong><span>${recipeLine || "Starter stems included"}</span></div>
        <div class="library-recipe-meta"><span>${stems} stems</span><span>~${designMin} min design</span><span>Est. profit ${money(profit)}</span></div>
        <p class="subtle">License: ${esc(p.image_license?.source)} · ${esc(p.image_license?.review_status)}</p>
        <div class="card-actions">
          <button type="button" class="secondary" data-library-preview="${esc(p.id)}">Preview</button>
          <button type="button" class="primary" data-library-add="${esc(p.id)}">Add to My Shop</button>
          <button type="button" class="secondary" data-library-draft="${esc(p.id)}">Add as draft</button>
        </div></div></article>`;
          })
          .join("") +
        (rows.length > libraryVisible
          ? `<div class="card-actions"><button type="button" class="secondary" id="libraryLoadMore">Show more (${rows.length - libraryVisible} remaining)</button><p class="subtle">${rows.length} designs in Florisyn catalog</p></div>`
          : `<p class="subtle">${rows.length} designs in Florisyn catalog</p>`)
      : `<div class="bloom-empty-luxury" role="status"><strong>No library designs match your search.</strong><p>Try hydrangea, sympathy, or wedding.</p></div>`;
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
            publish_status: status
          })
        });
      }
      window.toast?.(`${p.name} copied to your shop — master library unchanged.`);
    } catch (e) {
      window.toast?.(e.message);
    }
  }

  async function init() {
    await loadMaster();
    document.getElementById("librarySearch")?.addEventListener("input", () => renderLibrary());
    document.getElementById("libraryCategory")?.addEventListener("change", () => renderLibrary());
    await renderLibrary();
  }

  window.BloomFloralLibraryUI = { renderLibrary, init, getMaster };
})();
