/**
 * Florisyn Luxury Floral Library — Figma catalog grid (/floral-library).
 * Add to My Shop copies published; Add as Draft saves editable draft.
 */
(function () {
  const FILTERS = ["All Arrangements", "Everyday", "Sympathy", "Wedding", "Events", "Custom"];

  const CATALOG = [
    { id: "everyday-rose-mix", name: "Everyday Rose Mix", style: "Classic", price: 45, desc: "Soft pink and cream roses paired with delicate spray roses and lush ruscus in a clear cylinder vase — a timeless everyday staple.", size: "13 stems", time: "~12 min", profit: 22, recipe: "6x Roses, 3x Spray Roses, 4x Ruscus", image: "/images/library/everyday-rose-mix.jpg", tags: ["Everyday", "Romantic"], badge: "BEST SELLER" },
    { id: "sunshine-daisy-vase", name: "Sunshine Daisy Vase", style: "Cheerful", price: 32, desc: "Bright white and yellow daisies accented with golden solidago, arranged casually in a charming mason jar.", size: "13 stems", time: "~8 min", profit: 18, recipe: "10x Daisies, 3x Solidago", image: "/images/library/sunshine-daisy-vase.jpg", tags: ["Everyday", "Events"], badge: "NEW" },
    { id: "hydrangea-breeze", name: "Hydrangea Breeze", style: "Modern", price: 52, desc: "Lush white hydrangea blooms complemented by fresh pittosporum greenery in a sleek glass cube vase.", size: "8 stems", time: "~10 min", profit: 28, recipe: "3x Hydrangea, 5x Pittosporum", image: "/images/library/hydrangea-breeze.jpg", tags: ["Everyday", "Wedding"] },
    { id: "everyday-carnation-bundle", name: "Everyday Carnation Bundle", style: "Budget-friendly", price: 28, desc: "Classic pink and white carnations with baby's breath, wrapped in kraft paper for a quick grab-and-go option.", size: "15 stems", time: "~7 min", profit: 16, recipe: "12x Carnations, 3x Baby's Breath", image: "/images/library/everyday-carnation-bundle.jpg", tags: ["Everyday"] },
    { id: "stock-rose-garden", name: "Stock & Rose Garden", style: "Airy", price: 58, desc: "Fragrant lavender stock and blush roses with eucalyptus sprigs in an elegant ceramic vase.", size: "12 stems", time: "~15 min", profit: 30, recipe: "5x Stock, 4x Roses, 3x Eucalyptus", image: "/images/library/stock-rose-garden.jpg", tags: ["Everyday", "Wedding"] },
    { id: "alstroemeria-everyday-mix", name: "Alstroemeria Everyday Mix", style: "Simple", price: 35, desc: "Mixed pastel alstroemeria arranged with leatherleaf fern in a tall glass vase — long-lasting and colorful.", size: "14 stems", time: "~8 min", profit: 20, recipe: "10x Alstroemeria, 4x Leatherleaf", image: "/images/library/alstroemeria-everyday-mix.jpg", tags: ["Everyday"] },
    { id: "sunflower-smile", name: "Sunflower Smile", style: "Bright", price: 38, desc: "Bold yellow sunflowers with golden solidago in a charming farmhouse tin — instant sunshine for any counter.", size: "8 stems", time: "~8 min", profit: 20, recipe: "5x Sunflowers, 3x Solidago", image: "/images/library/sunflower-smile.jpg", tags: ["Everyday", "Events"] },
    { id: "mini-mum-cube", name: "Mini Mum Cube", style: "Compact", price: 30, desc: "Tight cluster of white mums with ruscus greenery in a small glass cube — perfect desk or bedside arrangement.", size: "11 stems", time: "~8 min", profit: 17, recipe: "8x Mums, 3x Ruscus", image: "/images/library/mini-mum-cube.jpg", tags: ["Everyday", "Sympathy"] },
    { id: "everyday-mixed-vase", name: "Everyday Mixed Vase", style: "Classic", price: 48, desc: "A balanced mix of pink roses, yellow daisies, white carnations, and fresh greens in a clear cylinder vase.", size: "12 stems", time: "~15 min", profit: 25, recipe: "3x Roses, 4x Daisies, 3x Carnations, 2x Greens", image: "/images/library/everyday-mixed-vase.jpg", tags: ["Everyday"] },
    { id: "lavender-stock-jar", name: "Lavender Stock Jar", style: "Rustic", price: 36, desc: "Fragrant lavender stock with delicate baby's breath arranged in a rustic mason jar — simple and elegant.", size: "9 stems", time: "~7 min", profit: 19, recipe: "6x Stock, 3x Baby's Breath", image: "/images/library/lavender-stock-jar.jpg", tags: ["Everyday", "Sympathy"] },
    { id: "everyday-tulip-bundle", name: "Everyday Tulip Bundle", style: "Modern", price: 34, desc: "Fresh yellow and pink tulips with minimal greenery, wrapped for a modern grab-and-go bundle.", size: "12 stems", time: "~5 min", profit: 18, recipe: "10x Tulips, 2x Greens", image: "/images/library/everyday-tulip-bundle.jpg", tags: ["Everyday"] },
    { id: "peach-rose-posy", name: "Peach Rose Posy", style: "Soft", price: 52, desc: "Warm peach and cream roses with spray roses and eucalyptus in an elegant ceramic vase.", size: "11 stems", time: "~12 min", profit: 27, recipe: "5x Roses, 3x Spray Roses, 3x Eucalyptus", image: "/images/library/peach-rose-posy.jpg", tags: ["Everyday", "Wedding"] },
    { id: "everyday-garden-mix", name: "Everyday Garden Mix", style: "Loose & Airy", price: 62, desc: "Generous garden-style mix of hydrangea, roses, stock, and greens in a large glass vase — a showstopper.", size: "12 stems", time: "~18 min", profit: 32, recipe: "2x Hydrangea, 4x Roses, 3x Stock, 3x Greens", image: "/images/library/everyday-garden-mix.jpg", tags: ["Everyday", "Events"], badge: "BEST SELLER" },
    { id: "daisy-carnation-cheer", name: "Daisy & Carnation Cheer", style: "Happy", price: 34, desc: "White daisies and pink carnations with fresh greens in a clear cylinder — cheerful and budget-friendly.", size: "15 stems", time: "~10 min", profit: 18, recipe: "6x Daisies, 6x Carnations, 3x Greens", image: "/images/library/daisy-carnation-cheer.jpg", tags: ["Everyday", "Events"] },
    { id: "everyday-orchid-stem", name: "Everyday Orchid Stem", style: "Minimal", price: 42, desc: "Single elegant white phalaenopsis orchid stem in a tall slender vase — modern sophistication with zero fuss.", size: "1 stem", time: "~3 min", profit: 25, recipe: "1x Phalaenopsis Stem", image: "/images/library/everyday-orchid-stem.jpg", tags: ["Everyday", "Custom"] },
    { id: "everyday-basket-mix", name: "Everyday Basket Mix", style: "Traditional", price: 55, desc: "Charming woven basket filled with roses, carnations, daisies, and lush greenery — classic gift arrangement.", size: "14 stems", time: "~18 min", profit: 28, recipe: "3x Roses, 4x Carnations, 4x Daisies, Greens", image: "/images/library/everyday-basket-mix.jpg", tags: ["Everyday", "Sympathy"] },
    { id: "pink-mum-rose-cube", name: "Pink Mum & Rose Cube", style: "Compact", price: 40, desc: "Pink mums and roses with fresh greens arranged tightly in a glass cube — compact and elegant.", size: "10 stems", time: "~10 min", profit: 22, recipe: "4x Mums, 3x Roses, 3x Greens", image: "/images/library/pink-mum-rose-cube.jpg", tags: ["Everyday"] },
    { id: "everyday-green-white", name: "Everyday Green & White", style: "Clean", price: 48, desc: "Pure white hydrangea with lush ruscus greenery in a glass vase — clean, modern, and versatile.", size: "7 stems", time: "~8 min", profit: 26, recipe: "3x Hydrangea, 4x Ruscus", image: "/images/library/everyday-green-white.jpg", tags: ["Everyday", "Wedding", "Sympathy"] },
    { id: "everyday-mixed-wrap", name: "Everyday Mixed Wrap", style: "Grab-and-go", price: 30, desc: "Bright mixed roses, carnations, and daisies with greens in rustic kraft wrap — perfect impulse buy.", size: "12 stems", time: "~7 min", profit: 16, recipe: "3x Roses, 3x Carnations, 3x Daisies, Greens", image: "/images/library/everyday-mixed-wrap.jpg", tags: ["Everyday"] },
    { id: "mini-rose-jar", name: "Mini Rose Jar", style: "Cute", price: 25, desc: "Petite red mini roses with baby's breath in a small mason jar — adorable bedside or desk piece.", size: "7 stems", time: "~5 min", profit: 14, recipe: "5x Mini Roses, 2x Baby's Breath", image: "/images/library/mini-rose-jar.jpg", tags: ["Everyday", "Custom"], badge: "NEW" },
    { id: "spring-spray-bucket", name: "Spring Spray Bucket", style: "Seasonal", price: 40, desc: "Bright seasonal spray roses and wax flower in a galvanized tin bucket — a cheerful counter piece that sells itself.", size: "12 stems", time: "~9 min", profit: 21, recipe: "6x Spray Roses, 4x Wax Flower, 2x Pittosporum", image: "/images/library/spring-spray-bucket.jpg", tags: ["Everyday", "Events"] }
  ];

  const state = { filter: "All Arrangements", sort: "popular", query: "", wired: false };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
  }

  function money(n) {
    return `$${Number(n || 0).toFixed(2)}`;
  }

  function parseRecipe(recipe) {
    return String(recipe || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const m = part.match(/^(\d+)\s*x\s*(.+)$/i) || part.match(/^(\d+)\s+(.+)$/);
        if (m) return { ingredient_name: m[2].trim(), quantity: Number(m[1]), unit: "stem", unit_cost: 0 };
        return { ingredient_name: part, quantity: 1, unit: "stem", unit_cost: 0 };
      });
  }

  function filtered() {
    const q = state.query.trim().toLowerCase();
    let rows = CATALOG.filter((item) => {
      const hay = `${item.name} ${item.style} ${item.desc} ${item.recipe} ${(item.tags || []).join(" ")}`.toLowerCase();
      const matchQ = !q || hay.includes(q);
      const matchF =
        state.filter === "All Arrangements" ||
        (item.tags || []).includes(state.filter) ||
        (state.filter === "Everyday" && /everyday/i.test(item.name));
      return matchQ && matchF;
    });
    if (state.sort === "price-asc") rows = [...rows].sort((a, b) => a.price - b.price);
    else if (state.sort === "price-desc") rows = [...rows].sort((a, b) => b.price - a.price);
    else if (state.sort === "profit") rows = [...rows].sort((a, b) => b.profit - a.profit);
    else if (state.sort === "name") rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    else rows = [...rows].sort((a, b) => Number(Boolean(b.badge)) - Number(Boolean(a.badge)) || b.profit - a.profit);
    return rows;
  }

  function cardHtml(item) {
    return `<article class="lux-lib-card" data-lux-lib-id="${esc(item.id)}">
      <div class="lux-lib-media">
        ${item.badge ? `<span class="lux-lib-ribbon">${esc(item.badge)}</span>` : ""}
        <img src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy" width="480" height="360" onerror="this.onerror=null;this.src='/assets/pink-bouquet.jpg'">
      </div>
      <div class="lux-lib-body">
        <div class="lux-lib-title-row">
          <h3>${esc(item.name)}</h3>
          <strong class="lux-lib-price">${money(item.price)}</strong>
        </div>
        <span class="lux-lib-style">${esc(item.style)}</span>
        <p class="lux-lib-desc">${esc(item.desc)}</p>
        <div class="lux-lib-stats" aria-label="Arrangement stats">
          <span>${esc(item.size)}</span>
          <span>${esc(item.time)}</span>
          <span>${money(item.profit).replace(".00", "")} profit</span>
        </div>
        <p class="lux-lib-recipe"><strong>Recipe:</strong> ${esc(item.recipe)}</p>
        <div class="lux-lib-actions">
          <button type="button" class="lux-lib-add" data-lux-lib-add="${esc(item.id)}">Add to My Shop</button>
          <button type="button" class="lux-lib-draft" data-lux-lib-draft="${esc(item.id)}">Add as Draft</button>
        </div>
        <p class="lux-lib-foot">Estimated assembly time: ${esc(item.time.replace("~", ""))}</p>
      </div>
    </article>`;
  }

  function render() {
    const list = $("#libraryList");
    if (!list) return;
    const rows = filtered();
    const count = $("#luxLibCount");
    if (count) count.textContent = `${rows.length} arrangement${rows.length === 1 ? "" : "s"}`;
    list.className = "lux-lib-grid";
    list.removeAttribute("hidden");
    list.style.display = "grid";
    list.innerHTML = rows.length
      ? rows.map(cardHtml).join("")
      : `<div class="lux-lib-empty" role="status"><strong>No arrangements match.</strong><p>Try another filter or search term.</p></div>`;
  }

  async function addToShop(id, status) {
    const item = CATALOG.find((x) => x.id === id);
    if (!item) return;
    const toast = window.toast || (() => {});
    toast(status === "draft" ? `Saving ${item.name} as draft…` : `Adding ${item.name} to your shop…`);
    const payload = {
      name: item.name,
      category: (item.tags && item.tags[0]) || "Everyday",
      price: item.price,
      description: item.desc,
      image_url: item.image,
      available_online: status !== "draft",
      active: status !== "draft",
      featured: Boolean(item.badge),
      publish_status: status === "draft" ? "draft" : "published",
      library_master_id: item.id
    };
    try {
      if (typeof window.api === "function") {
        const { item: product } = await window.api("products", { method: "POST", body: JSON.stringify(payload) });
        const recipeItems = parseRecipe(item.recipe);
        if (product?.id && recipeItems.length) {
          try {
            await window.api("recipes", { method: "POST", body: JSON.stringify({ product_id: product.id, items: recipeItems }) });
          } catch {
            /* recipe optional if endpoint unavailable */
          }
        }
        if (typeof window.loadProducts === "function") await window.loadProducts();
      }
      toast(
        status === "draft"
          ? `${item.name} saved as an editable draft.`
          : `${item.name} copied to your shop — master library unchanged.`
      );
    } catch (e) {
      toast(e?.message || "Could not add arrangement.");
    }
  }

  function wire() {
    if (state.wired) return;
    state.wired = true;
    const page = $("#libraryPage");
    if (!page) return;

    page.addEventListener("click", (e) => {
      const pill = e.target.closest?.("[data-lux-lib-filter]");
      if (pill) {
        state.filter = pill.dataset.luxLibFilter;
        page.querySelectorAll("[data-lux-lib-filter]").forEach((b) => {
          const on = b === pill;
          b.classList.toggle("active", on);
          if (on) b.setAttribute("aria-current", "true");
          else b.removeAttribute("aria-current");
        });
        const select = $("#libraryCategory");
        if (select) {
          select.value = state.filter === "All Arrangements" ? "" : state.filter;
        }
        render();
        return;
      }
      const add = e.target.closest?.("[data-lux-lib-add]");
      if (add) {
        addToShop(add.dataset.luxLibAdd, "published");
        return;
      }
      const draft = e.target.closest?.("[data-lux-lib-draft]");
      if (draft) addToShop(draft.dataset.luxLibDraft, "draft");
    });

    $("#librarySearch")?.addEventListener("input", (e) => {
      state.query = e.currentTarget.value || "";
      render();
    });
    $("#luxLibSort")?.addEventListener("change", (e) => {
      state.sort = e.currentTarget.value || "popular";
      render();
    });
  }

  function boot() {
    const page = $("#libraryPage");
    if (!page) return;
    page.classList.add("florisyn-lux-library");
    wire();
    render();
  }

  window.FlorisynLuxuryLibrary = { boot, render, CATALOG, FILTERS };
  window.BloomFloralLibraryUI = {
    init: boot,
    renderLibrary: render,
    getMaster: () => CATALOG
  };
})();
