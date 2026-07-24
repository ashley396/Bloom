BLOOM v8.0 — FLORIST ORDER BUILDER

WHAT IS NEW
- Full-screen professional florist Order Builder
- Existing-customer lookup and phone autofill
- Recipient, occasion, source, design style and color palette
- Preferred flowers, restrictions, arrangement description and add-ons
- Pickup/delivery workflow with location type, driver and instructions
- Live total and estimated-profit preview
- Labor, discount, tax, delivery, add-ons, deposit and material-cost fields
- Rush/VIP production priority
- Mobile-responsive order-building layout

DEPLOY IN TWO STEPS
1. In Supabase SQL Editor, run: supabase/migrations/v8.0.sql
2. Upload or push this entire project to your existing Netlify site once.

IMPORTANT
- Keep your existing Netlify environment variables.
- Do not put secret keys into public files.
- Test one order after deployment before using it for live sales.

QUICK TEST
- Sign in
- Click + New order
- Select or type a customer
- Choose a product and verify the live total changes
- Switch Pickup to Delivery and verify delivery fields appear
- Add labor, delivery, tax or discount and verify totals
- Create the order and open its receipt

BLOOMOS v7.0 — INTEGRATION-READY RELEASE

This package contains the full Bloom Flagship v6 application plus live-ready server connections for OpenAI and Stripe Connect.

INSTALL
1. Copy this package into the Bloom repository and replace existing files.
2. Run supabase/migrations/v7.0.sql in Supabase SQL Editor.
3. Add all variables shown in .env.example to Netlify.
4. Redeploy once.
5. Read README-INTEGRATIONS.txt before enabling live payments.

NOW INCLUDED
- Bloom AI server endpoint
- Stripe Connect Express account onboarding
- Stripe connected-account dashboard links
- Marketplace destination-charge checkout with configurable Bloom fee
- Secure server-side keys only
- Integration event database foundation

NOT AUTOMATICALLY INCLUDED
Provider approval, identity verification, business verification, API billing, domain ownership, and production payment activation must be completed in the provider dashboards by the account owner.
