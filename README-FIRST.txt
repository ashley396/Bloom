BLOOM COMMERCIAL v4.1 — ONE-DEPLOY UPGRADE

NEW IN v4.1
- Edit and delete customers
- Customer search
- Edit and delete inventory
- Soft-delete recycle-bin protection
- Professional printable receipts
- Refreshed florist-style design
- Improved mobile layout and dashboard cards

IMPORTANT: USE ONLY ONE NETLIFY BUILD

1. RUN THE SMALL DATABASE MIGRATION FIRST
   In Supabase, open SQL Editor.
   Open: supabase/migrations/v4.1.sql
   Copy the complete file into SQL Editor and click Run.
   This does not use Netlify credits.

2. REPLACE YOUR CURRENT PROJECT FILES
   Copy the contents of this Bloom folder into the current GitHub Desktop Bloom repository.
   Allow Windows to replace matching files.

3. COMMIT ONCE
   Suggested summary:
   Upgrade Bloom to v4.1

4. PUSH ONCE
   Click Push origin in GitHub Desktop.
   Netlify should perform one deployment containing the entire update.

5. TEST AFTER NETLIFY SAYS PUBLISHED
   - Sign in
   - Search, edit and delete a test customer
   - Edit and delete a test inventory item
   - Open an order and select View receipt
   - Print the receipt or choose Save as PDF in the print window

NOTES
- Delete moves customers and inventory out of the active app instead of permanently destroying the database record.
- Existing orders, customers and inventory remain intact.
- No environment variables need to be changed for this update.
- Do not upload the .git folder from another repository over your existing .git folder.

SECURITY
Never share SUPABASE_SERVICE_ROLE_KEY or STRIPE_SECRET_KEY.
