BLOOM COMMERCIAL v4 — CLEAN INSTALL

WHAT IS INCLUDED NOW
- Account creation and login
- Multi-shop database foundation
- Customer management
- Order management
- Inventory management
- Expense tracking
- Profit dashboard
- Delivery list
- Stripe checkout
- Employee and multi-location-ready database structure
- Netlify + Supabase deployment files
- Mobile and desktop responsive design

WHAT IS PREPARED AS FUTURE MODULES
- Square payments
- AI photo pricing
- Receipt-photo inventory
- Hi Bloom voice assistant
- Website builder
- Wholesale marketplace
- Native App Store and Google Play wrappers

INSTALL WITH ONE DEPLOY

1. SUPABASE
   Open Supabase > SQL Editor.
   Open supabase/schema.sql from this project.
   Copy all of it into SQL Editor and click Run once.

2. NETLIFY ENVIRONMENT VARIABLES
   Confirm these variables exist:
   SUPABASE_URL
   SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   STRIPE_SECRET_KEY
   SITE_URL

3. GITHUB
   Create or use one clean GitHub repository folder.
   Copy EVERYTHING from this Bloom_Commercial_v4 folder into that repository.
   Commit once and Push origin once.

4. NETLIFY
   Connect that repository.
   Netlify will use netlify.toml automatically.
   Do not manually change the publish folder.

5. OPEN BLOOM
   Open the Netlify site and create your account.

SECURITY
Never share SUPABASE_SERVICE_ROLE_KEY or STRIPE_SECRET_KEY.
Rotate any secret key that has appeared in a screenshot.
