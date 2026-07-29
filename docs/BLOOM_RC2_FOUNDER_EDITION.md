# Bloom RC2 — Founder Edition (Visual Transformation)

**Branch:** `redesign-v22` only · **Not merged to main · Not deployed to production**

## Summary of visual improvements

- **Bloom RC2 design system** (`public/bloom-rc2-design-system.css`) — unified typography scale, 44px controls, card shadows, form spacing, overflow fixes, responsive shell/aside, reduced-motion support layered on RC1 luxury tokens.
- **Luxury dashboard** (`public/bloom-rc2-dashboard.js`) — replaces decorative hero clutter with editable hero image, shop logo, welcome block, quick actions, staff/holiday stat slots; keeps live dashboard metrics from API.
- **Daisy mascot** — realistic golden doodle SVG (`public/assets/daisy/daisy-resting.svg`), stationary by default, optional interactive mode, hide/reduce motion/seasonal accessory in Settings.
- **Lily voice** — configurable rate/volume/voice + preview (`public/bloom-rc2-lily-voice.js`); warmer defaults; first-run welcome spoken once.
- **Floral Library** — **240** licensed starter arrangements (`floral-library-catalog.js`); paginated UI load-more; categories across everyday, wedding, sympathy, luxury, seasonal, plants.
- **Website** — visual theme cards with **Preview** (no save) and **Apply**; starter product seed on website wizard when shop has **zero** products (never overwrites existing).
- **Recipe privacy** — staff-only banner on Products & Recipe Builder.
- **Login** — RC2 typography/spacing on sign-in.

## Responsive layout improvements

- Dashboard hero stacks on mobile; sidebar wraps on tablet; Daisy scaled down on small screens.
- Theme preview modal single-column on narrow viewports.
- Library grid uses lazy images + incremental render (60 at a time).
- Global `overflow-x: hidden` on content; labels/buttons allow wrap (no forced truncation).

## Accessibility improvements

- Daisy decorative by default (`aria-hidden` when stationary).
- First-run dialog; live regions preserved from RC1.
- Focus/tap targets enforced at 44px minimum in RC2 CSS.
- `prefers-reduced-motion` disables Daisy wag and trims animations.

## Founder manual review checklist

Use this before calling RC2 complete (check each in browser on `redesign-v22`):

| Area | Verify |
|------|--------|
| Dashboard | Hero, logo, stats, quick actions, no cut-off text |
| POS | Product pads, cart, checkout card |
| Orders | Board + guided order |
| Customers | Profile modal |
| Inventory | Table + cooler toggle |
| Floral Library | 240 items, search, load more |
| Website Builder | Theme preview without save, apply confirms |
| Website (storefront) | `/store/{slug}` if configured |
| Staff / Payroll | Layout spacing |
| Payments | Payment Hub unchanged |
| Reports | Charts readable |
| Mobile / tablet / desktop | No horizontal scroll |
| Daisy | Resting; wag on welcome/order; not blocking buttons |
| Lily | Preview voice natural |
| Recipes | Privacy banner; not on public site |

## Screenshots (before/after)

Automated screenshots are not generated in-repo. For founder deliverables, capture pairs locally:

1. Save **before** from `main` (if available) or prior tag.
2. On `redesign-v22`, run `netlify dev` and capture **after** for: Dashboard, POS, Orders, Customers, Inventory, Library, Website Studio, Settings, Login — at 390px, 768px, 1280px widths.
3. Store under `docs/screenshots/rc2/` (optional folder; not committed unless you add them).

## Confirmations

- **Merged to main:** No  
- **Branch:** `redesign-v22`  
- **Production deploy:** No  

## Recommended commit message

```text
Apply Bloom RC2 founder visual system, Daisy mascot, and expanded floral catalog

Unify spacing and typography app-wide, redesign dashboard hero, add Lily voice
controls and 240-item library, and improve theme preview without altering payment or POS logic.
```
