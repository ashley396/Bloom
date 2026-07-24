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
