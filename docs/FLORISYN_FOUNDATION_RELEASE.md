# Florisyn Foundation Release

**Branch:** `redesign-v22` only · **No merge to `main`** · **No production deploy**

## 1. Branding summary

| Element | Implementation |
|---------|----------------|
| Name | **Florisyn** — operating system for independent flower shops |
| Palette | Sage green `#6b8f7a`, dusty rose `#c4a4a4`, ivory `#faf7f2`, charcoal `#2f2a2c`, champagne gold `#c9a962` |
| Logos | `public/assets/florisyn/` — mark, wordmark, light/dark, monochrome, favicon (new petal mark, not Bloom flower) |
| Tokens | `public/florisyn-brand.css` (loads last on app + auth) |
| Version label | **Florisyn Foundation** (`florisyn-version.js`, `bloom-version.js` shim) |
| PWA | `manifest.webmanifest` → name **Florisyn**, sage `theme_color` |
| Command center | Dashboard hero subline → **Florisyn Command Center** |
| Staff privacy | List shows **name + clock status only**; payroll/PIN behind **Employee file (PIN)** |

## 2. Screenshots

Not captured in this environment. Founder should screenshot at **1280 / 768 / 390px**:

- Login, signup, verify-email (success + `?error=1`), reset-password  
- Dashboard (command center)  
- Orders, Customers, Staff, Payments, Settings  

## 3. Changed files (high level)

- **New:** `public/assets/florisyn/*`, `public/florisyn-brand.css`, `public/florisyn-version.js`, `scripts/apply-florisyn-public-copy.mjs`, `tests/florisyn-foundation.test.js`, this doc  
- **Rebrand pass (~36+ files):** auth HTML, `index.html`, manifest, public marketing pages (Florisyn), `notification-email.js`, `bloom-release.js`, UI strings in `app.js`, payment hub, Lily, library, subscription, etc.  
- **Staff:** `bloom-rc2.1-founder-polish.js`  
- **Verify email:** `verify-email.js` (+ failure state `?error=1`)  

Internal module names (`BloomRC21`, `BloomPaymentHub`, `bloom_session`) remain for stability; **user-visible copy** targets Florisyn.

## 4. Remaining issues

- Residual **“Bloom”** may exist in: legacy release notes, root docs, internal filenames, `bloom-sites.com` subdomain label, class names (`bloom-auth`, `bloom-rc21`), and minified legacy CSS comments.  
- **Auth motion / full luxury redesign** (Part 4) — palette + copy done; dedicated motion pass optional.  
- **Orders Part 7** (receipt layout, delivery UX) — existing edit/payment flows preserved; deeper receipt redesign not fully re-spec’d in this pass.  
- **§11 manual QA** — still required on device.  
- **Screenshots** — founder to capture.  

## 5. Test results

Run: `node --test tests/*.test.js` (includes `tests/florisyn-foundation.test.js`).

## 6. Build confirmation

- No production deployment performed.  
- No merge to `main`.  

## 7. Deployment policy

Remain on **`redesign-v22`** until founder approval, full QA, and explicit deploy request.

---

*Florisyn is built by a florist, for florists — craftsmanship release on `redesign-v22`.*
