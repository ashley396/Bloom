/** Browser bundle — mirrors lib/storefront/section-renderer.js */
(function (global) {
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function imgBlock(media, fallbackAlt) {
    const url = typeof media === "string" ? media : media?.url;
    if (!url) return "";
    const alt = typeof media === "object" ? media?.alt || fallbackAlt : fallbackAlt;
    return `<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
  }

  function productCardHtml(p, shop) {
    const price = p.sync?.show_price_online !== false && p.retail_price != null
      ? `$${Number(p.retail_price || 0).toFixed(2)}`
      : "Call for price";
    const img = p.primary_image?.url
      ? `<img src="${esc(p.primary_image.url)}" alt="${esc(p.primary_image.alt || p.name)}" loading="lazy" decoding="async" width="400" height="300">`
      : `<div class="img-placeholder" role="img" aria-label="No photo">${esc(p.name)}</div>`;
    return `<article class="product-card"><a href="/store/${esc(shop)}/product/${esc(p.id)}">${img}<h3>${esc(p.name)}</h3><p class="price">${price}</p></a><button type="button" class="primary add-cart" data-id="${esc(p.id)}">Add to cart</button></article>`;
  }

  function renderSection(section, ctx) {
    if (!section || section.hidden) return "";
    ctx = ctx || {};
    const shop = ctx.shop || "shop";
    const props = section.props || {};
    const products = ctx.products || [];
    const featured = products.filter((p) => p.sync?.featured);
    const list = (featured.length ? featured : products).slice(0, 6);

    switch (section.type) {
      case "hero":
        return `<section class="sf-section hero">${props.image ? imgBlock(props.image, props.title) : ""}<h1>${esc(props.title || ctx.shopName || "Florist")}</h1><p>${esc(props.subtitle || props.text || "")}</p></section>`;
      case "featured_arrangements":
      case "product_collection":
        return `<section class="sf-section"><h2>${esc(props.title || "Featured arrangements")}</h2><div class="product-grid">${list.map((p) => productCardHtml(p, shop)).join("") || `<p class="subtle">Add products to showcase arrangements.</p>`}</div></section>`;
      case "occasion_tiles": {
        const occasions = props.occasions || ["Birthday", "Sympathy", "Wedding", "Plants"];
        return `<section class="sf-section occasion-grid"><h2>${esc(props.title || "Shop by occasion")}</h2><div class="occasion-tiles">${occasions.map((o) => `<a class="occasion-tile" href="/store/${esc(shop)}/${esc(String(o).toLowerCase().replace(/\s+/g, "-"))}">${esc(o)}</a>`).join("")}</div></section>`;
      }
      case "sympathy_feature":
        return `<section class="sf-section sympathy"><h2>${esc(props.title || "Sympathy & memorial")}</h2><p>${esc(props.text || "Compassionate designs delivered with care.")}</p><a class="secondary" href="/store/${esc(shop)}/sympathy">View sympathy flowers</a></section>`;
      case "wedding_feature":
        return `<section class="sf-section wedding"><h2>${esc(props.title || "Weddings & events")}</h2><p>${esc(props.text || "Elegant event florals.")}</p><a class="secondary" href="/store/${esc(shop)}/weddings">Explore wedding florals</a></section>`;
      case "seasonal_banner":
      case "seasonal_feature":
        return `<section class="sf-section seasonal"><h2>${esc(props.title || "Seasonal favorites")}</h2><p>${esc(props.text || "")}</p></section>`;
      case "about_florist":
        return `<section class="sf-section"><h2>${esc(props.title || "About us")}</h2><p>${esc(props.text || ctx.aboutText || "")}</p></section>`;
      case "shop_hours":
        return `<section class="sf-section"><h2>${esc(props.title || "Shop hours")}</h2><p>${esc(props.hours || ctx.hours || "Mon–Sat 9–6")}</p></section>`;
      case "delivery_area":
        return `<section class="sf-section"><h2>${esc(props.title || "Delivery area")}</h2><p>${esc(props.text || "Local delivery available.")}</p></section>`;
      case "testimonials": {
        const items = props.items || [{ quote: "Beautiful flowers.", author: "Customer" }];
        return `<section class="sf-section testimonials"><h2>${esc(props.title || "Kind words")}</h2>${items.map((t) => `<blockquote><p>${esc(t.quote)}</p><cite>${esc(t.author || "")}</cite></blockquote>`).join("")}</section>`;
      }
      case "contact_form":
        return `<section class="sf-section contact"><h2>${esc(props.title || "Contact")}</h2><p>Phone: ${esc(ctx.phone || "")}</p><p>Email: ${esc(ctx.email || "")}</p></section>`;
      case "faq": {
        const faqs = props.faqs || [{ q: "Same-day delivery?", a: "Call before noon for availability." }];
        return `<section class="sf-section faq"><h2>${esc(props.title || "FAQ")}</h2>${faqs.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</section>`;
      }
      case "cta_banner":
        // Not named "cta" — storefront/index.html's <body> carries the
        // shared florisyn-atelier-shell class (the whole app's chrome
        // styling), and body.florisyn-atelier-shell .cta is a pill-shaped
        // *button* gradient meant for actual buttons elsewhere in the
        // app. A <section class="cta"> picked it up too, painting the
        // whole banner section as a dark pill with its own text and the
        // real "Shop now" button both fighting for the same space.
        return `<section class="sf-section sf-cta-banner"><p>${esc(props.text || "Order flowers for delivery or pickup")}</p><a class="primary" href="/store/${esc(shop)}/shop">Shop now</a></section>`;
      default:
        return `<section class="sf-section"><h2>${esc(String(section.type || "section").replace(/_/g, " "))}</h2><p>${esc(props.text || props.title || "")}</p></section>`;
    }
  }

  function renderSections(sections, ctx) {
    return (sections || [])
      .filter((s) => !s.hidden)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((s) => renderSection(s, ctx))
      .join("");
  }

  global.BloomSectionRenderer = { renderSection, renderSections, productCardHtml, esc };
})(window);
