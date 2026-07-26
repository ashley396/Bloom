# Bloom v18.5 — Payment Integrity & Security

- Adds an immutable payment ledger.
- Adds idempotent, transactional payment posting.
- Validates Stripe charge amounts against the server-side order balance.
- Adds a signed Stripe webhook, so payments post even if the browser never returns.
- Correctly accumulates deposits and sets PARTIAL/PAID from the remaining balance.
- Blocks suspended/inactive memberships.
- Adds role checks for payments and sensitive settings/staff/finance endpoints.
- Uses payment dates and amounts for dashboard revenue after migration.
- Adds syntax-check tooling and deployment/testing instructions.
