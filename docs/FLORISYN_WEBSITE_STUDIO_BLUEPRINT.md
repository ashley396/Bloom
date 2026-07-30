# Florisyn Website Studio — Permanent Product Specification

**Status:** Product specification (not legal advice)  
**Last updated:** 2026-07-30  
**Authority:** Florisyn Master Architecture & Development Bible  
**Do not deploy from this document alone.** Implementation follows phased checklist in `docs/FLORISYN_MASTER_BUILD_CHECKLIST.md`.

---

## Product goal

Build the **easiest, most beautiful florist website builder** available.

A florist with no website experience must be able to create a complete, polished, sales-ready florist website in **under 30 minutes** without watching a tutorial.

The experience must be simpler, more connected, and more intelligent than traditional florist website theme systems.

---

## Core product principle

**Do not begin with an empty canvas.**

The primary experience is:

1. Florist answers a few simple questions.
2. Lily creates the complete website.
3. Florist visually edits and approves it.
4. Florist publishes.

**Default path:** Shop story → Lily builds everything → florist visually approves → launch

Do not force users to understand themes, sections, widgets, hosting, metadata, code, or SEO terminology upfront.

---

## Quick start options

Show four clear choices:

| Option | Description |
|--------|-------------|
| **Let Lily Build It** | Recommended — interview → full draft |
| **Start from a Florisyn Design** | Style preset + editable draft |
| **Import My Current Website** | Text, images, products, URLs (editable, not auto-publish) |
| **Start Blank** | Advanced; still guided, not a raw canvas |

---

## Lily website setup interview

Lily asks only the minimum information needed:

- Shop name
- Shop address
- Cities, towns, ZIP codes, and service areas
- Shop style and personality
- Services offered
- Logo upload
- Favorite photos
- Contact details
- Business hours
- Delivery and pickup preferences
- Social links
- Optional story / about information

Lily then creates a **complete first draft** automatically. All Lily outputs require florist **approval before publish**.

---

## Automatically generated pages (default draft)

| Page | Notes |
|------|-------|
| Home | Hero + featured collections |
| Shop Flowers | Primary catalog entry |
| Birthday | Occasion collection |
| Anniversary | Occasion collection |
| Sympathy | Occasion collection |
| Funeral | Occasion collection |
| Weddings & Events | Occasion collection |
| Plants | Category |
| Gifts | Category |
| Designer's Choice | Inventory-aware option |
| About | Shop story |
| Delivery Information | Zones, fees, cutoff |
| Contact | Form + details |
| Reviews | Testimonials section |
| Frequently Asked Questions | FAQ schema-ready |
| Care Instructions | Product care |
| Substitution Policy | Florist policy |
| Delivery Policy | Florist policy |
| Cancellation & Refund Policy | Florist policy |
| Privacy Policy | Legal starter — attorney review |
| Accessibility Statement | WCAG commitment |

Florists can **hide, rename, reorder, or add** pages.

---

## Florist style choices (emotional names)

Use florist-friendly style names — not technical template IDs:

| Style | Coordinates |
|-------|-------------|
| Romantic Garden | typography, spacing, palette, buttons, photo treatment, cards, section rhythm, motion, mobile |
| Modern Luxury | same token set |
| Bright & Cheerful | same |
| Southern Classic | same |
| Soft & Feminine | same |
| Botanical | same |
| Sympathy & Heritage | same |
| Editorial Floral | same |
| Rustic Country | same |
| Contemporary Minimal | same |
| Seasonal Boutique | same |
| Custom Brand Style | derived from logo |

Each style defines coordinated: typography, spacing, color palette, button style, photography treatment, card style, section rhythm, motion, mobile behavior.

**Existing RC1 launch modes** (`bloom-instant-website.js` `LAUNCH_MODES`) are a partial precursor — Website Studio expands naming, tokens, and editor integration.

---

## Website editor layout

### Desktop editor

**Left panel — Pages and sections**

- Page list
- Section list for selected page
- Add page / add section
- Reorder by drag and drop
- Hide / show
- Duplicate
- Delete with confirmation
- Page status: Draft / Published / Hidden

**Center — Live website canvas**

- True visual editing
- Click any text to edit
- Click any image to replace
- Drag sections to reorder
- Live desktop / tablet / mobile preview
- Undo / redo
- Autosave + draft indicator
- No separate confusing settings-only experience

**Right panel — Simple controls (contextual only)**

- Change photo
- Edit wording
- Ask Lily to rewrite
- Change colors / font / layout
- Hide section
- Add products / button
- Link destination
- Section spacing
- Mobile settings
- SEO preview

Only show controls relevant to the selected item.

---

## Brand setup

When a logo is uploaded:

- Detect suggested brand colors
- Generate coordinated palette options
- Recommend accessible contrast
- Recommend paired fonts
- Allow one-click palette changes
- Preserve original logo
- Support light and dark logo variants
- Support favicon generation
- Support logo placement controls

---

## Product creation and publishing

Florists can create products from:

- Florisyn Floral Library
- Uploaded arrangements
- Existing inventory
- Existing recipes
- Imported product files
- Website imports
- Lily-assisted product creation

**Per-product fields:** name, category, occasion, description, price, compare-at price, photos, alternate angles, recipe, labor, container, add-ons, delivery/pickup/seasonal availability, holiday pricing, inventory status, substitution rules, Designer's Choice option, SEO title, meta description, image alt text, structured data, publication status.

**One click from Floral Library:** Add to Website (+ optional inventory link).

**Source of truth:** `products`, `recipes`, `inventory` — Website Studio publishes views; does not duplicate catalog tables.

---

## Inventory-aware website

Connect to Florisyn inventory (`inventory.js`, freshness fields):

- Low-stock warnings
- Optional product hiding / pause
- Ingredient substitution **suggestions** (florist approves)
- Designer's Choice conversion
- Holiday availability
- Use-first inventory recommendations
- Estimated sellable quantity
- Container / add-on availability

**Rule:** AI must **never** silently change a product or substitute ingredients.

Cross-reference: `docs/DAILY_LOOP_V3_CHANGELOG.md` (freshness fields), `inventory-freshness.js`.

---

## Delivery and pickup configuration

Support (shared with Orders / Deliveries):

- Shop address
- Delivery ZIPs, cities, towns
- Radius / distance / ZIP / zone pricing
- Order minimums, same-day cutoff, future-date limits
- Pickup and delivery hours
- Holiday exceptions, closed dates, capacity limits
- Funeral-home, hospital, school, venue rules
- Apartment / gated access notes
- Rural surcharges, free-delivery thresholds
- **Live map** of configured delivery area

Cross-reference: `route-distance.js`, `deliveries.js`, order fulfillment fields.

---

## Holiday Command Center connection

Website Studio connects to **Holiday Command Center** (planned module). From one control center update:

- Homepage holiday banner
- Featured products, holiday pricing
- Order / delivery / pickup capacity and limits
- Delivery zones, same-day cutoff, available dates
- Designer's Choice mode, substitution rules, product visibility
- Staffing / inventory warnings
- Emergency website pause

**Status:** Architecture slot reserved — not built in Daily Loop branches.

---

## Ecommerce checkout

Florist-specific, simple checkout:

- Buyer + recipient information
- Delivery address + instructions
- Occasion, card message, anonymous sender
- Delivery / pickup, date, window
- Upgrades, add-ons, tips, tax, delivery fee, discounts
- Gift cards, store credit, house accounts (where approved), deposits
- Secure **Stripe** payment (server-side only)
- Order confirmation, receipt, customer notifications

**Order flow into Florisyn OS:** Orders → Payment Center → Production board → Inventory planning → Delivery → CRM → Reports.

Cross-reference: `orders.js`, `payment-hub.js`, `create-checkout.js`, `customers.js` (contact preferences).

---

## Intelligent upselling

Context-relevant optional add-ons: chocolates, balloons, plush, candles, plants, premium vase, flower upgrade, larger size, subscription, sympathy keepsake, greeting card.

Recommendations must be **editable and optional**.

---

## Lily website assistant

Lily can:

- Build initial website
- Write page copy and product descriptions
- Create SEO titles/descriptions and alt text
- Rewrite in florist voice
- Create local / funeral / hospital / venue / wedding landing pages
- Suggest categories, identify missing info
- Detect weak photography or unprofitable prices
- Suggest internal links, FAQs, care instructions
- Create social posts from website products

**All changes shown for approval before publishing.**

Cross-reference: `lily-ai.js`, `content-helper.js`, `ai-status.js`.

---

## SEO foundation

Every Florisyn website must support:

- Clean URLs, custom domains, SSL
- Fast mobile performance, semantic HTML
- Unique titles and meta descriptions, canonical URLs
- XML sitemap, robots.txt
- Open Graph + social sharing images
- LocalBusiness / Florist, Product, Breadcrumb, FAQ structured data (where valid)
- Image alt text, responsive images, internal linking
- Redirect manager, 404 page
- Location, service-area, funeral-home, hospital, wedding venue pages
- Google Search Console verification, analytics integration
- Accessibility checks, duplicate-content prevention

**Never promise guaranteed rankings.**

Cross-reference: `docs/SEO_FOUNDATION.md`, `storefront-public.js`, `bloom-instant-website.js`.

---

## Pre-publish website check

Automatic checklist before publish:

- Missing product photos, prices, descriptions
- Broken links, poor mobile layout
- Missing delivery settings, policies, contact info
- Missing SEO fields, accessibility issues
- Unprofitable or inventory-unavailable products
- Invalid checkout / payment / domain / SSL configuration

**Primary action:** Publish My Website (only when blockers resolved or explicitly acknowledged).

---

## Publishing and versioning

- Draft mode, preview link, publish, scheduled publish, unpublish
- Version history, restore previous version
- Page-level drafts, staging preview
- Domain connection, purchase architecture, DNS guidance, SSL status
- Deployment status, rollback

**Never overwrite a published website without preserving a prior version.**

**Existing schema precursor:** `bloom_website_page_versions` (RC1 migration).

---

## Import existing website

Architect import for: page text, images, products, categories, URLs, SEO metadata, redirect mappings.

Imported content **remains editable** and **must not automatically publish**.

---

## Analytics and product intelligence

Florist-friendly metrics: visitors, product views, add-to-cart, checkout conversion, top/weak products, abandoned carts, revenue, profit estimate, delivery zone performance, search terms, repeat customers, device mix, traffic sources, holiday trends.

Lily explains metrics in plain language.

---

## Accessibility

Website Studio and published sites:

- Keyboard navigation, screen readers, visible focus
- Accessible labels, color contrast, alt text
- Reduced motion, resizable text, semantic headings
- Accessible forms and validation messages

Cross-reference: `docs/LEGAL_COMPLIANCE_ARCHITECTURE.md`, WCAG targets in SEO doc.

---

## Mobile experience (florist operator)

Mobile-capable operations:

- Edit text, replace photos, hide products
- Change availability, update holiday banners
- Pause ordering, publish urgent changes, preview mobile

**Do not require desktop for urgent operational updates.**

---

## Security and privacy

- Tenant isolation, role-based website permissions, audit history
- Secure media uploads, private drafts, signed preview links
- Secure checkout, server-side payment handling
- No secrets in client code
- Input validation, abuse protection
- Versioned legal acceptance, privacy controls
- Customer data export and deletion workflows (where legally appropriate)

Cross-reference: `docs/SECURITY_REVIEW.md`, RLS on `bloom_website_*` tables.

---

## Cost control

- Reuse current stack (Netlify + Supabase + Stripe)
- Optimize images, caching, shared infrastructure with tenant isolation
- Storage/bandwidth alerts, plan-based limits, premium integrations behind adapters

Cross-reference: `docs/COST_CONTROL_PLAN.md`.

---

## Competitive standard

Florisyn must exceed traditional florist website products through:

- Faster setup, visual editing, Lily-assisted creation
- Inventory, recipe, delivery capacity, and holiday connections
- Order/POS integration, profitability intelligence, florist data ownership
- Easier mobile editing, refined design, transparent settings
- Stronger SEO foundations, recovery, and versioning

**Do not copy** competitor code, proprietary text, layouts, or protected assets. Research informs an **original, superior** Florisyn experience.

---

## Implementation rules

1. Add specification to Master Architecture Bible (this doc + bible cross-refs).
2. Track phases in Master Build Checklist.
3. **Do not build complete Website Studio during Daily Loop branches** unless explicitly assigned.
4. Architect daily-loop work to **integrate later** (shared services, no duplicate CRM/orders/inventory/payments).
5. Keep unfinished Website Studio behind **`WEBSITE_STUDIO_V2`** feature flag (default `false`).
6. Preserve approved UI foundations — **do not redesign Today page**.
7. Document every implementation phase before large code changes.

---

## Build phases

| Phase | ID | Scope |
|-------|-----|--------|
| Architecture | **WS-0** | Data model: pages, sections, theme tokens, domains, publishing, permissions, storage, versioning, integration contracts |
| Lily Quick Start | **WS-1** | Onboarding interview, generated site draft, pages, branding, preview |
| Visual Editor | **WS-2** | Pages, sections, live canvas, contextual controls, responsive preview, autosave, undo/redo |
| Products & Checkout | **WS-3** | Product publishing, categories, upgrades, add-ons, delivery config, Stripe, order flow into OS |
| Inventory & Holiday | **WS-4** | Availability, substitutions, capacity, holiday controls, emergency pause |
| SEO, Analytics, Publishing | **WS-5** | SEO, domains, analytics, pre-publish checks, versioning, rollback |
| Import, Mobile, Advanced AI | **WS-6** | Website import, mobile editor, advanced Lily, product intelligence, localized content |

---

## Cross-reference index

| Domain | Primary docs / code |
|--------|---------------------|
| Orders | `orders.js`, `_shared/order-status.js`, Daily Loop v2/v3 |
| Customers | `customers.js`, `customer-preferences.js`, CRM UI |
| Inventory | `inventory.js`, `inventory-freshness.js`, Floral Library |
| Delivery | `deliveries.js`, `route-distance.js`, delivery proof v3 |
| Payments | `payment-hub.js`, `create-checkout.js`, Stripe webhook |
| Floral Library | `floral-library.js`, `frontend/src/lib/floral-asset-library/` |
| AI / Lily | `lily-ai.js`, `ai-status.js`, `content-helper.js` |
| SEO | `docs/SEO_FOUNDATION.md`, `storefront-public.js` |
| Security | `docs/SECURITY_REVIEW.md`, RLS migrations |
| Holiday Command Center | ⚪ Planned — WS-4 |
| Current website RC1 | `bloom-instant-website.js`, `instant-website.js`, `website-editor-ui.js` |

---

## Architectural considerations (blockers to resolve in WS-0)

| Topic | Current state | WS-0 action |
|-------|---------------|-------------|
| Dual page models | `website_pages` (legacy) + `bloom_website_pages` (RC1) | Unify canonical page/section model |
| Published vs draft | `shops.website_published` + project `status` | Single publishing state machine |
| Product catalog | `products.available_online` flag | Website publication layer + inventory signals |
| Public checkout → OS | Partial storefront checkout | End-to-end order + payment + inventory hooks |
| Holiday Command Center | Not implemented | Define API contract before WS-4 UI |
| Structured data | Partial / planned in SEO doc | Server-render in `storefront-public.js` |
| Domain / SSL | Placeholders in instant website | Production domain adapter + status UI |
| Analytics | Not centralized | Tenant-scoped events table or adapter |
| Feature flags | `INSTANT_WEBSITE` (shipped RC1) vs `WEBSITE_STUDIO_V2` (future) | Gradual migration path |

**Daily Loop v3 alignment:** Contact preferences, delivery proof, and inventory freshness fields are **compatible** with Website Studio checkout and inventory-aware publishing — no rework required.

---

*This specification is permanent product direction. Implementation status lives in `docs/FLORISYN_MASTER_BUILD_CHECKLIST.md`.*
