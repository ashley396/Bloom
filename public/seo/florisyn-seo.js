/**
 * Client-side SEO injector for Florisyn public & auth pages.
 * Enhances title, meta, Open Graph, Twitter Cards, canonical, and JSON-LD.
 */
(function () {
  "use strict";

  var SITE = {
    name: "Florisyn",
    tagline: "The Operating System for Modern Florists",
    baseUrl: "https://www.florisyn.com",
    ogImage: "/assets/florisyn/florisyn-official-icon.png?v=official1",
    twitter: "@Florisyn",
  };

  var PAGES = {
    "/login": {
      title: "Sign In | Florisyn — Florist POS & Shop Management Software",
      description:
        "Sign in to Florisyn — the operating system for modern florists. Manage orders, POS, inventory, websites, deliveries, and payments in one platform.",
      robots: "index,follow",
    },
    "/login.html": {
      title: "Sign In | Florisyn — Florist POS & Shop Management Software",
      description:
        "Sign in to Florisyn — the operating system for modern florists. Manage orders, POS, inventory, websites, deliveries, and payments in one platform.",
      robots: "index,follow",
    },
    "/signup": {
      title: "Start Free Trial | Florisyn — Florist Software for Independent Shops",
      description:
        "Create your Florisyn account — 14-day free trial for independent florists. POS, orders, floral library, website builder, AI assistants Lily & Rose. No setup fee.",
      robots: "index,follow",
    },
    "/signup.html": {
      title: "Start Free Trial | Florisyn — Florist Software for Independent Shops",
      description:
        "Create your Florisyn account — 14-day free trial for independent florists. POS, orders, floral library, website builder, AI assistants Lily & Rose. No setup fee.",
      robots: "index,follow",
    },
    "/company/about/": {
      title: "About Florisyn | Built by a Florist, for Florists",
      description:
        "Florisyn helps independent flower shops protect profits, serve customers beautifully, and compete with confidence — without expensive wire-service fees.",
    },
    "/company/services/": {
      title: "Florisyn Services | POS, Websites, Inventory & AI for Florists",
      description:
        "Florisyn combines POS, order management, inventory, recipe builder, website studio, payment center, wholesale marketplace, and AI assistants in one platform.",
    },
    "/company/become-a-florist/": {
      title: "Become a Florisyn Florist | Join Independent Florist Software",
      description:
        "Join Florisyn — florist-first software with a 14-day free trial. Manage orders, customers, deliveries, and your shop website without hidden software fees.",
    },
    "/company/difference/": {
      title: "The Florisyn Difference | Florist-First vs Wire Services",
      description:
        "See why independent florists choose Florisyn over legacy wire services — transparent pricing, your brand, your customers, and tools built for real shop workflows.",
    },
    "/company/careers/": {
      title: "Careers at Florisyn | Join Our Team",
      description: "Explore careers at Florisyn Technologies — building florist-first software.",
    },
    "/company/feedback/": {
      title: "Feedback | Florisyn Florist Software",
      description: "Tell Florisyn what is working and what would make your flower shop's day easier.",
    },
    "/help/": {
      title: "Help Center | Florisyn Support for Florists",
      description: "Florisyn Help Center — FAQs, guides, expert chat, and customer service.",
    },
    "/help/faqs/": {
      title: "FAQs | Florisyn Florist Software Help",
      description: "Answers about Florisyn trials, plans, logins, payments, and florist accounts.",
    },
    "/help/order-delivery/": {
      title: "Orders & Delivery | Florisyn Help",
      description: "Learn how florist orders, production status, and delivery routes work in Florisyn.",
    },
    "/help/chat/": {
      title: "Chat with an Expert | Florisyn Support",
      description: "Send a question to the Florisyn support team.",
    },
    "/help/contact/": {
      title: "Contact Florisyn Customer Service",
      description: "Contact Florisyn for account, billing, or technical assistance.",
    },
    "/legal/privacy/": {
      title: "Privacy Policy | Florisyn Technologies",
      description: "Florisyn Privacy Policy — how we process your information.",
    },
    "/legal/terms/": {
      title: "Terms of Use | Florisyn Technologies",
      description: "Terms governing Florisyn public pages, trials, and subscriptions.",
    },
    "/legal/cookies/": {
      title: "Cookie Notice | Florisyn",
      description: "How Florisyn uses cookies for sign-in, security, and preferences.",
    },
    "/legal/accessibility/": {
      title: "Accessibility Statement | Florisyn",
      description: "Florisyn accessibility commitment for public pages and florist software.",
    },
    "/legal/unsubscribe/": {
      title: "Email Unsubscribe | Florisyn",
      description: "Unsubscribe from Florisyn promotional emails.",
      robots: "noindex,follow",
    },
    "/sitemap/": {
      title: "Sitemap | Florisyn",
      description: "Navigate Florisyn information, support, and legal resources.",
    },
  };

  var NOINDEX = {
    "/": 1,
    "/index.html": 1,
    "/admin": 1,
    "/admin.html": 1,
    "/forgot-password": 1,
    "/forgot-password.html": 1,
    "/reset-password": 1,
    "/reset-password.html": 1,
    "/verify-email": 1,
    "/verify-email.html": 1,
    "/pay": 1,
    "/pay.html": 1,
    "/onboarding": 1,
    "/onboarding.html": 1,
  };

  function $(sel) {
    return document.querySelector(sel);
  }

  function upsertMeta(attr, key, content) {
    if (!content) return;
    var sel = attr === "name" ? 'meta[name="' + key + '"]' : 'meta[property="' + key + '"]';
    var el = $(sel);
    if (!el) {
      el = document.createElement("meta");
      if (attr === "name") el.setAttribute("name", key);
      else el.setAttribute("property", key);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  }

  function upsertLink(rel, href) {
    if (!href) return;
    var el = document.querySelector('link[rel="' + rel + '"]');
    if (!el) {
      el = document.createElement("link");
      el.setAttribute("rel", rel);
      document.head.appendChild(el);
    }
    el.setAttribute("href", href);
  }

  function canonicalPath(path) {
    var p = path || "/";
    if (p.endsWith(".html")) {
      p = p.replace(/\.html$/, p === "/index.html" ? "/" : "");
    }
    if (p !== "/" && !p.endsWith("/") && p.indexOf(".") === -1) p += "/";
    return p;
  }

  function canonicalUrl(path) {
    return SITE.baseUrl.replace(/\/$/, "") + canonicalPath(path);
  }

  function absUrl(url) {
    if (/^https?:\/\//i.test(url)) return url;
    return SITE.baseUrl.replace(/\/$/, "") + (url.charAt(0) === "/" ? url : "/" + url);
  }

  function injectJsonLd(blocks) {
    document.querySelectorAll('script[data-florisyn-seo="1"]').forEach(function (n) {
      n.remove();
    });
    blocks.forEach(function (block) {
      var s = document.createElement("script");
      s.type = "application/ld+json";
      s.setAttribute("data-florisyn-seo", "1");
      s.textContent = JSON.stringify(block);
      document.head.appendChild(s);
    });
  }

  function resolve(path) {
    var cfg = PAGES[path] || PAGES[path.replace(/\/$/, "") + "/"];
    if (NOINDEX[path] || path.indexOf("/store/") === 0) {
      return {
        title: document.title || SITE.name,
        description: SITE.tagline,
        robots: "noindex,nofollow",
        path: path,
      };
    }
    if (cfg) {
      return {
        title: cfg.title,
        description: cfg.description,
        robots: cfg.robots || "index,follow",
        path: path,
      };
    }
    var existing = $("meta[name='description']");
    return {
      title: document.title,
      description: existing ? existing.getAttribute("content") : SITE.tagline,
      robots: "index,follow",
      path: path,
    };
  }

  function apply() {
    var path = location.pathname;
    var seo = resolve(path);
    if (seo.title) document.title = seo.title;

    upsertMeta("name", "description", seo.description);
    upsertMeta("name", "robots", seo.robots);
    upsertLink("canonical", canonicalUrl(seo.path));

    upsertMeta("property", "og:type", "website");
    upsertMeta("property", "og:title", seo.title);
    upsertMeta("property", "og:description", seo.description);
    upsertMeta("property", "og:url", canonicalUrl(seo.path));
    upsertMeta("property", "og:image", absUrl(SITE.ogImage));
    upsertMeta("property", "og:site_name", SITE.name);
    upsertMeta("property", "og:locale", "en_US");

    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", seo.title);
    upsertMeta("name", "twitter:description", seo.description);
    upsertMeta("name", "twitter:image", absUrl(SITE.ogImage));
    upsertMeta("name", "twitter:site", SITE.twitter);

    if (seo.robots.indexOf("noindex") === -1) {
      injectJsonLd([
        {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "Florisyn Technologies",
          alternateName: "Florisyn",
          url: SITE.baseUrl,
          logo: absUrl(SITE.ogImage),
          description: SITE.tagline,
        },
        {
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: SITE.name,
          url: SITE.baseUrl,
          description: SITE.tagline,
        },
        {
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Florisyn",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "14-day free trial" },
          url: canonicalUrl("/signup"),
        },
      ]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply);
  } else {
    apply();
  }

  window.FlorisynSeo = { apply: apply, SITE: SITE };
})();
