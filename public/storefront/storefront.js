/** Bloom public storefront renderer (RC1.2 commerce) */

(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  function parseRoute() {
    const path = location.pathname.replace(/^\/store\/?/, "").replace(/\/$/, "");
    const parts = path.split("/").filter(Boolean);
    const shop = parts[0] || new URLSearchParams(location.search).get("shop");
    const pageSlug = parts[1] || "home";
    const productId = parts[1] === "product" ? parts[2] : null;
    const slug = productId ? "product" : pageSlug === shop ? "home" : pageSlug;
    return { shop, slug, productId, previewToken: new URLSearchParams(location.search).get("preview_token") };
  }

  function announce(msg) {
    const el = document.getElementById("liveRegion");
    if (el) el.textContent = msg;
  }

  let state = { cart: [], site: null, products: [], shopSlug: "", commerce: null };

  async function fetchSite(shop, previewToken) {
    const q = new URLSearchParams({ shop });
    if (previewToken) q.set("preview_token", previewToken);
    const res = await fetch(`/.netlify/functions/storefront-public?${q}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unable to load storefront.");
    return data;
  }

  function applyTheme(site) {
    const palette = site?.site?.theme?.mode?.palette || ["#faf7f2", "#c9899e", "#3d5c4a"];
    document.documentElement.style.setProperty("--sf-bg", palette[0]);
    document.documentElement.style.setProperty("--sf-accent", palette[1]);
    document.documentElement.style.setProperty("--sf-botanical", palette[2]);
    const fonts = site?.site?.theme?.fonts;
    if (fonts) {
      document.documentElement.style.setProperty("--sf-display", fonts.heading);
      document.documentElement.style.setProperty("--sf-body", fonts.body);
    }
  }

  function siteBaseUrl(site) {
    const resolved = site?.site || {};
    return String(resolved.base_url || resolved.seo?.base_url || "").replace(/\/$/, "") ||
      `${location.origin}/store/${state.shopSlug}`;
  }

  function pageCanonical(base, page, product) {
    const root = base.replace(/\/$/, "");
    if (product) return `${root}/product/${product.id}`;
    if (!page || page.slug === "home") return `${root}/`;
    return `${root}/${page.slug}`;
  }

  function setMeta(site, page, product) {
    const seo = site?.site?.seo || {};
    const shopName = site.site.shop.name;
    const preview = site.preview;
    const base = siteBaseUrl(site);

    let title;
    let description;
    let ogType = "website";
    if (product) {
      title = product.seo_title || `${product.name} — ${shopName}`;
      description = product.short_description || product.description || seo.meta_description || "";
      ogType = "product";
    } else {
      title = page?.content?.seo_title || (page?.title ? `${page.title} — ${shopName}` : seo.title || shopName);
      description = page?.content?.meta_description || seo.meta_description || `Order flowers from ${shopName}. Delivery and pickup available.`;
    }
    const canonical = pageCanonical(base, page, product);
    const robots = preview ? "noindex,nofollow" : seo.robots || "index,follow,max-image-preview:large";
    const ogImage = product?.primary_image?.url || seo.og_image || site.site.shop.hero_image_url || "/assets/florisyn/florisyn-official-icon.png";

    document.title = title;

    const upsert = (attr, key, content) => {
      if (content == null) return;
      const sel = attr === "name" ? `meta[name="${key}"]` : `meta[property="${key}"]`;
      let el = document.querySelector(sel);
      if (!el) {
        el = document.createElement("meta");
        if (attr === "name") el.name = key;
        else el.setAttribute("property", key);
        document.head.appendChild(el);
      }
      el.content = content;
    };

    upsert("name", "description", String(description).slice(0, 160));
    upsert("name", "robots", robots);
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = canonical;

    upsert("property", "og:type", ogType);
    upsert("property", "og:title", title);
    upsert("property", "og:description", String(description).slice(0, 200));
    upsert("property", "og:url", canonical);
    upsert("property", "og:image", ogImage);
    upsert("property", "og:site_name", shopName);

    upsert("name", "twitter:card", "summary_large_image");
    upsert("name", "twitter:title", title);
    upsert("name", "twitter:description", String(description).slice(0, 200));
    upsert("name", "twitter:image", ogImage);

    injectJsonLd(site, page, product, canonical, base);
  }

  function injectJsonLd(site, page, product, canonical, base) {
    document.querySelectorAll('script[data-storefront-seo="1"]').forEach((n) => n.remove());
    const shop = site.site.shop;
    const seo = site.site.seo || {};
    const blocks = [];

    if (seo.local_business_json_ld) blocks.push(seo.local_business_json_ld);
    else {
      blocks.push({
        "@context": "https://schema.org",
        "@type": "Florist",
        name: shop.name,
        telephone: shop.phone,
        url: `${base.replace(/\/$/, "")}/`,
        address: shop.address,
        image: seoImage(site)
      });
    }
    if (seo.website_json_ld && !product) blocks.push(seo.website_json_ld);

    if (product) {
      blocks.push({
        "@context": "https://schema.org",
        "@type": "Product",
        name: product.name,
        description: product.short_description || product.description,
        image: product.primary_image?.url,
        brand: { "@type": "Brand", name: shop.name },
        offers: {
          "@type": "Offer",
          priceCurrency: "USD",
          price: Number(product.retail_price || 0),
          availability: "https://schema.org/InStock",
          url: canonical
        }
      });
    }

    if (page?.slug && page.slug !== "home" && !product) {
      blocks.push({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${base.replace(/\/$/, "")}/` },
          { "@type": "ListItem", position: 2, name: page.title, item: canonical }
        ]
      });
    }

    blocks.forEach((block) => {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.setAttribute("data-storefront-seo", "1");
      script.textContent = JSON.stringify(block);
      document.head.appendChild(script);
    });
  }

  function seoImage(site) {
    return site?.site?.seo?.og_image || site.site.shop.hero_image_url || "";
  }

  function renderNav(pages, shop) {
    const nav = document.getElementById("storefrontNav");
    nav.innerHTML = pages
      .filter((p) => p.visible !== false && p.slug !== "home")
      .map((p) => `<a href="/store/${esc(shop)}/${esc(p.slug)}">${esc(p.title)}</a>`)
      .join("");
    document.getElementById("storefrontBrand").innerHTML = `<a href="/store/${esc(shop)}/"><strong>${esc(state.site.site.shop.name)}</strong></a>`;
  }

  function renderBreadcrumbs(slug, pages, shop) {
    const bc = document.getElementById("breadcrumbs");
    const crumbs = [{ label: "Home", slug: "home" }];
    const page = pages.find((p) => p.slug === slug);
    if (page && slug !== "home") crumbs.push({ label: page.title, slug });
    bc.innerHTML = crumbs.map((c, i) => (i ? ` / <span>${esc(c.label)}</span>` : `<a href="/store/${esc(shop)}/">${esc(c.label)}</a>`)).join("");
  }

  function productCard(p, shop) {
    const price = p.sync?.show_price_online ? `$${Number(p.retail_price || 0).toFixed(2)}` : "Call for price";
    const img = p.primary_image?.url
      ? `<img src="${esc(p.primary_image.url)}" alt="${esc(p.primary_image.alt || p.name)}" loading="lazy" decoding="async" width="400" height="300">`
      : `<div class="img-placeholder" role="img" aria-label="No photo">${esc(p.name)}</div>`;
    return `<article class="product-card"><a href="/store/${esc(shop)}/product/${esc(p.id)}">${img}<h3>${esc(p.name)}</h3><p class="price">${price}</p></a><button type="button" class="primary add-cart" data-id="${esc(p.id)}">Add to cart</button></article>`;
  }

  function renderSections(sections, shop) {
    const shopData = state.site?.site?.shop || {};
    const ctx = {
      shop,
      shopName: shopData.name,
      products: state.products,
      aboutText: shopData.about_text,
      hours: shopData.hours,
      phone: shopData.phone,
      email: shopData.email,
      address: shopData.address
    };
    if (window.BloomSectionRenderer?.renderSections) {
      return window.BloomSectionRenderer.renderSections(sections, ctx);
    }
    return (sections || [])
      .filter((s) => !s.hidden)
      .sort((a, b) => a.order - b.order)
      .map((s) => `<section class="sf-section"><h2>${esc(s.type.replace(/_/g, " "))}</h2></section>`)
      .join("");
  }

  function renderPage(route) {
    const main = document.getElementById("main");
    const shop = state.shopSlug;
    const pages = state.site.site.pages || [];
    const page = pages.find((p) => p.slug === route.slug) || pages.find((p) => p.slug === "home");
    renderNav(pages, shop);
    renderBreadcrumbs(route.slug, pages, shop);

    if (route.slug === "product" && route.productId) {
      const p = state.products.find((x) => String(x.id) === String(route.productId));
      if (!p) {
        setMeta(state.site, page, null);
        main.innerHTML = `<div class="empty-state"><h1>Not found</h1><p>This arrangement is unavailable.</p><a href="/store/${esc(shop)}/shop">Back to shop</a></div>`;
        return;
      }
      setMeta(state.site, page, p);
      const price = p.sync?.show_price_online ? `$${Number(p.retail_price || 0).toFixed(2)}` : "Call for price";
      main.innerHTML = `<article class="product-detail"><div class="product-detail-grid">${p.primary_image?.url ? `<img src="${esc(p.primary_image.url)}" alt="${esc(p.primary_image.alt || p.name)}" loading="lazy">` : `<div class="img-placeholder">No image</div>`}<div><h1>${esc(p.name)}</h1><p>${esc(p.description || "")}</p><p class="price">${price}</p><button type="button" class="primary add-cart" data-id="${esc(p.id)}">Add to cart</button></div></div></article>`;
      return;
    }

    setMeta(state.site, page, null);

    if (route.slug === "shop" || page?.template === "collection") {
      const q = document.getElementById("storefrontSearch")?.value || "";
      const filtered = filterProducts(route.slug, q);
      main.innerHTML = `<section><h1>${esc(page?.title || "Shop")}</h1><div class="product-grid">${filtered.length ? filtered.map((p) => productCard(p, shop)).join("") : `<div class="empty-state"><p>No products match this collection yet.</p></div>`}</div></section>`;
      return;
    }

    if (page?.slug === "home") {
      const home = pages.find((p) => p.slug === "home");
      main.innerHTML = renderSections(home?.sections || [], shop) || `<div class="empty-state"><h1>${esc(state.site.site.shop.name)}</h1><p>Welcome — browse our shop to order.</p></div>`;
      return;
    }

    if (page?.template === "contact") {
      main.innerHTML = `<section><h1>Contact</h1><p>Phone: ${esc(state.site.site.shop.phone || "")}</p><p>Email: ${esc(state.site.site.shop.email || "")}</p><p>${esc(state.site.site.shop.address || "")}</p></section>`;
      return;
    }

    main.innerHTML = `<section><h1>${esc(page?.title || "Page")}</h1><p>${esc(page?.content?.body || page?.content?.intro || "")}</p></section>`;
  }

  function defaultDeliveryDate(leadDays) {
    const d = new Date();
    d.setDate(d.getDate() + Math.max(0, Number(leadDays || 0)));
    return d.toISOString().slice(0, 10);
  }

  function syncDeliveryFields() {
    const fulfillment = document.querySelector('#checkoutForm select[name="fulfillment"]')?.value;
    document.querySelectorAll(".delivery-only").forEach((el) => {
      el.style.display = fulfillment === "DELIVERY" ? "" : "none";
    });
  }

  function applyCommerceSettings() {
    const commerce = state.commerce || {};
    const modes = commerce.payment_modes || ["pay_later"];
    const fieldset = document.getElementById("paymentModeFieldset");
    if (fieldset) {
      fieldset.querySelectorAll('input[name="payment_mode"]').forEach((input) => {
        const wrap = input.closest("label");
        const allowed = modes.includes(input.value);
        if (wrap) wrap.hidden = !allowed;
        if (!allowed && input.checked) {
          const fallback = fieldset.querySelector(`input[value="${modes[0] || "pay_later"}"]`);
          if (fallback) fallback.checked = true;
        }
      });
      fieldset.hidden = modes.length <= 1;
    }
    const dateInput = document.querySelector('#checkoutForm input[name="delivery_date"]');
    if (dateInput && !dateInput.value) dateInput.value = defaultDeliveryDate(commerce.delivery_lead_days);
    if (dateInput) dateInput.min = defaultDeliveryDate(commerce.delivery_lead_days);
    const note = document.getElementById("checkoutPaymentNote");
    if (note) {
      note.textContent =
        modes.includes("pay_now") && commerce.stripe_available
          ? "Pay now uses Stripe — Florisyn never stores card numbers on this page."
          : "Your florist will confirm the order and send a secure payment link if due.";
    }
  }

  function filterProducts(collectionSlug, query) {
    let list = [...state.products];
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((p) => [p.name, p.description].join(" ").toLowerCase().includes(q));
    if (collectionSlug && collectionSlug !== "home" && collectionSlug !== "shop") {
      const needle = collectionSlug.replace(/-/g, " ").toLowerCase();
      list = list.filter((p) => (p.categories || []).join(" ").toLowerCase().includes(needle));
    }
    return list;
  }

  function loadCart() {
    try {
      state.cart = JSON.parse(localStorage.getItem(`bloom_cart_${state.shopSlug}`) || "[]");
    } catch {
      state.cart = [];
    }
    document.getElementById("cartCount").textContent = String(state.cart.reduce((s, l) => s + l.qty, 0));
  }

  function saveCart() {
    localStorage.setItem(`bloom_cart_${state.shopSlug}`, JSON.stringify(state.cart));
    loadCart();
  }

  function renderCart() {
    const lines = document.getElementById("cartLines");
    if (!state.cart.length) {
      lines.innerHTML = "<p class=\"empty-state\">Your cart is empty.</p>";
      document.getElementById("cartTotals").textContent = "";
      return;
    }
    lines.innerHTML = state.cart
      .map((l) => `<div class="cart-line"><span>${esc(l.qty)} × ${esc(l.name)}</span><strong>$${(l.price * l.qty).toFixed(2)}</strong></div>`)
      .join("");
    const sub = state.cart.reduce((s, l) => s + l.price * l.qty, 0);
    const taxRate = Number(state.site?.site?.shop?.tax_rate || 0);
    const tax = Math.round(sub * (taxRate / 100) * 100) / 100;
    const deliveryDefault = Number(state.commerce?.default_delivery_fee ?? state.site?.site?.shop?.default_delivery_fee ?? 0);
    document.getElementById("cartTotals").textContent = `Subtotal $${sub.toFixed(2)} + est. tax $${tax.toFixed(2)}${deliveryDefault ? ` · delivery from $${deliveryDefault.toFixed(2)}` : ""}`;
    const detail = document.getElementById("checkoutTotalsDetail");
    if (detail) detail.textContent = document.getElementById("cartTotals").textContent;
  }

  function bindEvents(route) {
    document.getElementById("navToggle")?.addEventListener("click", () => {
      const nav = document.getElementById("storefrontNav");
      const open = nav.classList.toggle("open");
      document.getElementById("navToggle").setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.getElementById("storefrontSearch")?.addEventListener("input", () => renderPage(route));
    document.getElementById("cartBtn")?.addEventListener("click", () => {
      document.getElementById("cartDrawer").hidden = false;
      applyCommerceSettings();
      syncDeliveryFields();
      renderCart();
    });
    document.querySelector('#checkoutForm select[name="fulfillment"]')?.addEventListener("change", syncDeliveryFields);
    document.getElementById("closeCart")?.addEventListener("click", () => {
      document.getElementById("cartDrawer").hidden = true;
    });
    document.body.addEventListener("click", (e) => {
      const btn = e.target.closest(".add-cart");
      if (!btn) return;
      const p = state.products.find((x) => String(x.id) === btn.dataset.id);
      if (!p) return;
      const line = state.cart.find((l) => l.id === p.id);
      if (line) line.qty += 1;
      else state.cart.push({ id: p.id, name: p.name, price: Number(p.retail_price || 0), qty: 1 });
      saveCart();
      announce(`${p.name} added to cart`);
      renderCart();
    });
    document.getElementById("checkoutForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const fd = new FormData(f);
      const submitBtn = document.getElementById("checkoutSubmit");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Submitting…";
      }
      const paymentMode = fd.get("payment_mode") || "pay_later";
      const payload = {
        action: paymentMode === "pay_now" ? "create_web_checkout" : "create_web_order",
        shop_slug: state.shopSlug,
        payment_mode: paymentMode,
        cart: { lines: state.cart },
        customer: {
          name: fd.get("name"),
          phone: fd.get("phone"),
          email: fd.get("email"),
          recipient_name: fd.get("recipient_name") || fd.get("name")
        },
        options: {
          fulfillment: fd.get("fulfillment"),
          delivery_address: fd.get("delivery_address"),
          delivery_date: fd.get("delivery_date"),
          card_message: fd.get("card_message"),
          delivery_instructions: fd.get("delivery_instructions"),
          tax_rate: Number(state.site.site.shop.tax_rate || 0)
        }
      };
      try {
        const res = await fetch("/.netlify/functions/storefront-public", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
          announce(data.error || "Checkout failed");
          return;
        }
        state.cart = [];
        saveCart();
        renderCart();
        document.getElementById("cartDrawer").hidden = true;
        if (data.handoff?.checkout_url) {
          announce("Redirecting to secure payment…");
          location.assign(data.handoff.checkout_url);
          return;
        }
        let msg = data.handoff?.message || `Order ${data.order?.order_number || ""} submitted.`;
        if (data.handoff?.payment_link_url) msg += ` Pay securely: ${data.handoff.payment_link_url}`;
        announce(msg);
        f.reset();
        applyCommerceSettings();
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Place order";
        }
      }
    });
  }

  async function init() {
    const route = parseRoute();
    if (!route.shop) {
      document.getElementById("main").innerHTML = "<p class=\"empty-state\">Shop not specified.</p>";
      return;
    }
    state.shopSlug = route.shop;
    try {
      state.site = await fetchSite(route.shop, route.previewToken);
      state.products = state.site.products || [];
      state.commerce = state.site.commerce || null;
      if (state.site.preview) {
        const ann = document.getElementById("storefrontAnnounce");
        ann.hidden = false;
        ann.textContent = "Preview mode — this site is not public until published.";
      }
      applyTheme(state.site);
      applyCommerceSettings();
      syncDeliveryFields();
      const params = new URLSearchParams(location.search);
      if (params.get("order_success")) {
        announce(`Thank you — order ${params.get("order_success")} is confirmed.`);
      }
      if (params.get("checkout_cancelled")) {
        announce("Payment was cancelled — your order may still be on file; contact your florist.");
      }
      loadCart();
      renderPage(route);
      bindEvents(route);
      document.getElementById("storefrontFooter").innerHTML = `<p>${esc(state.site.site.shop.name)}</p><p class="subtle">© ${new Date().getFullYear()} ${esc(state.site.site.shop.name)}. Powered by Florisyn.</p>`;
    } catch (err) {
      console.error("Storefront failed to load:", err);
      document.getElementById("main").innerHTML = `<div class="empty-state"><h1>We're having trouble loading this shop</h1><p>Please try again in a moment, or contact the florist directly if this continues.</p></div>`;
    }
  }

  init();
})();
