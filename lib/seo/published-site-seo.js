/**
 * SEO for published florist websites (Website Studio → Publish).
 * Meta tags, Open Graph, Twitter Cards, JSON-LD, sitemap XML, robots.txt.
 */

export function resolvePublishedSiteBaseUrl(shop = {}, env = process.env) {
  const custom = String(shop.custom_domain || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");
  if (custom && (shop.domain_status?.connected || shop.domain_status === "connected")) {
    return `https://${custom}`;
  }
  const platform = String(env.SITE_URL || env.URL || "https://www.florisyn.com").replace(/\/$/, "");
  if (shop.slug) return `${platform}/store/${shop.slug}`;
  return platform;
}

function parseCity(address = "") {
  const parts = String(address)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return "";
}

function absoluteImage(url, baseUrl) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  const root = String(baseUrl || "").replace(/\/$/, "");
  return `${root}${u.startsWith("/") ? u : `/${u}`}`;
}

/**
 * Build the full seo_settings blob stored on bloom_website_projects at publish time.
 */
export function buildPublishedSeoBundle(shop = {}, pages = [], options = {}) {
  const baseUrl = resolvePublishedSiteBaseUrl(shop, options.env);
  const name = shop.name || "Local Florist";
  const city = parseCity(shop.address || shop.address_line_1);
  const tagline = shop.tagline || shop.hero_title || "";
  const defaultTitle =
    shop.seo_title || `${name}${city ? ` — Florist in ${city}` : ""} | Flower Delivery`;
  const defaultDescription =
    shop.seo_description ||
    `Order fresh flowers from ${name}${city ? ` in ${city}` : ""}. Same-day and local delivery, sympathy, wedding, birthday, and everyday arrangements.${tagline ? ` ${tagline}` : ""}`.trim();

  const ogImage = shop.hero_image_url || shop.logo_url || "/assets/florisyn/florisyn-official-icon.png";
  const visiblePages = (pages || []).filter((p) => p.visible !== false && p.slug);

  return {
    title: defaultTitle,
    meta_description: defaultDescription.slice(0, 160),
    canonical_url: `${baseUrl.replace(/\/$/, "")}/`,
    og_image: ogImage,
    robots: options.preview ? "noindex,nofollow" : "index,follow,max-image-preview:large",
    twitter_card: "summary_large_image",
    locale: "en_US",
    base_url: baseUrl,
    sitemap: visiblePages.map((p) => p.slug),
    local_business_json_ld: localBusinessJsonLd(shop, baseUrl, ogImage),
    website_json_ld: webSiteJsonLd(shop, baseUrl),
    published_at: new Date().toISOString(),
  };
}

export function renderPublishedPageMeta(page, siteSeo = {}, baseUrl, product = null) {
  const shopTitle = siteSeo.title?.split("|")[0]?.trim() || "Florist";
  let title;
  let description;
  let canonical;
  let ogType = "website";

  if (product) {
    title = product.seo_title || `${product.name} — ${shopTitle}`;
    description =
      product.seo_description ||
      product.short_description ||
      product.description ||
      siteSeo.meta_description ||
      "";
    canonical = `${baseUrl.replace(/\/$/, "")}/product/${product.id}`;
    ogType = "product";
  } else {
    title = page?.content?.seo_title || (page?.title ? `${page.title} — ${shopTitle}` : siteSeo.title);
    description = page?.content?.meta_description || siteSeo.meta_description || "";
    const slug = page?.slug === "home" ? "" : page?.slug || "";
    canonical = slug ? `${baseUrl.replace(/\/$/, "")}/${slug}` : `${baseUrl.replace(/\/$/, "")}/`;
  }

  const ogImage = absoluteImage(
    product?.primary_image?.url || page?.content?.hero_image || siteSeo.og_image,
    baseUrl.includes("florisyn.com") ? "https://www.florisyn.com" : baseUrl
  );

  return {
    title,
    description: String(description).slice(0, 160),
    canonical,
    robots: siteSeo.robots || "index,follow",
    og: {
      type: ogType,
      title,
      description: String(description).slice(0, 200),
      url: canonical,
      image: ogImage,
      site_name: shopTitle,
    },
    twitter: {
      card: siteSeo.twitter_card || "summary_large_image",
      title,
      description: String(description).slice(0, 200),
      image: ogImage,
    },
  };
}

export function localBusinessJsonLd(shop = {}, baseUrl, imageUrl) {
  const city = parseCity(shop.address || shop.address_line_1);
  return {
    "@context": "https://schema.org",
    "@type": "Florist",
    name: shop.name || "Florist",
    description: shop.about_text || shop.tagline || undefined,
    url: baseUrl.replace(/\/$/, "") + "/",
    telephone: shop.phone || undefined,
    email: shop.email || undefined,
    image: imageUrl ? absoluteImage(imageUrl, baseUrl) : undefined,
    address: shop.address
      ? {
          "@type": "PostalAddress",
          streetAddress: shop.address,
          addressLocality: city || undefined,
        }
      : undefined,
    priceRange: "$$",
    areaServed: city || shop.delivery_radius ? `${city || "Local area"}` : undefined,
  };
}

export function webSiteJsonLd(shop = {}, baseUrl) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: shop.name || "Florist",
    url: baseUrl.replace(/\/$/, "") + "/",
    potentialAction: {
      "@type": "SearchAction",
      target: `${baseUrl.replace(/\/$/, "")}/shop?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function productJsonLd(product, shop, baseUrl) {
  if (!product?.sync?.show_price_online && product?.retail_price == null) return null;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.short_description || product.description,
    image: product.primary_image?.url ? absoluteImage(product.primary_image.url, baseUrl) : undefined,
    sku: product.sku || undefined,
    brand: { "@type": "Brand", name: shop?.name || "Florist" },
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: Number(product.retail_price || product.price || 0),
      availability: "https://schema.org/InStock",
      url: `${baseUrl.replace(/\/$/, "")}/product/${product.id}`,
    },
  };
}

export function breadcrumbJsonLd(crumbs, baseUrl) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.path.startsWith("http") ? c.path : `${baseUrl.replace(/\/$/, "")}${c.path.startsWith("/") ? c.path : `/${c.path}`}`,
    })),
  };
}

export function buildPublishedSitemapXml(baseUrl, pages = [], products = []) {
  const root = baseUrl.replace(/\/$/, "");
  const urls = [];

  for (const p of pages.filter((x) => x.visible !== false && x.slug)) {
    const loc = p.slug === "home" ? `${root}/` : `${root}/${p.slug}`;
    urls.push({ loc, priority: p.slug === "home" ? "1.0" : "0.8" });
  }

  for (const p of products.filter((x) => x?.id)) {
    urls.push({ loc: `${root}/product/${p.id}`, priority: "0.6" });
  }

  const body = urls
    .map(
      (u) =>
        `  <url><loc>${escapeXml(u.loc)}</loc><changefreq>weekly</changefreq><priority>${u.priority}</priority></url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function publishedRobotsTxt({ allowIndex = true, sitemapUrl = null } = {}) {
  if (!allowIndex) return "User-agent: *\nDisallow: /\n";
  const lines = ["User-agent: *", "Allow: /"];
  if (sitemapUrl) lines.push("", `Sitemap: ${sitemapUrl}`);
  return `${lines.join("\n")}\n`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
