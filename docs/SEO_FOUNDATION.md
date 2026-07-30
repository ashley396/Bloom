# Florisyn SEO Foundation

**Last updated:** 2026-07-30  
**Scope:** Florist public websites, marketing pages, storefront  
**Note:** Technical SEO foundations only — no ranking guarantees.  
**Website Studio (target):** `docs/FLORISYN_WEBSITE_STUDIO_BLUEPRINT.md` — SEO § and pre-publish checks.  
**Architecture bible:** `docs/FLORISYN_MASTER_ARCHITECTURE_BIBLE.md` §6.

---

## Current state

| Area | Status | Location |
|------|--------|----------|
| Marketing static pages | ✅ Basic HTML | `public/company/`, `public/help/`, `public/legal/` |
| Per-shop storefront | ✅ Dynamic | `storefront-public.js`, `public/storefront/` |
| Sitemap generation | 🟡 Partial | `storefront-public.js?action=sitemap`, `bloom-instant-website.js` |
| robots.txt | 🟡 Partial | Static/marketing; per-shop via storefront action |
| Open Graph | 🟡 Partial | Instant website templates |
| Structured data | ⚪ Planned | LocalBusiness, Product, Breadcrumb |
| React preview SEO | ⚪ N/A | Not deployed to production |

---

## Implemented foundations

### Semantic HTML

- Marketing pages use `<main>`, headings hierarchy, footer nav columns.
- Storefront SPA renders product cards with heading levels in templates (`bloom-instant-website.js`).

### Unique title and meta description

- Instant Website: shop name + tagline injected into `<title>` and meta description per published site.
- Marketing pages: static titles in each `index.html`.

**Verification:** View source on published storefront `/store/{slug}`.

### Canonical URLs

- **Architect:** Add `<link rel="canonical">` using shop primary domain from settings.
- **Implementation point:** `bloom-instant-website.js` `renderPageHead()`.

### XML sitemap

- **Endpoint:** `GET /.netlify/functions/storefront-public?action=sitemap&shop={slug}`
- **Source list:** `DEFAULT_SITE_PAGES` in `bloom-instant-website.js`

**Verification:**
```bash
curl -s "https://<site>/.netlify/functions/storefront-public?action=sitemap&shop=<slug>"
```

### robots.txt

- Marketing: add `/public/robots.txt` at publish root (⚪ planned file).
- Per-shop: expose via storefront function `action=robots` (⚪ planned — mirror sitemap pattern).

### Open Graph metadata

- **Partial:** OG title/description on instant website home template.
- **Planned:** `og:image` from shop hero or Floral Asset Library export.

### Structured data (JSON-LD)

| Schema | Use case | Status |
|--------|----------|--------|
| `LocalBusiness` / `Florist` | Shop homepage, contact | ⚪ Planned |
| `Product` | Storefront catalog items | ⚪ Planned |
| `BreadcrumbList` | Category → product | ⚪ Planned |
| `FAQPage` | Help/FAQ landing | ⚪ Planned |

**Implementation point:** Server-rendered JSON-LD in `storefront-public.js` HTML shell — avoids client-only injection for crawlers.

### Image alt-text workflow

- Floral Asset Library entries include descriptive `alt` in React (`PhotoAsset.tsx`).
- Production website builder: prompt florist for alt on hero/product upload (⚪ enforce in UI).

### Responsive images

- Storefront: use `srcset` for hero images when CDN URLs available (⚪ planned).
- React: Tailwind responsive layouts; assets in `frontend/public/assets/floristry/`.

### Clean URLs

- Storefront: `/store/{slug}/{page-slug}` via Netlify redirect to SPA.
- Marketing: folder-based clean paths (`/company/about/`).

### Mobile-first layout

- Storefront CSS responsive breakpoints in instant website themes.
- Production app sidebar collapses on mobile (`styles.css`).

### Internal linking

- Footer columns link legal, help, sitemap across marketing pages.
- Storefront nav from `DEFAULT_SITE_PAGES`.

---

## Landing page architecture (planned)

Location/service-area pages for florist SEO:

```
/store/{slug}/deliver-to/{city}
/store/{slug}/venues/{venue-slug}
/store/{slug}/funeral-homes/{name}
/store/{slug}/hospitals/{name}
/store/{slug}/weddings
```

**Data model:** Extend instant website pages with `page_type` + geo/entity metadata.  
**Duplicate content control:** Canonical to primary service page; thin pages noindex until unique copy exists.

---

## Duplicate content and redirects

| Case | Control |
|------|---------|
| www vs apex | Netlify domain redirect (owner DNS) |
| HTTP → HTTPS | Netlify default |
| Trailing slash | `netlify.toml` force redirects on auth pages |
| Old Bloom URLs | Redirect map in `netlify.toml` (⚪ audit needed) |

---

## Analytics integration point

- **Hook:** `window.florisynAnalytics?.track(event)` stub in storefront shell (⚪ add without vendor lock-in).
- Owner configures GA4 or Plausible via shop settings injection — single vendor only (see `COST_CONTROL_PLAN.md`).

---

## Search Console verification

- **Architect:** Shop settings field `search_console_verification` → meta tag in site `<head>`.
- **File upload alternative:** `{slug}-google*.html` in shop static assets bucket.

---

## Verification checklist

- [ ] Each published page has unique `<title>` and meta description
- [ ] Sitemap returns 200 with all public page URLs
- [ ] robots.txt disallows admin/app routes, allows storefront
- [ ] JSON-LD validates in Google Rich Results Test (when implemented)
- [ ] Lighthouse mobile performance ≥ 80 on storefront template (target)
- [ ] All product/hero images have non-empty `alt`

---

## Files reference

```
netlify/functions/storefront-public.js
netlify/functions/_shared/bloom-instant-website.js
netlify/functions/instant-website.js
public/storefront/index.html
public/sitemap/index.html
tests/bloom-rc1-1.test.js          — SEO sitemap/robots assertions
frontend/src/components/media/PhotoAsset.tsx
docs/SEO_FOUNDATION.md             — this document
```

---

*SEO is a ongoing product surface — ship schema and sitemap generation before content marketing scale.*
