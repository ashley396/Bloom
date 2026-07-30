# Florisyn Experience Standard

**The Permanent UX & Visual Design Constitution**

**Last updated:** 2026-07-30  
**Status:** Permanent — applies to all Florisyn screens, modules, and releases  
**Authority:** Owner-approved UX constitution; supersedes ad-hoc visual or interaction decisions that conflict with this document.

---

## Purpose

Every Florisyn screen should feel like it belongs to **one beautifully designed application**.

Users should immediately feel **calm**, **confident**, and **productive**.

**Companion principles:** `docs/FLORISYN_GOLD_STANDARD.md` (product behavior) — this document defines **how it looks and feels**. When Gold Standard §3 (Calm Software) or §8 (Delight) apply, this constitution is the implementation guide.

**Component & token reference:** `docs/FLORISYN_DESIGN_SYSTEM.md` — v1.0 design tokens, component catalog, layout patterns, and design review checklist. Experience Standard sets behavior; Design System sets implementation.

---

## Core experience principles

1. **Beauty never slows the florist down.**
2. **Every screen has one primary purpose.**
3. **Information is grouped naturally.**
4. **Important actions are obvious.**
5. **Advanced controls stay out of the way until needed.**

These five rules govern every layout, component choice, and interaction pattern.

---

## Visual language

### Typography

- Elegant, editorial-inspired headings
- Highly readable body text (comfortable at shop-counter distance)
- Clear visual hierarchy — one dominant heading level per screen region
- Consistent spacing between headings, cards, and content blocks

**Reference surface:** Approved **Today page** design language (`#dashboardPage` in `public/index.html` / `public/app.js`) — new screens must harmonize, not reinvent.

### Color

- Calm, premium palette — never loud or decorative for its own sake
- **Color communicates meaning**, not decoration (status, urgency, success, danger)
- Status colors remain **consistent throughout the application** (orders, deliveries, inventory, payments)

| Semantic use | Expectation |
|--------------|-------------|
| Order status | Same hue family on board, detail, and print views |
| Success / paid | Distinct from primary brand action color |
| Warning / expiring | Visible but not alarming unless action required |
| Danger / delete | Separated from primary actions; never adjacent without confirmation |

### Cards

Every major object is presented as a **premium card**:

- Subtle shadows (elevation, not heavy drop shadows)
- Generous padding
- Rounded corners (consistent radius across the app)
- Consistent spacing between cards in lists and grids
- Rich imagery where appropriate (arrangements, products, delivery proof thumbnails)

Cards are the default container for orders, customers, inventory items, website pages, and dashboard KPIs.

### Buttons

| Type | Rule |
|------|------|
| **Primary action** | Visually prominent; **one per screen** whenever possible |
| **Secondary actions** | Quieter visual weight; grouped logically near related content |
| **Danger actions** | Clearly separated from primary/secondary; **confirmation required** |

Never stack multiple competing primary buttons. If two actions seem equally important, redesign the screen hierarchy.

### Motion

Animations should:

- Feel smooth (60fps target; respect `prefers-reduced-motion`)
- Communicate state changes (saved, moved, published, error)
- **Never delay work** — no blocking animations on critical paths

| Approved examples | Avoid |
|-------------------|-------|
| Card elevation on hover/focus | Full-screen transitions between routine saves |
| Subtle fades for panel open/close | Spinners with no timeout or retry |
| Loading skeletons | Decorative motion during order entry peaks |
| Gentle transitions on status change | Auto-advancing carousels in POS |

Aligns with Gold Standard §9 Performance Budget.

---

## Layout

### Desktop

| Region | Responsibility |
|--------|----------------|
| **Left navigation** | Persistent module access; current section highlighted |
| **Top search / action bar** | Global search, primary create actions, session context |
| **Spacious content area** | One primary purpose per view; cards and lists breathe |
| **Optional contextual right panel** | Detail, edit, or Lily assist — closes without losing main context |

### Mobile

- **Bottom navigation** where appropriate (thumb reach, same modules as desktop)
- **Thumb-friendly controls** — minimum touch targets, no precision-only interactions
- **Same mental model as desktop** — florists switch devices; labels and flows must match

Do not ship a mobile-only workflow that hides capabilities available on desktop without explicit Holiday Mode or role rationale.

---

## Orders standard

Each order should feel like a **floral project**, not a spreadsheet row.

Every order presentation (board card, detail dialog, production ticket) should surface relevant context:

| Element | Required when available |
|---------|-------------------------|
| Arrangement photo | Hero or thumbnail on card |
| Customer | Buyer name + contact summary |
| Recipient | Name, phone, delivery address when different |
| Occasion | Tag or label |
| Delivery details | Date, window, zone, instructions |
| Designer | Assigned staff |
| Driver | Assigned staff |
| Timeline | Status history with timestamps |
| Status | Current workflow state (consistent colors) |
| Payment | Balance, paid/partial/unpaid indicator |

**Never resemble a spreadsheet.** Dense tabular order lists are forbidden for production UI; use cards, columns, or project tiles.

---

## Forms

Forms should:

- **Explain themselves** — labels, hints, and inline help before error states
- **Autofill where possible** — shop defaults, last-used values, customer lookup
- **Validate early** — inline feedback on blur or debounced input, not only on submit
- **Preserve work** — draft state, no data loss on navigation or transient API failure
- **Minimize typing** — pickers, toggles, and search-select over free text

Aligns with Gold Standard §2 Florist First and §5 One Click Rule.

---

## Empty states

Every empty screen must:

1. **Explain its purpose** — what this area is for
2. **Encourage the first action** — one clear CTA (create, import, connect)
3. **Never feel broken** — no raw "No data" or empty tables without illustration and copy

Empty states are onboarding moments, especially for new shops.

---

## Errors

Errors must:

1. **Explain what happened** — plain language, no stack traces or codes alone
2. **Explain how to fix it** — next step, retry, or contact path
3. **Preserve user work whenever possible** — do not clear forms on recoverable failures

Use `BloomLaunchPolish.errorState` patterns in production SPA. React preview must match tone and structure.

---

## Accessibility

**Required** on every shipped screen:

| Requirement | Minimum |
|-------------|---------|
| Keyboard navigation | All interactive controls reachable and operable |
| Visible focus | Focus ring or equivalent; never `outline: none` without replacement |
| Readable contrast | WCAG AA for body text and controls |
| Scalable text | Layout survives browser/OS text scaling |
| Screen-reader support | Semantic landmarks, live regions for async updates |
| Descriptive labels | Icons and icon-only buttons have accessible names |

Accessibility is not optional polish — it is part of feature completeness.

---

## Performance

Targets (align with Gold Standard §9):

| Target | Expectation |
|--------|-------------|
| Fast initial load | Production SPA under 2 seconds on broadband |
| Responsive interactions | Input and board moves feel immediate |
| Graceful offline / error handling | Clear messaging; retry without data loss |
| Optimistic updates where safe | Order board moves, saves — reconcile on server response |

Beauty must not trade away performance on critical paths (see Core principle §1).

---

## Florist emotion standard

The software should feel:

- **Welcoming** — first login and empty states invite, not intimidate
- **Organized** — florists always know where they are and what is next
- **Elegant** — premium without pretension; worthy of a fine floral brand
- **Dependable** — saves stick, payments reconcile, status is trustworthy
- **Enjoyable during busy holidays** — stress goes down, not up

It should **reduce stress rather than create it**. This is the emotional test behind Gold Standard §3 Calm Software.

---

## Permanent completion gate

Before any feature is considered **complete**, ask:

| Question | Must be **Yes** |
|----------|-----------------|
| Is it beautiful? | Harmonizes with Today page and card language |
| Is it intuitive? | One primary purpose; obvious actions |
| Is it fast? | Meets performance targets; motion never blocks |
| Is it accessible? | Keyboard, focus, contrast, labels |
| Does it reduce work? | Fewer clicks, less typing, clearer grouping |
| Does it fit the Today page design language? | Typography, color, spacing, cards |
| Would a florist enjoy using it for an entire workday? | Calm under Valentine's, Mother's Day, funerals, weddings |

**If any answer is "No", the feature is not complete.**

---

## Application to development

All agents and engineers must:

1. Read this constitution before designing or shipping UI.
2. Reference the Experience Standard in PR descriptions for visual or UX changes.
3. Use the Today page as the visual anchor — propose owner approval before diverging.
4. Update `FLORISYN_MASTER_BUILD_CHECKLIST.md` when shipping UX work that advances a section.

**Conflicts with Gold Standard:** Product principles win on data integrity and recovery; Experience Standard wins on visual cohesion and interaction clarity. Escalate to owner if unresolved.

---

## Document index

| Document | Relationship |
|----------|--------------|
| `FLORISYN_GOLD_STANDARD.md` | Product principles — Calm Software, Delight, Performance |
| `FLORISYN_MASTER_ARCHITECTURE_BIBLE.md` | Architecture index |
| `FLORISYN_DESIGN_SYSTEM.md` | v1.0 tokens, components, layout patterns |
| `FLORISYN_MASTER_BUILD_CHECKLIST.md` | Verification tracking per experience area |
| `FLORISYN_WEBSITE_STUDIO_BLUEPRINT.md` | Website Studio editor must obey this constitution |
| `public/styles.css` | Production SPA visual implementation |
| `frontend/src/` | React preview — must not drift arbitrarily from production language |

---

*Permanent UX & visual design constitution — Florisyn Experience Standard. Added 2026-07-30.*
