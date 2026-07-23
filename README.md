# Bloom v2

This package replaces the incomplete Bloom files with a working Netlify + Supabase foundation.

## Do these steps only once

1. In Supabase, open **SQL Editor**, paste all of `supabase/schema.sql`, and click **Run**.
2. In Netlify, add these environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `STRIPE_SECRET_KEY`
   - `SITE_URL`
3. Copy every file and folder in this package into your local `Documents\GitHub\Bloom` folder.
4. In GitHub Desktop, commit all changes once and click **Push origin** once.
5. Netlify will deploy automatically from GitHub. Do not manually create another Netlify project.

Your publish directory is already fixed by `netlify.toml` as lowercase `public`, and your functions directory is already fixed as `netlify/functions`.

Important: rotate the Stripe secret key that was visible in screenshots before using payments.
