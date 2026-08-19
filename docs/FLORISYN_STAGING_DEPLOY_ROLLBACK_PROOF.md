# Florisyn Staging Deploy and Rollback Proof

**Scope:** `florisyn-staging.netlify.app` only. Production is out of scope.

## Current bundle

- Branch: `beta/august10-stabilization`
- Staging site ID: `16699710-50a5-4307-87f4-710993dfa5de`
- Publish directory: `public`
- Functions directory: `netlify/functions`
- Required local gate before deploy:

```bash
npm test
npm run check
npm audit --omit=dev
npm run frontend:build
```

## One-deploy staging path

Use the connected Git branch so Netlify auto-publishes exactly one staging deploy:

```bash
git push origin beta/august10-stabilization
```

Do not publish file-by-file through GitHub contents APIs while Netlify auto deploy is on.

## Staging smoke proof

After Netlify finishes the auto deploy:

```bash
npm run verify:live-staging-smoke
```

This automated smoke gate verifies static security headers, function `no-store` headers, non-wildcard CORS, invalid-login failure handling, confirmation-resend handling, and secret redaction.

Manual equivalent:

```bash
BASE="https://florisyn-staging.netlify.app"
curl -fsS "$BASE/.netlify/functions/production-health"
curl -fsS "$BASE/.netlify/functions/admin-bootstrap"
curl -i -X POST "$BASE/.netlify/functions/auth-login" \
  -H "Content-Type: application/json" \
  -d '{"email":"not-a-real-user@example.invalid","password":"wrongwrong"}'
curl -i -X POST "$BASE/.netlify/functions/auth-resend-confirmation" \
  -H "Content-Type: application/json" \
  -d '{"email":"not-a-real-user@example.invalid"}'
```

Expected:

- Health endpoint returns without secrets.
- Admin bootstrap returns owner state, not setup failure.
- Invalid login fails safely and the UI points users to email confirmation recovery.
- Confirmation resend returns a generic success message unless the email provider is unavailable.

## Fast rollback

1. Netlify → `florisyn-staging` → Deploys.
2. Select the previous known-good deploy from before this bundle.
3. Publish that deploy.
4. Re-run the staging smoke proof above.
5. Do not roll back Supabase unless staging data corruption is confirmed.

## Database restore proof

For staging migration incidents:

1. Record the Supabase staging project: `sqdzaoxqlsgbphvlmfeb`.
2. Restore staging from the most recent pre-change backup or PITR timestamp.
3. Re-run the deployed app smoke proof.
4. Preserve orders, payments, customers, and audit records whenever possible.

## Rollback trigger conditions

- Auth signup/login cannot recover after confirmation resend.
- Cross-tenant access is suspected.
- Stripe refund/payment state diverges from Supabase ledger.
- Website Studio publishes unsaved or cross-shop content.
- Today dashboard fails to load.
