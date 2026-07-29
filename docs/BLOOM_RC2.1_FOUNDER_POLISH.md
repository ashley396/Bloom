# Bloom RC2.1 — Premium Founder Polish

Development branch only (`redesign-v22`). Do not merge to `main` or deploy until founder sign-off and full QA (§11 of RC2.1 spec).

## Delivered in this layer

| Area | Implementation |
|------|----------------|
| App shell | `bloom-rc2.1-polish.css`, loading screen `#bloomLoadingScreen`, `body.bloom-rc21` |
| Dashboard | Command-center KPI strip + Lily insight via `BloomRC21.enhanceCommandCenter` (with RC2 hero/quick actions) |
| Customers | Avatar cards, reminders, lifetime spend — `BloomRC21.customerCard` |
| Staff | Avatar cards, role badges, PIN copy — `BloomRC21.staffCard` |
| Orders | Timeline chips, print invoice, search toolbar — `wrapProductionOrder`, `mountOrdersToolbar` |
| Inventory | Visual grid cards, supplier line, voice/scan hints — `BloomRC21.inventoryCard` |
| Floral Library | Larger photos, stem count, design time, est. profit — `floral-library-ui.js` |
| Auth | `reset-password.html` + `auth-reset-password.js`; forgot email redirects to `/reset-password` |
| Lily / Daisy | Subtle opacity/title tuning in `tuneLily` |

## Remaining for full RC2.1 sign-off

- **§10 manual matrix:** See [BLOOM_RC2.1_VISUAL_QA_REPORT.md](./BLOOM_RC2.1_VISUAL_QA_REPORT.md) — browser verification at 390 / 768 / 1280 still required.
- Legacy CSS files remain linked; conflicts overridden by `bloom-rc2.1-consistency.css` (last).
- Auth screens: motion pass deferred until after §10 manual sign-off.

## Tests

```bash
node --test tests/*.test.js
```

Includes `tests/bloom-rc2.1.test.js` and updated auth branding coverage for reset password.
