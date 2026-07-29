# Florisyn Founder Release 1.0 — Brand & Polish

**Branch:** `redesign-v22` · **Do not deploy** without founder approval.

## Shipped in this pass

- **Official logo:** Concept C (Monoline) in `public/assets/florisyn/` (`florisyn-mark.svg`, `favicon.svg`, light/dark/monochrome).
- **Taglines:** Primary — *The Operating System for Modern Florists*; Marketing — *Where Your Passion Flowers.*
- **App shell:** Title, loading screen, sidebar/header marks, PWA manifest, receipts (monoline fallback + “Powered by Florisyn”).
- **Auth:** Florisyn copy, founder polish CSS, friendly success states.
- **Public site:** 23 HTML pages updated (tagline, sage `theme-color`, favicon).
- **Admin HQ:** Florisyn naming (no Bloom HQ/POS in UI).
- **User-visible errors:** Server messages reference Florisyn where customers see them.
- **Cleanup:** Removed legacy `public/assets/bloom-*.svg`.
- **Polish layer:** `public/florisyn-founder-1.0.css` (hover, spacing, skeleton helper, auth success styling).

## Intentionally unchanged (no feature / schema work)

- Internal JS namespaces (`BloomRC21`, `bloom_session`, CSS file names).
- Database schema, Stripe wiring, product workflows.
- Staff privacy model (name + clock only on list; PIN file unchanged).

## Manual QA checklist

| Area | Desktop | Tablet | Mobile |
|------|---------|--------|--------|
| Login / signup / forgot / verify / reset | ☐ | ☐ | ☐ |
| Dashboard & command center | ☐ | ☐ | ☐ |
| Orders edit layout | ☐ | ☐ | ☐ |
| Staff list (privacy) | ☐ | ☐ | ☐ |
| Receipt / invoice print | ☐ | — | — |
| Favicon & PWA icon | ☐ | ☐ | ☐ |
| No console errors on load | ☐ | ☐ | ☐ |
| Keyboard / focus visible | ☐ | ☐ | ☐ |

## Verify locally

```bash
npm test
npx netlify dev
```

Open `/login`, `/`, `/company/about/`, and `public/assets/florisyn/concepts/preview.html` (concepts archive only; production uses Concept C in `florisyn/`).

## Tests added/updated

- `tests/florisyn-founder-1.0.test.js`
- `tests/florisyn-foundation.test.js`
- `tests/bloom-release.test.js`
- `tests/bloom-auth-branding.test.js`
