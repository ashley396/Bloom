# Florisyn RC2 — The Luxury Experience

**Status:** In development on `cursor/florisyn-rc2-luxury-experience-7317`  
**Scope:** UI, UX, motion, typography, spacing, components — **no business logic changes**

---

## Mission

Transform Florisyn into the most beautiful florist software platform ever created while preserving all existing business logic, backend functionality, APIs, routing, authentication, permissions, workflows, and database architecture.

The experience should feel like walking into a luxury floral atelier — not opening business software.

---

## Design philosophy

Inspired by the quality, spacing, polish, and motion of Apple, Aesop, Hermès, Notion, and Linear — but with an **original Florisyn identity**.

| Principle | Implementation |
|-----------|----------------|
| Craftsmanship | Premium surfaces, editorial typography, restrained color |
| Calm | Large negative space, curated insights over dense dashboards |
| Warmth | Warm whites, creams, botanical greens, dusty rose |
| Precision | Invisible grid, perfect alignment, 44px tap targets |
| Motion | Silk-like transitions; `prefers-reduced-motion` respected |

---

## Color palette

| Token | Hex | Use |
|-------|-----|-----|
| Warm White | `#fffcf8` | Primary surfaces |
| Soft Cream | `#faf6ef` | App canvas |
| Ivory | `#fff9f2` | Hero backgrounds |
| Linen | `#f5f0e8` | Secondary surfaces |
| Champagne Gold | `#c4a574` | Accent, focus rings |
| Eucalyptus | `#6b8f7a` | Primary actions |
| Forest | `#3d4a38` | Button depth |
| Dusty Rose | `#c4a4a4` | Soft accent |
| Charcoal | `#2c2826` | Text (never harsh black) |

**Avoid:** Bright blues, generic SaaS colors, harsh black.

---

## Typography

| Role | Font | Use |
|------|------|-----|
| Display | Cormorant Garamond | Headings, Bloom Moment, hero |
| UI | DM Sans | Body, forms, navigation |

Loaded via Google Fonts in both production (`public/index.html`) and React preview (`frontend/index.html`).

---

## Signature experiences

### Bloom Moment

Every morning, an elegant premium card rotates inspirational quotes, floral wisdom, business encouragement, and seasonal messages.

| Stack | Location |
|-------|----------|
| Production | `public/florisyn-rc2-bloom-moment.js` → `#florisynBloomMoment` |
| React preview | `frontend/src/components/today/bloom-moment.tsx` |

### Daily Atelier Flow

Production timeline replacing boring task lists — deliveries, appointments, orders, calls, website orders, payments displayed like a luxury atelier schedule.

| Stack | Location |
|-------|----------|
| Production | `public/florisyn-rc2-atelier-flow.js` → `#florisynAtelierFlow` |
| React preview | `frontend/src/components/today/daily-atelier-flow.tsx` |

### Lily AI — Creative Director

Warm, elegant, never robotic. Arrangement ideas, marketing, inventory suggestions.

| Stack | Location |
|-------|----------|
| React preview | `frontend/src/components/today/lily-recommendation.tsx` |

### Rose AI — Operations Director

Confident, calm, concise. Delivery optimization, business insights, outstanding payments.

| Stack | Location |
|-------|----------|
| React preview | `frontend/src/components/today/rose-insight.tsx` |

---

## Phase 2 — Orders & POS (RC2)

Premium florist command center for high-volume days (Valentine's, Mother's Day, weddings).

| Capability | Production |
|------------|------------|
| Kanban / Timeline / Calendar / List views | `florisyn-rc2-orders-pos.js` view switcher |
| Stationery order cards | Thumbnail, priority, notes, typography hierarchy |
| Quick actions on hover | Edit, duplicate, print, call, message, assign, mark ready/delivered |
| Smart groups | Morning, afternoon, evening, rush, wedding, funeral, standing, business |
| Drag-and-drop columns | PATCH via existing `orders` API |
| POS receipt preview | Live cart preview beside checkout totals |
| Luxury payment confirmation | Payment Center success panel styling |

Accents reserved for **late**, **unpaid**, **rush**, and **overdue** only — everything else stays calm.

---

## File map

### Production (ships via Netlify → `public/`)

| File | Purpose |
|------|---------|
| `public/florisyn-rc2-tokens.css` | **Canonical design tokens** — maps all legacy `--pink`, `--brand-primary`, spacing, motion |
| `public/florisyn-rc2-luxury-experience.css` | Bloom Moment, Atelier Flow, base luxury body |
| `public/florisyn-rc2-luxury-unified.css` | Navigation, dialogs, forms, tables, kanban, POS, payments, mobile |
| `public/florisyn-rc2-luxury-modules.css` | **All 21 pages** — v13 pink neutralization, website studio, reports, marketplace, AI, settings |
| `public/florisyn-rc2-luxury-auth.css` | Auth pages |
| `public/florisyn-rc2-luxury-public.css` | Marketing site (14 pages) |
| `public/florisyn-rc2-luxury-admin.css` | Command Center |
| `public/florisyn-rc2-luxury-storefront.css` | Customer storefront |
| `public/florisyn-rc2-luxury-init.js` | Dialog polish, page consistency (UI only) |
| `public/florisyn-rc2-bloom-moment.js` | Bloom Moment |
| `public/florisyn-rc2-atelier-flow.js` | Daily Atelier Flow |
| `public/florisyn-rc2-orders-pos.css` | **Phase 2** — Orders workspace, stationery cards, POS checkout |
| `public/florisyn-rc2-orders-pos.js` | **Phase 2** — View switcher, quick actions, drag-drop, receipt preview |
| `public/onboarding.css` | Onboarding dialog styling (now wired) |

### React preview (design north star)

| File | Purpose |
|------|---------|
| `frontend/src/index.css` | Tailwind 4 luxury tokens |
| `frontend/src/lib/bloom-moment-quotes.ts` | Rotating content library |
| `frontend/src/pages/TodayPage.tsx` | Luxury command center layout |
| `frontend/src/components/today/*` | Bloom Moment, Atelier, Lily, Rose |
| `frontend/src/components/layout/LuxuryPageShell.tsx` | Shared luxury page chrome (React preview) |
| `frontend/src/components/ui/button.tsx` | Luxury button variants |

---

## Absolute constraints

**DO NOT MODIFY:**

- Business logic (`public/app.js` workflows)
- Backend / Netlify functions
- Authentication / permissions
- Routing behavior
- Database / Supabase / Stripe
- API endpoints

**ONLY REDESIGN:**

- UI, UX, motion, typography, spacing, components, layouts, visual hierarchy

---

## Accessibility & performance

- WCAG AA contrast on text and interactive elements
- 44px minimum tap targets (inherited from RC2 design system)
- Keyboard focus via champagne-gold rings
- `prefers-reduced-motion: reduce` disables animations
- CSS-only hover lifts — no unnecessary JS rendering
- 60 FPS target for motion utilities

---

## Dual-stack strategy

| Surface | Owner | Notes |
|---------|-------|-------|
| Production SPA (`public/`) | Ships today | CSS layers + DOM enhancement JS |
| React preview (`frontend/`) | Design iteration | Today + Orders luxury reference |

Do not drift tokens between stacks — update both `florisyn-rc2-luxury-experience.css` and `frontend/src/index.css` together.

---

## Related documents

- `FLORISYN_DESIGN_SYSTEM.md` — v1.0 component catalog
- `FLORISYN_EXPERIENCE_STANDARD.md` — UX constitution
- `FLORISYN_GOLD_STANDARD.md` — Product principles
- `BLOOM_RC2_FOUNDER_EDITION.md` — Prior RC2 public CSS work

---

*Florisyn RC2 — The Luxury Experience. UI/UX only. 2026-07-30.*
