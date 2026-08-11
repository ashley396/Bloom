/**
 * Shared storefront section renderer — single source for public site + editor previews.
 * Florist-focused blocks: occasions, sympathy, weddings, delivery, commerce CTAs.
 */

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function imgBlock(media, fallbackAlt = "") {
  const url = typeof media === "string" ? media : media?.url;
  if (!url) return "";
  const alt = typeof media === "object" ? media?.alt || fallbackAlt : fallbackAlt;
  return `<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
}

function productCardHtml(p, shop, escFn = esc) {
  const price = p.sync?.show_price_online !== false && p.retail_price != null
    ? `$${Number(p.retail_price || 0).toFixed(2)}`
    : "Call for price";
  const img = p.primary_image?.url
    ? `<img src="${escFn(p.primary_image.url)}" alt="${escFn(p.primary_image.alt || p.name)}" loading="lazy" decoding="async" width="400" height="300">`
    : `<div class="img-placeholder" role="img" aria-label="No photo">${escFn(p.name)}</div>`;
  return `<article class="product-card"><a href="/store/${escFn(shop)}/product/${escFn(p.id)}">${img}<h3>${escFn(p.name)}</h3><p class="price">${price}</p></a><button type="button" class="primary add-cart" data-id="${escFn(p.id)}">Add to cart</button></article>`;
}

/**
 * @param {object} ctx - { shop, shopName, products, aboutText, hours, basePath }
 */
export function renderSection(section, ctx = {}) {
  if (!section || section.hidden) return "";
  const shop = ctx.shop || "shop";
  const props = section.props || {};
  const products = ctx.products || [];
  const featured = products.filter((p) => p.sync?.featured);
  const list = (featured.length ? featured : products).slice(0, 6);

  switch (section.type) {
    case "hero":
      return `<section class="sf-section hero">${props.image ? imgBlock(props.image, props.title) : ""}<h1>${esc(props.title || ctx.shopName || "Florist")}</h1><p>${esc(props.subtitle || props.text || "")}</p>${props.cta ? `<a class="primary" href="/store/${esc(shop)}/shop">${esc(props.cta)}</a>` : ""}</section>`;
    case "featured_arrangements":
    case "product_collection":
      return `<section class="sf-section"><h2>${esc(props.title || "Featured arrangements")}</h2><div class="product-grid">${list.map((p) => productCardHtml(p, shop)).join("") || `<p class="subtle">Add products to your catalog to showcase arrangements here.</p>`}</div></section>`;
    case "occasion_tiles": {
      const occasions = props.occasions || ["Birthday", "Sympathy", "Wedding", "Plants"];
      const tiles = occasions
        .map((o) => {
          const slug = String(o).toLowerCase().replace(/\s+/g, "-");
          return `<a class="occasion-tile" href="/store/${esc(shop)}/${esc(slug)}">${esc(o)}</a>`;
        })
        .join("");
      return `<section class="sf-section occasion-grid"><h2>${esc(props.title || "Shop by occasion")}</h2><div class="occasion-tiles">${tiles}</div></section>`;
    }
    case "sympathy_feature":
      return `<section class="sf-section sympathy"><h2>${esc(props.title || "Sympathy & memorial")}</h2><p>${esc(props.text || "Compassionate designs delivered with care.")}</p><a class="secondary" href="/store/${esc(shop)}/sympathy">View sympathy flowers</a></section>`;
    case "wedding_feature":
      return `<section class="sf-section wedding"><h2>${esc(props.title || "Weddings & events")}</h2><p>${esc(props.text || "Consultations for ceremonies, receptions, and bridal parties.")}</p><a class="secondary" href="/store/${esc(shop)}/weddings">Explore wedding florals</a></section>`;
    case "seasonal_banner":
    case "seasonal_feature":
      return `<section class="sf-section seasonal"><h2>${esc(props.title || "Seasonal favorites")}</h2><p>${esc(props.text || "")}</p></section>`;
    case "about_florist":
      return `<section class="sf-section"><h2>${esc(props.title || "About us")}</h2><p>${esc(props.text || ctx.aboutText || "")}</p></section>`;
    case "shop_hours":
      return `<section class="sf-section"><h2>${esc(props.title || "Shop hours")}</h2><p>${esc(props.hours || ctx.hours || "Mon–Sat 9–6")}</p></section>`;
    case "delivery_area":
      return `<section class="sf-section"><h2>${esc(props.title || "Delivery area")}</h2><p>${esc(props.text || props.radius || "Local delivery available — contact us for details.")}</p></section>`;
    case "testimonials": {
      const items = props.items || [{ quote: "Beautiful flowers and reliable delivery.", author: "Local customer" }];
      return `<section class="sf-section testimonials"><h2>${esc(props.title || "Kind words")}</h2>${items.map((t) => `<blockquote><p>${esc(t.quote)}</p><cite>${esc(t.author || "")}</cite></blockquote>`).join("")}</section>`;
    }
    case "map":
      return `<section class="sf-section"><h2>${esc(props.title || "Visit us")}</h2><p>${esc(props.address || ctx.address || "")}</p></section>`;
    case "contact_form":
      return `<section class="sf-section contact"><h2>${esc(props.title || "Contact")}</h2><p>Phone: ${esc(ctx.phone || "")}</p><p>Email: ${esc(ctx.email || "")}</p><a class="primary" href="/store/${esc(shop)}/contact">Contact page</a></section>`;
    case "newsletter":
      return `<section class="sf-section newsletter"><h2>${esc(props.title || "Stay in bloom")}</h2><p>${esc(props.text || "Seasonal updates and special offers from your local florist.")}</p></section>`;
    case "instagram":
      return `<section class="sf-section"><h2>${esc(props.title || "From the shop")}</h2><p class="subtle">${esc(props.handle ? `@${props.handle}` : "Follow us for fresh designs.")}</p></section>`;
    case "announcement_bar":
      return `<div class="sf-announcement" role="status">${esc(props.text || props.title || "")}</div>`;
    case "faq": {
      const faqs = props.faqs || [{ q: "Do you offer same-day delivery?", a: "Call us before noon for same-day availability in our delivery area." }];
      return `<section class="sf-section faq"><h2>${esc(props.title || "FAQ")}</h2>${faqs.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</section>`;
    }
    case "custom_text_image":
    case "custom_content":
      return `<section class="sf-section custom"><h2>${esc(props.title || "")}</h2>${props.image ? imgBlock(props.image, props.title) : ""}<p>${esc(props.text || "")}</p></section>`;
    case "cta_banner":
      return `<section class="sf-section cta"><p>${esc(props.text || "Order flowers for delivery or pickup")}</p><a class="primary" href="/store/${esc(shop)}/${esc(props.action === "contact" ? "contact" : "shop")}">${esc(props.button || "Shop now")}</a></section>`;
    default:
      return `<section class="sf-section"><h2>${esc(String(section.type || "section").replace(/_/g, " "))}</h2><p>${esc(props.text || props.title || "")}</p></section>`;
  }
}

export function renderSections(sections = [], ctx = {}) {
  return [...sections]
    .filter((s) => !s.hidden)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s) => renderSection(s, ctx))
    .join("");
}

export { esc, productCardHtml };
