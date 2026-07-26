# Bloom v20.5 — Admin Control Center

Adds a separate, secured platform administration experience at `/admin.html`.

## Included
- Separate admin login and page
- Platform-admin role verification on every request
- Florist account directory and search
- Remote account details editor
- Plan, trial, subscription, and access controls
- Remote theme and interface density editor
- Remote navigation ordering and page visibility
- Per-account feature controls
- Account announcements and support messages
- Maintenance and suspension screens
- Admin change history/audit trail
- Customer app configuration loader

## Security
The browser never receives the Supabase service-role key. All platform changes are performed through secured Netlify functions after both normal authentication and platform-admin authorization.

## Important scope
This release provides a safe administrative control foundation. Arbitrary code changes, database deletion, password viewing, and unlogged impersonation are intentionally not exposed in the admin browser because those controls would create unacceptable security and privacy risk.
