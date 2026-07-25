# Bloom X v13.8 — System Debug

## Staff privacy
- Staff front page now shows only employee name, role, clock status, Clock In/Out, and Open Employee File.
- Pay rates, taxes, deductions, calculated pay, and time history are no longer displayed on the shared Staff page.
- Private details remain inside the employee form/file.

## Expenses
- Added search, category filtering, month filtering, visible total, and entry count.
- Added stronger date and amount validation.
- Save and delete actions now show failures instead of silently stopping.
- Receipt uploads remain limited to 5 MB and existing receipts are preserved when editing without a replacement.

## Reports
- Added total revenue, total expenses, net profit, and profit margin.
- Added monthly results and expense-by-category reporting.
- Added Refresh and CSV Export controls.
- Revenue includes only paid, non-cancelled orders.
- Invalid amounts and invalid dates are safely ignored instead of breaking the report.

## System checks
- Browser JavaScript and every Netlify function passed syntax checks.
- No new Supabase migration is required for v13.8 when the v13.6 staff migration has already been run.
