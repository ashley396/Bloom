# Bloom v9.0.1 — Settings and Delivery Fix

- Adds the missing `shops.address` database column so the shop address can save.
- Adds a whole-dollar **Default delivery fee ($)** setting.
- Keeps sales tax as a percentage and delivery radius as miles.
- Makes Delivery the default fulfillment choice so the recipient address field is immediately visible.
- Prefills new delivery orders with the saved default delivery fee.
- Pickup automatically changes the delivery fee to $0.00.
- Adds clearer save success/error messages in Settings.

Run `supabase/migration_v9.0.1_settings_delivery_fee.sql` in Supabase before deploying.
