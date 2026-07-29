# Bloom RC1 — Luxury Experience & Instant Websites

Review-only SQL: `supabase/migrations/20260728_bloom_rc1_instant_websites.sql`

See also shared modules:
- `netlify/functions/_shared/bloom-instant-website.js`
- `netlify/functions/_shared/floral-library-core.js`
- `public/bloom-rc1-luxury.css`

Production setup: enable RC1 CSS on all authenticated pages; configure `instant-website` and `floral-library` Netlify functions; apply SQL after review.

Rollback: remove RC1 CSS/script includes from `index.html`; website projects remain in DB but unused.
