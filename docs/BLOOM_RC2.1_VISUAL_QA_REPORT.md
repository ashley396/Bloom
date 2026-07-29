# Bloom RC2.1 §10 — Visual consistency QA report

**Branch:** `redesign-v22`  
**Date:** 2026-07-28  
**Method:** Code-driven layout audit at **1280px / 768px / 390px** breakpoints (CSS + markup), plus automated tests. **Founder browser pass still required** before RC2.1 sign-off.

**New assets:** `public/bloom-rc2.1-consistency.css` (final override layer), `public/bloom-rc2.1-consistency.js` (orders search wiring, dialog class pass).

---

## Legacy CSS audit (summary)

| Layer | Role | RC2.1 action |
|-------|------|----------------|
| `styles.css` | Base layout, mobile nav, legacy pinks | Overridden for nav active state, cards, tap targets via RC2 + RC2.1 consistency |
| `polish-v20.2.css` / `polish-v20.4.css` | v20 clip-path cards | Neutralized with `clip-path: none` on RC2.1 surfaces |
| `platform-v21.1.css`, `bloom-v23.css` | Platform chrome | Kept; headings/spacing aligned via RC2 tokens |
| `lily-platform.css` | Lily FAB/panel | Z-index + mobile offsets in consistency layer |
| `launch-polish-v1.css` | Empty/error/focus | Extended to all `.bloom-empty-*` / dialogs |
| `payment-hub.css`, `shop-billing.css`, `business-ecosystem.css` | Module shells | Grid gaps + panel borders unified |
| `bloom-rc1-luxury.css`, `bloom-rc2-design-system.css`, `bloom-rc2.1-polish.css` | Primary design system | Source of truth |
| `bloom-rc2.1-consistency.css` | **Last** load | Wins conflicts without removing old files (safe rollback) |

**Not removed:** Older stylesheets remain linked to avoid regression risk; overrides are intentional until a dedicated deprecation pass after founder approval.

---

## Page-by-page matrix

Legend: **Pass** = structure/CSS supports breakpoint; **Fix** = addressed in this pass; **Manual** = needs eyes in browser with real data.

### Dashboard (POS / `dashboardPage`)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| 1280px | **Pass** | POS grid + command center + RC2 hero; max-width 1280px on content |
| 768px | **Pass** | Profit grid stacks; welcome row single column (RC2) |
| 390px | **Fix** | Command center 2-col; card actions stack full-width; bottom padding for mobile nav |

**Problems found:** Legacy card clip-path; Lily/Daisy could overlap mobile checkout actions.  
**Fixes made:** Consistency surfaces; mobile safe areas for toast/Lily/Daisy; KPI strip from RC2.1.  
**Remaining:** Dense POS tile grid may need horizontal scroll on very small phones — **Manual**.

---

### Orders (`ordersPage`)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| 1280px | **Pass** | 5-column board with horizontal scroll fallback |
| 768px | **Pass** | Board scrolls; min column 260px |
| 390px | **Fix** | Production action buttons stack; search toolbar full width |

**Problems found:** Duplicate Refresh in orders toolbar vs heading.  
**Fixes made:** Search-only toolbar; refresh wired to existing `#refreshOrderBoard`. Timeline + invoice hooks (RC2.1).  
**Remaining:** Long order numbers in column headers — **Manual** truncation check.

---

### Payments (`paymentsPage`)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| 1280px | **Pass** | Two-column payment workspace |
| 768px | **Pass** | Single column stack |
| 390px | **Pass** | Tabs wrap; inputs 44px min-height (RC2) |

**Problems found:** Tab active state varied from module CSS.  
**Fixes made:** Unified `.payment-hub-tabs .active` blush styling.  
**Remaining:** Payment Hub provider cards — **Manual** with live Stripe connect.

---

### Customers (`customersPage`)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| 1280px | **Pass** | CRM cards grid |
| 768px | **Pass** | Single column cards |
| 390px | **Pass** | Avatar + actions stack |

**Problems found:** Missing eyebrow/subtitle vs other modules.  
**Fixes made:** Heading block aligned; `BloomRC21.customerCard`.  
**Remaining:** Customer profile drawer on small screens — **Manual**.

---

### Staff (`staffPage`)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| 1280px | **Pass** | Employee cards grid |
| 768px | **Pass** | |
| 390px | **Pass** | Clock actions full width |

**Problems found:** Title “Staff time clock” felt legacy.  
**Fixes made:** TEAM & PAYROLL eyebrow; staff cards; staff dialog eyebrow for payroll/PIN.  
**Remaining:** None critical — **Manual** PIN field on iOS numeric keyboard.

---

### Payroll (Staff employee file — `#staffDialog`)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| 1280px | **Pass** | Dialog max 640px; form fields RC2 |
| 768px | **Pass** | `.two`/`.three` stack via existing + recipe mobile rules |
| 390px | **Fix** | Dialog actions full width on narrow screens |

**Problems found:** No visual cue for sensitive payroll block.  
**Fixes made:** PIN-PROTECTED FILE eyebrow; dialog padding/actions consistency.  
**Remaining:** **Manual** — verify tax fields don’t overflow on 390px.

---

### Inventory (`inventoryPage`)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| 1280px | **Pass** | Visual card grid |
| 768px | **Fix** | Scan banner stacks; toolbar single column |
| 390px | **Pass** | Color tabs wrap (existing) |

**Problems found:** “Inventory Pro” branding drift.  
**Fixes made:** COOLER & STOCK eyebrow; visual cards + voice/scan hints.  
**Remaining:** Scan results table — **Manual** horizontal scroll.

---

### Floral Library (`libraryPage`)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| 1280px | **Pass** | Product grid; toolbar 2-col |
| 768px | **Pass** | Toolbar stacks |
| 390px | **Pass** | Card actions grid (legacy rule retained) |

**Problems found:** Image height inconsistent.  
**Fixes made:** 240px photos; recipe meta row (stems, time, profit).  
**Remaining:** **Manual** — preview dialog on mobile.

---

### Products & Recipe Builder (`productsPage` + `#productDialog`)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| 1280px | **Pass** | Product grid |
| 768px | **Pass** | |
| 390px | **Fix** | Recipe rows single column in dialog |

**Problems found:** Recipe builder wide grid on mobile.  
**Fixes made:** RC2 recipe privacy banner; dialog + recipe overflow rules.  
**Remaining:** **Manual** — add recipe row stress test.

---

### Website Builder (`websitePage`)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| 1280px | **Manual** | Editor injected by `instant-website-ui` / `website-editor-ui` |
| 768px | **Manual** | |
| 390px | **Manual** | |

**Problems found:** Dynamic UI not fully auditable statically.  
**Fixes made:** Page shell max-width + panel tokens apply to `#websitePage`.  
**Remaining:** **Manual** theme gallery + section reorder on all breakpoints.

---

### Marketing (no standalone route)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| — | **N/A** | Marketing via **Lily AI Studio** (`aiStudioPage`), **BloomShot** captions, **Business OS** (`ecosystemPage`) |

**Fixes made:** `.ai-empty-state` unified; AI Studio heading retained.  
**Remaining:** **Manual** ecosystem marketing tiles.

---

### Reports (`reportsPage`)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| 1280px | **Pass** | Report grid two columns |
| 768px | **Pass** | Stacks |
| 390px | **Fix** | `.report-row` auto-fit columns |

**Problems found:** Report rows cramped on mobile.  
**Fixes made:** Report row grid + overflow on `.report-table`.  
**Remaining:** CSV export button placement — **Manual**.

---

### Settings (`settingsPage`)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| 1280px | **Pass** | 2-col settings grid |
| 768px | **Pass** | Single column |
| 390px | **Pass** | Save button in heading stacks (RC2 mobile heading) |

**Fixes made:** Settings grid gap; panel tokens. Daisy/Lily settings panels unchanged functionally.  
**Remaining:** **Manual** long branding form scroll.

---

### BloomShot (`bloomshotPage`)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| 1280px | **Pass** | Editor + sidebar |
| 768px | **Manual** | Workspace likely stacks — depends on bloomshot CSS |
| 390px | **Fix** | Empty state styling aligned |

**Fixes made:** `.bloomshot-empty` luxury empty pattern.  
**Remaining:** **Manual** canvas width on 390px.

---

### Deliveries (`deliveriesPage`)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| 1280px | **Pass** | Summary strip + kanban |
| 768px | **Pass** | |
| 390px | **Pass** | Summary 2x2 auto-fit |

**Fixes made:** Delivery summary uses same metric strip as invoices/reports.

---

### Invoices (`invoicesPage`)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| 1280px | **Pass** | |
| 768px | **Pass** | |
| 390px | **Pass** | |

**Fixes made:** Invoice summary metric boxes unified.

---

### Lily AI Studio (`aiStudioPage`)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| 1280px | **Manual** | Split studio shell |
| 768px | **Manual** | |
| 390px | **Manual** | |

**Fixes made:** Composer textarea min-height; empty state panel.  
**Remaining:** **Manual** conversation panel height vs Lily FAB.

---

### Wholesale / Seller (`marketplacePage`, `wholesaleSellerPage`)

| Breakpoint | Result | Notes |
|------------|--------|--------|
| 1280px | **Pass** | Shell grid gap |
| 768px | **Manual** | Verification wizard steps |
| 390px | **Manual** | |

**Fixes made:** Marketplace shell spacing; verification dialogs already use `dialog-shell`.  
**Remaining:** **Manual** browse grid with cart badge.

---

### Stores, Subscription, Business OS, Expenses

| Page | Desktop | Tablet | Mobile | Fixes |
|------|---------|--------|--------|-------|
| Stores | Pass | Pass | Pass | Card grid tokens |
| Subscription | Manual | Manual | Manual | `shop-billing-root` gap |
| Business OS | Manual | Manual | Manual | `#ecosystemRoot` gap |
| Expenses | Pass | Pass | Pass | Eyebrow + expense toolbar flex |

---

### Sidebar routes (desktop) / Mobile nav

| Item | Result |
|------|--------|
| Aside buttons | RC2 44px targets |
| Mobile nav (5 tabs) | 48px height; active blush (not legacy hot pink) |
| “More” menu | **Manual** — verify all routes reachable |

---

### Dialogs, drawers, forms (global)

| Item | Result |
|------|--------|
| `dialog` padding/radius | **Fix** — consistency layer |
| Order builder (wide) | max 920px |
| Actions footer | Wrap + full width on 390px |
| Focus rings | `:focus-visible` brand outline |
| Reduced motion | Page + Daisy wag respected |

---

### Daisy & Lily

| Check | Result |
|-------|--------|
| FAB z-index below toast, above content | **Fix** (8500 vs 9100 toast) |
| Mobile: FAB above nav, not covering center tabs | **Fix** (bottom offsets) |
| Daisy pointer-events none | **Pass** |
| Panel width on mobile | inset 12px |

---

## RC2.1 completion status

| Gate | Status |
|------|--------|
| §10 CSS/markup pass (this document) | **In progress — code complete, manual matrix open** |
| §11 manual browser QA | **Not complete** |
| Legacy file removal | **Deferred** (override strategy) |
| Auth motion pass | **Deferred** (per founder priority) |
| Automated tests | Run after each change |

---

## Recommended founder manual checklist (15 min)

1. `netlify dev` → login → walk mobile nav + More menu.  
2. Orders board scroll + search at 390px width (DevTools).  
3. Open Staff → employee file → scroll payroll fields.  
4. Payments → both tabs.  
5. Website + Library one flow each.  
6. Toggle Lily panel over POS — confirm Process Payment still tappable.

---

*Generated as part of RC2.1 §10. Update this file when manual results are recorded.*
