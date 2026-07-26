# Bloom X v18.0 — Daily Operations Release

This bundled release improves the day-to-day florist workflow without requiring a new Supabase migration.

## Point of Sale
- POS checkout now keeps the newly created order connected to the Payments page.
- Stripe Checkout receives the correct order ID and order number so successful card payments can update the matching order.
- Saved Quotes now work on the current device. Quotes preserve the cart, customer selection, note, total, and creation time.
- Saved quotes can be resumed or deleted from the register.

## Payments
- Added an order payment summary with total, paid amount, and remaining balance.
- Added Cash, Check, and Other payment recording.
- Partial payments now update `amount_paid`, `balance_due`, and `payment_status` correctly.
- Added “Use full balance” and “Clear selected order” controls.
- Card checkout remains protected through Stripe Checkout.

## Dashboard
- Today’s Progress now calculates a real sales-goal percentage.
- Default daily goal is $1,000 when no custom goal exists.

## Deployment
- No SQL is required for this release.
- Existing Netlify environment variables remain required for Supabase and Stripe.
