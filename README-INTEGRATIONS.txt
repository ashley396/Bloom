BLOOMOS v7 — OUTSIDE SERVICE CONNECTIONS

WHAT IS NOW WIRED INTO THE CODE
1. Bloom AI endpoint using the OpenAI Responses API.
2. Stripe Connect Express onboarding and supplier dashboard links.
3. Marketplace Checkout using Stripe destination charges and an application fee.
4. Database fields for connected Stripe accounts and integration event logging.

ONE-TIME SETUP
A. Supabase
Run supabase/migrations/v7.0.sql after the earlier Bloom migrations.

B. Netlify environment variables
Add:
- STRIPE_SECRET_KEY
- SITE_URL
- BLOOM_MARKETPLACE_FEE_PERCENT
Keep SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.

C. Stripe
- Activate Stripe Connect for the platform account.
- Complete platform business information.
- Set platform branding.
- Test Express onboarding in Stripe test mode first.
- Suppliers must complete onboarding before marketplace checkout can send them funds.

D. OpenAI
- Create an API project and API key.
- Add billing/usage limits.
- Put the key only in Netlify environment variables, never in public/app.js.

FUNCTIONS INCLUDED
/.netlify/functions/ai-assistant
/.netlify/functions/stripe-connect
/.netlify/functions/marketplace-checkout

IMPORTANT
These integrations become live only after your private keys and provider accounts are configured. Never upload secret keys to GitHub or paste them into browser code.

Bloom v17 AI requires no OpenAI key. See OLLAMA-INSTALLATION.md.
