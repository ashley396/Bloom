# Bloom v9.0.2 — Receipt Fix

- Fixed the Expense Receipt Vault using the wrong response field.
- Uploaded receipts now display an **Open receipt** button.
- Added a safe Supabase migration for the `receipt_path` column and private `expense-receipts` storage bucket.
- Clears the previous receipt after an expense is saved so it cannot accidentally attach to the next expense.
- Improved the successful save message.
