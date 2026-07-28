(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;

  let masterCache = null;

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
    list.innerHTML = rows.length
      ? rows
          .map(
            (p) => `<article class="product-card floral-library-card" data-library-id="${esc(p.id)}">
        <img src="${esc(p.primary_image?.url)}" alt="${esc(p.primary_image?.alt || p.name)}" loading="lazy" width="400" height="300">
        <div class="body"><span class="badge">${esc(p.categories?.[0] || "Floral")}</span>
        <h3>${esc(p.name)}</h3><p>${esc(p.short_description || p.description)}</p>
        <div class="price">${money(p.suggested_retail?.default)}</div>
        <p class="subtle">License: ${esc(p.image_license?.source)} · ${esc(p.image_license?.review_status)}</p>
        <div class="card-actions">
          <button type="button" class="secondary" data-library-preview="${esc(p.id)}">Preview</button>
          <button type="button" class="primary" data-library-add="${esc(p.id)}">Add to My Shop</button>
          <button type="button" class="secondary" data-library-draft="${esc(p.id)}">Add as draft</button>
        </div></div></article>`
          )
          .join("")
      : `<div class="bloom-empty-luxury" role="status"><strong>No library designs match your search.</strong><p>Try hydrangea, sympathy, or wedding.</p></div>`;
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
