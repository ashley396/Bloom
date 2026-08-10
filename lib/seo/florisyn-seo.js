/**
 * Florisyn global SEO — titles, meta, Open Graph, Twitter Cards, JSON-LD, sitemap.
 * Used by static public pages, auth pages, and build scripts.
 */

export const FLORISYN_SITE = Object.freeze({
  name: "Florisyn",
  tagline: "The Operating System for Modern Florists",
  baseUrl: "https://www.florisyn.com",
  defaultOgImage: "/assets/florisyn/florisyn-official-icon.png?v=official1",
  twitterHandle: "@Florisyn",
  locale: "en_US",
});

/** Indexable marketing & support pages. Path → SEO config. */
export const PUBLIC_PAGE_SEO = Object.freeze({
  "/login": {
    title: "Sign In | Florisyn — Florist POS & Shop Management Software",
    description:
      "Sign in to Florisyn — the operating system for modern florists. Manage orders, POS, inventory, websites, deliveries, and payments in one platform.",
    robots: "index,follow",
    type: "website",
  },
  "/login.html": {
    title: "Sign In | Florisyn — Florist POS & Shop Management Software",
    description:
      "Sign in to Florisyn — the operating system for modern florists. Manage orders, POS, inventory, websites, deliveries, and payments in one platform.",
    robots: "index,follow",
    type: "website",
  },
  "/signup": {
    title: "Start Free Trial | Florisyn — Florist Software for Independent Shops",
    description:
      "Create your Florisyn account — 14-day free trial for independent florists. POS, orders, floral library, website builder, AI assistants Lily & Rose. No setup fee.",
    robots: "index,follow",
    type: "website",
  },
  "/signup.html": {
    title: "Start Free Trial | Florisyn — Florist Software for Independent Shops",
    description:
      "Create your Florisyn account — 14-day free trial for independent florists. POS, orders, floral library, website builder, AI assistants Lily & Rose. No setup fee.",
    robots: "index,follow",
    type: "website",
  },
  "/company/about/": {
    title: "About Florisyn | Built by a Florist, for Florists",
    description:
      "Florisyn helps independent flower shops protect profits, serve customers beautifully, and compete with confidence — without expensive wire-service fees.",
    robots: "index,follow",
    type: "article",
  },
  "/company/services/": {
    title: "Florisyn Services | POS, Websites, Inventory & AI for Florists",
    description:
      "Florisyn combines POS, order management, inventory, recipe builder, website studio, payment center, wholesale marketplace, and AI assistants in one platform.",
    robots: "index,follow",
    type: "website",
  },
  "/company/become-a-florist/": {
    title: "Become a Florisyn Florist | Join Independent Florist Software",
    description:
      "Join Florisyn — florist-first software with a 14-day free trial. Manage orders, customers, deliveries, and your shop website without hidden software fees.",
    robots: "index,follow",
    type: "website",
  },
  "/company/difference/": {
    title: "The Florisyn Difference | Florist-First vs Wire Services",
    description:
      "See why independent florists choose Florisyn over legacy wire services — transparent pricing, your brand, your customers, and tools built for real shop workflows.",
    robots: "index,follow",
    type: "article",
  },
  "/company/careers/": {
    title: "Careers at Florisyn | Join Our Team",
    description:
      "Explore careers at Florisyn Technologies — building florist-first software that helps independent flower shops thrive.",
    robots: "index,follow",
    type: "website",
  },
  "/company/feedback/": {
    title: "Feedback | Florisyn Florist Software",
    description:
      "Tell Florisyn what is working, what is confusing, and what would make your flower shop's day easier. We read every message.",
    robots: "index,follow",
    type: "website",
  },
  "/help/": {
    title: "Help Center | Florisyn Support for Florists",
    description:
      "Florisyn Help Center — FAQs, order & delivery guides, expert chat, and customer service for florist accounts, billing, and technical support.",
    robots: "index,follow",
    type: "website",
  },
  "/help/faqs/": {
    title: "FAQs | Florisyn Florist Software Help",
    description:
      "Answers about Florisyn trials, plans, logins, payments, subscriptions, and florist accounts.",
    robots: "index,follow",
    type: "faq",
  },
  "/help/order-delivery/": {
    title: "Orders & Delivery | Florisyn Help",
    description:
      "Learn how florist orders, production status, delivery routes, and proof-of-delivery work inside Florisyn.",
    robots: "index,follow",
    type: "article",
  },
  "/help/chat/": {
    title: "Chat with an Expert | Florisyn Support",
    description:
      "Send a question to the Florisyn support team — account help, billing, website studio, and daily shop workflows.",
    robots: "index,follow",
    type: "website",
  },
  "/help/contact/": {
    title: "Contact Florisyn Customer Service",
    description:
      "Contact Florisyn customer service for account, billing, or technical assistance for your flower shop.",
    robots: "index,follow",
    type: "website",
  },
  "/legal/privacy/": {
    title: "Privacy Policy | Florisyn Technologies",
    description:
      "Florisyn Privacy Policy — how we process information when you visit our site, create an account, use our software, or contact support.",
    robots: "index,follow",
    type: "article",
  },
  "/legal/terms/": {
    title: "Terms of Use | Florisyn Technologies",
    description:
      "Terms governing access to Florisyn public pages, trial accounts, paid subscriptions, and related florist software services.",
    robots: "index,follow",
    type: "article",
  },
  "/legal/cookies/": {
    title: "Cookie Notice | Florisyn",
    description:
      "How Florisyn uses browser storage and cookies for sign-in, security, preferences, and payment processing.",
    robots: "index,follow",
    type: "article",
  },
  "/legal/accessibility/": {
    title: "Accessibility Statement | Florisyn",
    description:
      "Florisyn accessibility commitment — usable public pages and florist software for people with diverse abilities and assistive technologies.",
    robots: "index,follow",
    type: "article",
  },
  "/legal/unsubscribe/": {
    title: "Email Unsubscribe | Florisyn",
    description:
      "Unsubscribe from Florisyn promotional emails. Account and transactional notices may still be sent when required to provide the service.",
    robots: "noindex,follow",
    type: "website",
  },
  "/sitemap/": {
    title: "Sitemap | Florisyn",
    description: "Navigate Florisyn information, support, company, and legal resources.",
    robots: "index,follow",
    type: "website",
  },
});

/** Paths that must never appear in search results. */
export const NOINDEX_PATHS = new Set([
  "/",
  "/index.html",
  "/admin",
  "/admin.html",
  "/forgot-password",
  "/forgot-password.html",
  "/reset-password",
  "/reset-password.html",
  "/verify-email",
  "/verify-email.html",
  "/pay",
  "/pay.html",
  "/onboarding",
  "/onboarding.html",
]);

export function resolvePublicSeo(pathname, baseUrl = FLORISYN_SITE.baseUrl) {
  const path = normalizePath(pathname);
  const page = PUBLIC_PAGE_SEO[path];
  const noindex = NOINDEX_PATHS.has(path) || path.startsWith("/store/");

  if (noindex && !page) {
    return buildSeoBundle({
      title: "Florisyn",
      description: FLORISYN_SITE.tagline,
      path,
      baseUrl,
      robots: "noindex,nofollow",
      type: "website",
    });
  }

  if (page) {
    return buildSeoBundle({ ...page, path, baseUrl });
  }

  return buildSeoBundle({
    title: `${FLORISYN_SITE.name} | ${FLORISYN_SITE.tagline}`,
    description: FLORISYN_SITE.tagline,
    path,
    baseUrl,
    robots: "index,follow",
    type: "website",
  });
}

function normalizePath(pathname) {
  let p = String(pathname || "/").split("?")[0].split("#")[0];
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1 && p.endsWith("/") && !p.endsWith(".html/")) {
    /* keep trailing slash for directory URLs */
  } else if (p.endsWith("/") && p !== "/") {
    /* ok */
  }
  return p;
}

export function buildSeoBundle({
  title,
  description,
  path = "/",
  baseUrl = FLORISYN_SITE.baseUrl,
  robots = "index,follow",
  type = "website",
  ogImage = FLORISYN_SITE.defaultOgImage,
  jsonLdExtra = null,
}) {
  const canonical = canonicalUrl(path, baseUrl);
  const absImage = absoluteUrl(ogImage, baseUrl);
  return {
    title,
    description,
    robots,
    canonical,
    og: {
      type,
      title,
      description,
      url: canonical,
      image: absImage,
      site_name: FLORISYN_SITE.name,
      locale: FLORISYN_SITE.locale,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      image: absImage,
      site: FLORISYN_SITE.twitterHandle,
    },
    jsonLd: [
      organizationJsonLd(baseUrl),
      webSiteJsonLd(baseUrl),
      ...(jsonLdExtra ? [jsonLdExtra] : []),
    ],
  };
}

export function canonicalUrl(path, baseUrl = FLORISYN_SITE.baseUrl) {
  const root = baseUrl.replace(/\/$/, "");
  let p = normalizePath(path);
  if (p.endsWith(".html")) p = p.replace(/\.html$/, p === "/index.html" ? "/" : "");
  if (p === "/") return `${root}/`;
  if (!p.endsWith("/") && !p.includes(".")) p = `${p}/`;
  return `${root}${p}`;
}

export function absoluteUrl(url, baseUrl = FLORISYN_SITE.baseUrl) {
  const u = String(url || "").trim();
  if (!u) return absoluteUrl(FLORISYN_SITE.defaultOgImage, baseUrl);
  if (/^https?:\/\//i.test(u)) return u;
  return `${baseUrl.replace(/\/$/, "")}${u.startsWith("/") ? u : `/${u}`}`;
}

export function organizationJsonLd(baseUrl = FLORISYN_SITE.baseUrl) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Florisyn Technologies",
    alternateName: "Florisyn",
    url: baseUrl,
    logo: absoluteUrl(FLORISYN_SITE.defaultOgImage, baseUrl),
    description: FLORISYN_SITE.tagline,
    sameAs: ["https://www.florisyn.com"],
  };
}

export function softwareApplicationJsonLd(baseUrl = FLORISYN_SITE.baseUrl) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Florisyn",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, iOS, Android",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "14-day free trial",
    },
    description:
      "Florisyn is the operating system for modern florists — POS, orders, inventory, websites, deliveries, payments, and AI assistants.",
    url: `${baseUrl.replace(/\/$/, "")}/signup`,
    publisher: { "@type": "Organization", name: "Florisyn Technologies" },
  };
}

export function webSiteJsonLd(baseUrl = FLORISYN_SITE.baseUrl) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: FLORISYN_SITE.name,
    url: baseUrl,
    description: FLORISYN_SITE.tagline,
    potentialAction: {
      "@type": "SearchAction",
      target: `${baseUrl.replace(/\/$/, "")}/help/?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function breadcrumbJsonLd(crumbs, baseUrl = FLORISYN_SITE.baseUrl) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.path, baseUrl),
    })),
  };
}

/** Render HTML meta/link/script tags for static injection or tests. */
export function renderSeoHeadHtml(seo) {
  const lines = [
    `<meta name="description" content="${escapeAttr(seo.description)}">`,
    `<meta name="robots" content="${escapeAttr(seo.robots)}">`,
    `<link rel="canonical" href="${escapeAttr(seo.canonical)}">`,
    `<meta property="og:type" content="${escapeAttr(seo.og.type)}">`,
    `<meta property="og:title" content="${escapeAttr(seo.og.title)}">`,
    `<meta property="og:description" content="${escapeAttr(seo.og.description)}">`,
    `<meta property="og:url" content="${escapeAttr(seo.og.url)}">`,
    `<meta property="og:image" content="${escapeAttr(seo.og.image)}">`,
    `<meta property="og:site_name" content="${escapeAttr(seo.og.site_name)}">`,
    `<meta property="og:locale" content="${escapeAttr(seo.og.locale)}">`,
    `<meta name="twitter:card" content="${escapeAttr(seo.twitter.card)}">`,
    `<meta name="twitter:title" content="${escapeAttr(seo.twitter.title)}">`,
    `<meta name="twitter:description" content="${escapeAttr(seo.twitter.description)}">`,
    `<meta name="twitter:image" content="${escapeAttr(seo.twitter.image)}">`,
  ];
  if (seo.twitter.site) {
    lines.push(`<meta name="twitter:site" content="${escapeAttr(seo.twitter.site)}">`);
  }
  for (const block of seo.jsonLd || []) {
    lines.push(
      `<script type="application/ld+json">${JSON.stringify(block).replace(/</g, "\\u003c")}</script>`
    );
  }
  return lines.join("\n");
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function sitemapPaths() {
  return Object.keys(PUBLIC_PAGE_SEO)
    .filter((p) => !p.endsWith(".html"))
    .filter((p) => PUBLIC_PAGE_SEO[p].robots?.startsWith("index"))
    .sort();
}

export function buildSitemapXml(baseUrl = FLORISYN_SITE.baseUrl, paths = sitemapPaths()) {
  const root = baseUrl.replace(/\/$/, "");
  const urls = paths
    .map((p) => {
      const loc = canonicalUrl(p, baseUrl);
      return `  <url><loc>${escapeXml(loc)}</loc><changefreq>weekly</changefreq><priority>${p === "/login" || p === "/signup" ? "0.9" : "0.7"}</priority></url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function robotsTxtContent(baseUrl = FLORISYN_SITE.baseUrl) {
  const root = baseUrl.replace(/\/$/, "");
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /admin.html",
    "Disallow: /forgot-password",
    "Disallow: /reset-password",
    "Disallow: /verify-email",
    "Disallow: /pay",
    "Disallow: /onboarding",
    "Disallow: /.netlify/",
    "",
    `Sitemap: ${root}/sitemap.xml`,
    "",
  ].join("\n");
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
