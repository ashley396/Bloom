# Bloom v24 — Polish Release

## Included
- Updated subscription pricing to Starter $59, Professional $99, and Premium $179.
- Repositioned Bloom as “The Operating System for Independent Florists.”
- Added Founding Florist pricing language to signup.
- Hardened AI response rendering so structured responses no longer display as `[object Object]`.
- Refined Lily and Rose prompts and browser speech settings for more natural personalities.
- Improved product-card image sizing, price visibility, and layout consistency.
- Changed Lily the dog from constant screen-crossing to occasional, helpful appearances.
- Preserved Bloom Technologies as the company name while using Bloom as the product name.

## Before deployment
Set Stripe price IDs in Netlify for the new $59, $99, and $179 recurring prices:
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_PROFESSIONAL`
- `STRIPE_PRICE_PREMIUM`
