# Bloom Foundation — Step 1

This is the first low-risk architecture cleanup for the `redesign-v22` branch.

## What changed

- Added `public/modules/core/dom.js` for shared DOM query helpers.
- Added `public/modules/core/format.js` for currency, date, and HTML-safe text formatting.
- Updated `public/app.js` to import those shared helpers.
- Updated `public/index.html` to load `app.js` as a JavaScript module.

## What did not change

- No Supabase schema changes.
- No Stripe changes.
- No Netlify Function changes.
- No visual redesign yet.
- No intended change to orders, customers, inventory, payments, invoices, Lily, or Rose.

## Test checklist

1. Sign in.
2. Open Point of Sale and add an item.
3. Open Orders, Customers, Inventory, Products, Payments, and Invoices.
4. Confirm prices still display as US dollars.
5. Confirm Lily and Rose panels still open.
6. Do not merge to `main` until the branch preview passes these checks.
