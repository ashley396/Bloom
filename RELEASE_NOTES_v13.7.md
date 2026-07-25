# Bloom X v13.7 Staff Button Fix

- Fixed the JavaScript startup crash caused by a missing assistant button.
- Restored the missing `loadDeliveries()` function so page navigation no longer throws a ReferenceError.
- Fixed the Add Employee button so it opens the employee form immediately.
- Added safer employee-dialog checks and a visible error instead of a silent failure.
- Removed duplicate malformed Staff page markup and duplicate `staffList` IDs.
- No new Supabase migration is required beyond the v13.6 staff/payroll migration.
