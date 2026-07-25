# Bloom v9.0 Production Candidate

This release is built from the full v8.5.5 project and preserves the complete sidebar, Website Studio, customer editing/deleting, orders, payments, deliveries, products, recipes, reports, staff, wholesale, and stores.

## Integrated changes
- Shop Settings page for default tax rate, shop route origin, and delivery radius.
- Percentage tax uses the shop default on every new order.
- Personal orders continue directly to Payment Center; business accounts may invoice later.
- Deposits, balances, payment status, method, recipient details, card message, and delivery details save with orders.
- Automatic driving mileage, round-trip mileage, and estimated drive time through Google Routes API.
- Delivery Center displays addresses, mileage, drive time, navigation, and status workflow.
- Customer business-account flag while retaining Edit and Delete.
- Website Studio includes four selectable florist hero photographs and live desktop/mobile preview.
- Versioned, additive Supabase migration.

## Required setup
1. Run `supabase/migration_v9.0_integrated.sql` once in Supabase SQL Editor.
2. In Bloom Settings, save the shop's full starting address and default tax rate.
3. For automatic mileage, add `GOOGLE_MAPS_API_KEY` in Netlify environment variables and enable Google Routes API with billing and a protective quota.

The rest of Bloom works without the Google key; only automatic road mileage will show a setup message until it is configured.
