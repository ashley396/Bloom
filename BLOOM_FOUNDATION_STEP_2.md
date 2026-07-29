# Bloom Foundation — Step 2

This step adds the first visible Bloom Foundation polish while leaving business logic untouched.

## What changed

- Added `public/foundation-v22.css` as a dedicated visual-system override.
- Updated `public/index.html` to load the new stylesheet last.
- Refined Bloom's palette, typography, spacing, cards, forms, navigation, dialogs, dashboard, and mobile presentation.
- Added stronger keyboard focus states and reduced-motion support.

## What did not change

- No Supabase schema or query changes.
- No Stripe or payment-function changes.
- No inventory, customer, order, invoice, staff, Lily, or Rose logic changes.
- No Netlify configuration changes.

## Quick test

1. Sign in.
2. Confirm the dashboard loads and the left navigation works.
3. Open Orders, Customers, Inventory, Payments, and Invoices.
4. Open and close one dialog, such as Add Customer.
5. Check the branch preview on both desktop and phone.
