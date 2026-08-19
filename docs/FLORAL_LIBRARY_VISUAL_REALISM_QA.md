# Floral Library Visual Realism QA

**Date:** 2026-08-11  
**Scope:** 100 Everyday arrangements (`ed-01` … `ed-100`)  
**Method:** Human/visual review of on-disk JPEGs + automated hash integrity checks

## Initial audit (pre-replacement)

| Result | Count |
|--------|------:|
| **Pass** | 26 |
| **Fail** | 74 |

Common failure modes:

- Wrong Pexels ID mapped to non-floral stock (portraits, landscapes, food, tools, seafood)
- Product flat-lays (skincare bottles + petals)
- Single stems, petal bowls, or shop inventory — not composed arrangements
- AI artifacts (`ed-14-lavender-breeze`: gibberish label text)

Full per-arrangement results: `public/data/floral-library-visual-qa-results.json`

## Replacement action

- **74 failed** images replaced via `scripts/replace-failed-floral-library-images.mjs`
- Sources: Florisyn-owned arrangement JPGs (8) + verified Pexels vase/bouquet pool (`scripts/floral-library-arrangement-ids.json`)
- **26 passed** images kept unchanged (stable IDs + recipes)
- **0** items left as `needs_image_replacement` after replacement

## Post-replacement integrity

| Metric | Value |
|--------|------:|
| Total arrangements | 100 |
| Image filenames | 100 |
| Unique image file hashes | 100 |
| Duplicate hash groups | 0 |
| Missing image files | 0 |
| `needs_image_replacement` | 0 |

## Regression coverage

```bash
npm run test:floral-library-duplicate-hash
npm run audit:floral-library-images
node scripts/replace-failed-floral-library-images.mjs  # re-run after QA JSON updates
```

## Notes

- Hash uniqueness ≠ visual realism; this pass replaced known-bad assets identified by visual QA.
- Re-review recommended after any bulk Pexels pool change.
- Public starter catalog excludes any future `needs_image_replacement` items via `getPublicFloralLibraryCatalog()`.
