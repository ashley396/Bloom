# Deploy preview key verification

Throwaway file to trigger a deploy preview build after the Supabase Staging
key rotation (2026-08-21): `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`
were updated to new-format `sb_publishable_...`/`sb_secret_...` keys for the
`deploy-preview` Netlify context, and the old leaked legacy JWT secret was
revoked in Supabase. This PR exists only to confirm deploy previews still
build clean with the new keys, and will be closed without merging.
