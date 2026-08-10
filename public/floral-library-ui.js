(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;

  let masterCache = null;
  let libraryVisible = 50;
  let libraryInitPromise = null;

  function isRc2FillerProduct(p) {
    const id = String(p?.id || "");
    if (id.startsWith("lib-rc2-")) return true;
    if (id.startsWith("lib-")) return true;
    if (id.startsWith("sig-")) return true;
    if ((p?.tags || []).includes("rc2_starter")) return true;
    if (p?.image_license?.source === "licensed_stock_pexels") return true;
    if (/^Garden \w+ (Bouquet|Birthday|Anniversary|Romance|Wedding)/.test(String(p?.name || ""))) return true;
    return false;
  }

  function signatureCollection() {
    return Array.isArray(window.FlorisynLibraryCollection) ? window.FlorisynLibraryCollection : [];
  }

  function mergeCatalog(signature, remote) {
    const merged = new Map();
    for (const p of signature) {
      if (p?.id) merged.set(p.id, p);
    }
    for (const p of remote) {
      if (!p?.id || isRc2FillerProduct(p)) continue;
      if (!merged.has(p.id)) merged.set(p.id, p);
    }
    return merged.size ? [...merged.values()] : signature;
  }

  async function loadMaster(force = false) {
    if (masterCache && !force) return masterCache;
    const signature = signatureCollection();
    let remote = [];
    if (window.api) {
      try {
        const d = await window.api("floral-library?action=starter", { method: "GET" });
        remote = Array.isArray(d.products) ? d.products.filter((p) => !isRc2FillerProduct(p)) : [];
      } catch {
        remote = [];
      }
    }
    masterCache = mergeCatalog(signature, remote);
    return masterCache;
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
        <h3>${esc(p.name)}</h3><p>${esc(p.short_description || p.description || "")}</p>
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

  function openLibraryPreview(id) {
    const p = getMaster().find((x) => x.id === id);
    if (!p) return;
    const form = document.getElementById("libraryDesignForm");
    const dialog = document.getElementById("libraryDesignDialog");
    if (!form || !dialog) {
      window.toast?.("Preview is loading — try again in a moment.");
      return;
    }
    form.elements.name.value = p.name || "";
    form.elements.category.value = p.categories?.[0] || "Everyday";
    form.elements.price.value = Number(p.suggested_retail?.default || 0);
    form.elements.description.value = p.description || p.short_description || "";
    form.elements.image_url.value = p.primary_image?.url || "";
    const img = document.getElementById("libraryDesignImage");
    if (img) {
      img.src = p.primary_image?.url || "";
      img.hidden = !p.primary_image?.url;
      img.alt = p.primary_image?.alt || p.name || "Floral arrangement";
    }
    const rows = document.getElementById("libraryRecipeRows");
    if (rows) {
      rows.innerHTML = (p.recipe || [])
        .map(
          (r, i) => `<div class="library-recipe-row"><label>Flower or supply<input data-library-ingredient value="${esc(r.name)}"></label><label>Quantity<input data-library-quantity type="number" min="0" step=".1" value="${Number(r.qty || 1)}"></label><button type="button" class="secondary danger" data-remove-library-line="${i}">Delete line</button></div>`
        )
        .join("");
    }
    dialog.showModal();
  }

  function bindActions() {
    document.querySelectorAll("[data-library-add]").forEach((btn) =>
      btn.addEventListener("click", () => addToShop(btn.dataset.libraryAdd, "published"))
    );
    document.querySelectorAll("[data-library-draft]").forEach((btn) =>
      btn.addEventListener("click", () => addToShop(btn.dataset.libraryDraft, "draft"))
    );
    document.querySelectorAll("[data-library-preview]").forEach((btn) =>
      btn.addEventListener("click", () => openLibraryPreview(btn.dataset.libraryPreview))
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
    if (!libraryInitPromise) {
      libraryInitPromise = (async () => {
        if (signatureCollection().length) {
          masterCache = mergeCatalog(signatureCollection(), []);
          await renderLibrary();
        }
        await loadMaster(true);
        document.getElementById("librarySearch")?.addEventListener("input", () => renderLibrary());
        document.getElementById("libraryCategory")?.addEventListener("change", () => renderLibrary());
        await renderLibrary();
      })();
    }
    return libraryInitPromise;
  }

  window.BloomFloralLibraryUI = { renderLibrary, init, getMaster };
})();
