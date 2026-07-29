# Bloom v22.1 — Growth Foundation

## Included
- Full order editing from the production board, including recalculated totals and delivery-stop synchronization.
- Employee time-clock PINs stored as salted scrypt hashes; hashes are never returned to the browser.
- Lily writing-focus modes for local SEO, luxury conversion, weddings, sympathy, and holiday campaigns.
- Compact AI shop context so uploaded logo/hero images cannot be sent as huge base64 prompts.

## Deploy order
1. Run `supabase/migration_v22.1_growth_foundation.sql` once in Supabase SQL Editor.
2. Replace the project with this complete bundle on `redesign-v22`.
3. Commit and push once.
4. Hard-refresh the branch deployment.
5. Open each employee file and set a 4–8 digit PIN.

## Test checklist
- Edit an existing order and confirm it remains changed after refresh.
- Switch an order between Delivery and Pickup and confirm its delivery stop updates.
- Set an employee PIN; test correct and incorrect PINs for Clock In/Out.
- Choose Local SEO in Website Studio and have Lily rewrite the hero headline.
