# Pending migrations (drafted, NOT applied, NOT canonical)

Files here are proposed Supabase migrations written for human review. They
are **not applied to any database** and are **not part of the canonical
migration set** in `../migrations/` — that directory's exact file list is
asserted by `tests/florisyn-live-schema-snapshot.test.js`
("canonical executable migrations have unique timestamp identities"), so a
draft file must not be dropped in there before it's actually reviewed and
run.

To promote a file once Ashley/ChatGPT has reviewed it and it has actually
been applied to a real Supabase project:

1. `git mv supabase/pending_migrations/<file>.sql supabase/migrations/<file>.sql`
2. Add `<file>.sql` to the expected file list in
   `tests/florisyn-live-schema-snapshot.test.js` (the
   `"canonical executable migrations have unique timestamp identities"` test).
3. Re-run `npm test` to confirm both the new migration's own tests and the
   canonical-list snapshot test pass together.
