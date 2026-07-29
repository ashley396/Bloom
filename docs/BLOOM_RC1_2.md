# Bloom RC1.2 — Commerce Completion

Review-only SQL: `supabase/migrations/20260728_bloom_rc1_2_commerce.sql`

## Scope

Completes public storefront ordering started in RC1.1:

- Server-side cart reconciliation (prices from catalog, no client tampering)
- Full checkout fields (recipient, card message, delivery date, instructions)
- **Pay now** via Stripe Checkout (same webhook metadata as POS — `bloom_order_id` / `bloom_shop_id`)
- **Pay later** with optional auto payment link when Payment Experience migration is applied
- Commerce settings on `bloom_website_projects.commerce_settings`

## Not changed

- Staff-authenticated `create-checkout.js`
- Payment Hub POS flows, `orders.js` staff APIs, marketplace checkout

## Env

Uses existing `STRIPE_SECRET_KEY`, `SITE_URL` / `URL`, and `STRIPE_ORDER_WEBHOOK_SECRET` for payment confirmation.
