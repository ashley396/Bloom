# Bloom v19.1 — Orders, Payments & Lily Hotfix

## Fixed
- Production Board can move orders into **Out / Pickup** after the included Supabase constraint migration is run.
- Invoice **Take payment** now opens the Payments page with the correct order and remaining balance.
- Added **Edit** and **Delete** actions to order cards and invoice cards.
- Editing recalculates subtotal, tax, total, balance due, and payment status without deducting inventory a second time.
- Orders with recorded payment transactions are protected from deletion.
- Lily now tries local AI first and automatically falls back to secure Bloom Cloud AI through Netlify.
- AI keys remain server-side and are never exposed in the browser.

## Required setup
- Run `supabase/migration_v19.1_order_status_hotfix.sql`.
- Deploy the full project once.
- For Lily cloud fallback, add `OPENAI_API_KEY` and optionally `OPENAI_MODEL` in Netlify environment variables.
