# Florisyn Design System v1.0

**Permanent UI Component & Design Reference**

**Last updated:** 2026-07-30  
**Status:** Permanent — applies to Florist, Wholesaler, and Platform Owner portals  
**Authority:** Single source of truth for visual components, layout, interaction, and design tokens. Supersedes ad-hoc UI patterns that duplicate or conflict with this system.

---

## Purpose

The Florisyn Design System is the **single source of truth** for every visual component, layout, interaction, and design token used across the **Florist**, **Wholesaler**, and **Platform Owner** portals.

**Companion documents:**

| Document | Role |
|----------|------|
| `FLORISYN_EXPERIENCE_STANDARD.md` | UX constitution — calm, florist emotion, completion gate |
| `FLORISYN_GOLD_STANDARD.md` | Product principles — performance budget, delight |
| `FLORISYN_ECOSYSTEM_PORTALS_STANDARD.md` | Three portals share one design system |
| `public/styles.css` | Production SPA token + component implementation |
| `frontend/src/index.css` + `frontend/src/components/ui/` | React preview token + shared components |

**Long-term goal:** A florist should move from Orders → Inventory → Website Studio → Marketplace **without feeling like they left the same application**.

---

## Design tokens

Tokens are semantic roles — not one-off hex values in feature code. Extend tokens here before adding new colors or spacing in modules.

### Color roles

| Role | Purpose | Production reference (`public/styles.css`) |
|------|---------|------------------------------------------|
| **Primary** | Main brand actions, active nav | `--brand-primary` (`#f05686`) |
| **Secondary** | Supporting brand accent | `--brand-secondary` (`#93bd6b`) |
| **Success** | Paid, delivered, approved | `.badge.good` |
| **Warning** | Expiring, action needed | `.badge.warn`, `.kpi-card.alert` |
| **Error** | Failures, danger actions | `.danger` |
| **Information** | Neutral guidance, tips | `.subtle`, `.meta`, status notes |
| **Surface** | Cards, panels, dialogs | `.panel`, `.card` — white at ~93% opacity |
| **Background** | App canvas | `--app-background` (`#fff9f7`) |
| **Border** | Dividers, input borders | `--line` / `#eee1e4` |
| **Text Primary** | Headings, body | `--ink` (`#40343a`) |
| **Text Secondary** | Labels, hints, metadata | `--muted` (`#7c6d74`) |

**Rule:** Colors communicate meaning before decoration. Do not use primary brand color for non-action decoration.

React preview mirrors roles in `frontend/src/index.css` (`--color-charcoal`, `--color-blush-500`, `--color-sage-muted`, etc.).

### Typography

**Heading scale**

| Token | Use | Production |
|-------|-----|------------|
| **Display** | Today hero, major welcome | `.dashboard-welcome-copy h1` — editorial script |
| **H1** | Page titles | `h1` — 34–42px, Georgia / editorial |
| **H2** | Panel titles | `.panel-heading h2` — ~25px |
| **H3** | Section / card titles | `h3`, `.builder-section h3` — ~19–20px |
| **H4** | Subsection labels | `.eyebrow` — 11px, uppercase, letter-spaced |
| **Body Large** | Emphasis copy, summaries | `.summary-row strong`, hero sublines |
| **Body** | Default UI text | `body` — Segoe UI / Inter stack |
| **Small** | Hints, KPI labels | `.kpi-card span`, `small` |
| **Caption** | Timestamps, footnotes | `.meta`, chart labels |

Editorial-inspired headings. Readable body text. Consistent line heights (~1.45–1.55 for body).

**Font pairing:** Georgia (or editorial serif) for headings; sans-serif for UI chrome and forms.

### Spacing

Use **one spacing scale** across the platform:

```
4 • 8 • 12 • 16 • 24 • 32 • 48 • 64 px
```

| Context | Typical token |
|---------|---------------|
| Tight inline gap | 4–8px |
| Form field gap | 12–16px |
| Card padding | 16–24px |
| Section margin | 24–32px |
| Page padding | 28px desktop / 14–18px mobile |
| Hero / dashboard rhythm | 48–64px |

**Never invent one-off spacing.** Map to the nearest scale step.

### Corner radius

| Token | Value | Use |
|-------|-------|-----|
| **Small** | 11–12px | Inputs, chips, small buttons |
| **Medium** | 16–18px | Cards, panels (`--radius: 18px`) |
| **Large** | 20–22px | Dialogs, dashboard hero |
| **Extra Large** | 24–28px | Auth cards, major modals |

Applied consistently — do not mix arbitrary radii on the same screen.

### Shadows

| Token | Use | Production |
|-------|-----|------------|
| **Small** | Inputs, subtle elevation | `--shadow-soft` |
| **Medium** | Cards, panels | `--shadow-soft` on `.card` |
| **Large** | Dialogs, sticky summaries | `--shadow`, dialog backdrop |

Soft and premium. Never harsh drop shadows.

### Motion

| Token | Duration | Use |
|-------|----------|-----|
| **Fast** | 150ms | Hover, focus, chip toggle |
| **Normal** | 250ms | Panel open, card lift, chart bar |
| **Slow** | 350ms | Page-level transitions (rare) |

Motion communicates — not distracts. Respect `prefers-reduced-motion` (see React `motion-safe-*` utilities and disable decorative animation under reduced motion).

**Rule:** No motion on critical save/submit paths that blocks the next action.

---

## Core components

Each component requires documentation of: **Purpose**, **Variants**, **States**, **Accessibility**, **Mobile behavior**, **Animation**, **Usage examples**.

### Component catalog

| Component | Production | React preview | Notes |
|-----------|--------------|---------------|-------|
| **Buttons** | `.primary`, `.secondary`, `.danger` | `ui/button.tsx` | One primary per screen |
| **Icon Buttons** | `.mic-button`, `.close` | `Button size="icon"` | Min 44×44px touch target |
| **Inputs** | `input`, `select`, `textarea` | Form primitives | 42px min-height production |
| **Search** | `.search` | — | Max-width ~500px |
| **Dropdowns** | `select`, shop switcher | — | Native or styled select |
| **Date Pickers** | Order/delivery fields | — | Prefer native where possible |
| **Cards** | `.card`, `.panel` | `ui/card.tsx`, `surface-card.tsx` | Premium card standard |
| **Product Cards** | `.product-card` | Floral catalog cards | 4:3 imagery |
| **Order Cards** | Kanban `.card` | — | See Orders Standard below |
| **Customer Cards** | CRM `.card` | — | Contact summary + actions |
| **Timelines** | Order status history | — | Timestamped vertical list |
| **Status Badges** | `.badge`, `.badge.good`, `.badge.warn` | — | Semantic colors |
| **Tables** | `.report-table`, `.report-row` | — | Prefer cards for mobile |
| **Kanban Columns** | `.kanban`, `.kanban-col` | — | Production board |
| **Charts** | `.sales-chart`, dashboard bars | `SalesTrendChartInner.tsx` | Degrade gracefully |
| **Tabs** | `.preview-tabs` | — | Clear active state |
| **Drawers** | Order builder side summary | — | Sticky contextual panel |
| **Modals** | `dialog` | — | Focus trap, backdrop |
| **Toasts** | `.toast` | — | Bottom-right, non-blocking |
| **Alerts** | `.inventory-advice`, status notes | — | Inline, actionable |
| **Empty States** | `BloomLaunchPolish.errorState`, `empty()` | — | Purpose + CTA |
| **Loading Skeletons** | — | Planned | Prefer skeleton over spinner |
| **Progress Indicators** | Verification progress bar | — | Step wizards |

**New components:** Document in this file (or linked component README) before production use. Add to React `ui/` when preview needs parity.

---

## Layout patterns

Standard layouts — reuse shell structure; do not invent new navigation models per feature.

| Pattern | Structure | Examples |
|---------|-----------|----------|
| **Dashboard** | KPI row + main grid + lower grid | Today (`#dashboardPage`) — **visual anchor** |
| **List + Detail** | List left/top, detail panel right | Customers, orders dialog |
| **Kanban** | Status columns + draggable cards | Orders production board |
| **Full-screen Form** | Dialog or dedicated builder | Order builder, verification wizard |
| **Analytics** | Summary metrics + chart + table | Reports |
| **Settings** | Two-column settings grid | Shop settings, branding |
| **Wizard** | Step progress + next/back | Marketplace verification |
| **Website Studio** | Left controls + center/preview canvas | `website-studio-layout` |
| **Marketplace** | Browse grid + cart badge | `marketplacePage` |
| **Admin Console** | Platform metrics + review queues | `admin.html`, command center |

### Responsive shell

| Breakpoint | Behavior |
|------------|------------|
| **Desktop** | Left nav (205px) + top header + content + optional right panel |
| **Tablet** | Collapsed grids; 2-column kanban |
| **Mobile** | Hidden sidebar; bottom nav (5 columns); thumb-friendly padding |

Maintain the **same mental model** across devices (Experience Standard + Ecosystem Portals).

---

## Orders standard (design)

Orders are **projects** — not spreadsheet rows.

Every order card must support (when data exists):

| Field | Presentation |
|-------|----------------|
| Photo | Arrangement thumbnail / hero |
| Customer | Buyer name |
| Recipient | Name + delivery context |
| Occasion | Tag or label |
| Timeline | Status history |
| Status | Badge with consistent semantic color |
| Designer | Assigned staff |
| Driver | Assigned staff |
| Payment | Paid / partial / balance indicator |
| Delivery | Date, window, address summary |

Kanban cards, order dialog header, and production print must share the same visual vocabulary.

---

## Accessibility (component-level)

Every component must support:

| Requirement | Implementation |
|-------------|----------------|
| Keyboard navigation | Tab order, Enter/Space activation |
| Visible focus | Focus ring — never removed without replacement |
| Screen readers | `aria-*`, `.visually-hidden`, semantic landmarks |
| WCAG-compliant contrast | AA minimum for text and controls |
| Responsive layouts | No horizontal-only critical actions |
| Touch targets | Minimum 44×44px on mobile |
| Reduced motion | Disable decorative animation; keep state feedback |

See `FLORISYN_EXPERIENCE_STANDARD.md` § Accessibility for feature-level requirements.

---

## Design review checklist

Before a feature is **complete**:

- [ ] Uses approved **design tokens** (not hardcoded one-offs)
- [ ] Uses **shared components** (extends before inventing)
- [ ] Matches **Today page** design language
- [ ] **Accessible** (keyboard, focus, contrast, labels)
- [ ] **Responsive** (desktop, tablet, mobile)
- [ ] **Fast** (Gold Standard §9 — no beauty that blocks work)
- [ ] Consistent with **Experience Standard**
- [ ] Consistent with **Gold Standard**

If any item fails, the feature is not complete.

---

## Implementation policy

1. **Build reusable components** — production CSS classes and React `ui/` primitives.
2. **Never create duplicate UI patterns** — search `styles.css` and `components/ui/` first.
3. **Extend existing components** before inventing new ones.
4. **Feature teams consume the Design System** — do not fork per portal.
5. **Document every new component** in this reference before production use.

### Token change process

1. Propose token in this document.
2. Update `public/styles.css` `:root` and React `index.css` together.
3. Verify Today page and one secondary screen (Orders).
4. Owner approval for brand-primary or typography scale changes.

### Portal parity

| Portal | Design System entry |
|--------|---------------------|
| Florist | `public/styles.css` + `public/index.html` shell |
| Wholesaler | Same tokens — `wholesaleSellerPage`, marketplace |
| Platform Owner | Same tokens — `admin.html` (may use denser admin layout) |

---

## Document index

| Document | Relationship |
|----------|--------------|
| `FLORISYN_EXPERIENCE_STANDARD.md` | UX behavior and completion gate |
| `FLORISYN_GOLD_STANDARD.md` | Performance budget, delight |
| `FLORISYN_ECOSYSTEM_PORTALS_STANDARD.md` | Shared design system across portals |
| `FLORISYN_MASTER_BUILD_CHECKLIST.md` | Component ship status |
| `public/styles.css` | Production implementation |
| `frontend/src/components/ui/` | React shared components |

---

*Florisyn Design System v1.0 — permanent UI reference. Added 2026-07-30.*
