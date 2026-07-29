# Bloom Payments Live Wiring v1.3

Review-only SQL: `supabase/migrations/20260728_payments_live_wiring_v1_3.sql`

## Stripe metadata (payment links)

Checkout sessions created from `payment-link-public` must include:

| Key | Description |
|-----|-------------|
| `bloom_payment_link_id` | UUID of `payment_hub_payment_links` row |
| `bloom_shop_id` | Florist shop UUID |
| `bloom_order_id` | Related order UUID (optional) |
| `bloom_customer_id` | Customer UUID (optional) |
| `bloom_intended_amount_cents` | Intended charge in cents (validation aid) |

Duplicate `payment_intent_data.metadata` mirrors checkout `metadata`.

POS checkout (`create-checkout`) continues to use `bloom_order_id` + `bloom_shop_id` only.

## Stripe webhook events

Endpoint: `stripe-order-webhook` (unchanged path)

Required events (existing handler):

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

Routing:

1. If `metadata.bloom_payment_link_id` → `postStripePaymentLink`
2. Else if `metadata.bloom_order_id` + `bloom_shop_id` → `postStripePayment` (unchanged)

Signature secret: `STRIPE_ORDER_WEBHOOK_SECRET`

Idempotency: `payment_hub_webhook_idempotency` keyed by Stripe event id (`evt_…`).

## Email environment variables

| Variable | Purpose |
|----------|---------|
| `BLOOM_EMAIL_PROVIDER` | `sendgrid` or `postmark` |
| `SENDGRID_API_KEY` | SendGrid API key |
| `POSTMARK_SERVER_TOKEN` | Postmark server token |
| `BLOOM_EMAIL_FROM` | From address |
| `BLOOM_EMAIL_FROM_NAME` | From display name |
| `BLOOM_EMAIL_WEBHOOK_URL` | Optional custom email relay |

If unset: adapters return `provider_not_configured`; audits still written.

## SMS environment variables

| Variable | Purpose |
|----------|---------|
| `BLOOM_SMS_PROVIDER` | `twilio` |
| `TWILIO_ACCOUNT_SID` | Twilio account |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_FROM_NUMBER` | E.164 from number |
| `BLOOM_SMS_WEBHOOK_URL` | Optional SMS relay |

SMS requires `customers.sms_consent = true` when column exists.

## Recurring billing execution

Action: `payment-hub` POST `recurring_billing_process`

- Filters active subs due by `next_delivery_date`
- Idempotent via `run_key` = `{subscription_id}:{shop_id}:{billing_date}`
- Creates order with tax/delivery totals
- Soft inventory reservation (`metadata.reserved_qty`)
- Delivery row when address/recipient present
- Charges default saved Stripe `pm_*` when configured
- Outcomes: `succeeded`, `payment_failed`, `requires_customer_action`, `skipped`, `inventory_attention_required`, `delivery_attention_required`

## Recovery scheduling

Configured in `payment_hub_settings.recovery_config`:

```json
{"max_retries":3,"retry_delay_hours":24,"email_reminders":true,"sms_reminders":false}
```

Actions: `payment_recovery_run`, `payment_recovery_retry_now` (owner/manager).

Stops when order paid, link paid, or subscription cancelled.

## Inventory reservation

Does not decrement `quantity`; increments `metadata.reserved_qty` on inventory rows.

Shortages set `inventory_attention_required` on order metadata.

## Delivery creation

Inserts into `deliveries` when address + recipient available; otherwise `delivery_attention_required`.

## Customer portal security

- Staff preview: shop JWT + `customer_id`
- Customer access: `issue_portal_token` → `portal_token` on subsequent requests
- Tokens stored hashed in `customer_portal_access`; TTL default 72h
- Actions scoped to token’s `customer_id` only

## Production setup

1. Apply migrations in order (payment hub → experience v1.2 → live wiring v1.3).
2. Configure `STRIPE_ORDER_WEBHOOK_SECRET` and point Stripe to `stripe-order-webhook`.
3. Set email/SMS env vars as needed.
4. Run `node --test tests/*.test.js`.

## Rollback procedure

1. Disable new webhook routing (revert `stripe-order-webhook.js` deploy only if needed — order flow unchanged when metadata lacks payment link id).
2. Leave tables in place (forward-only migrations); stop calling `recurring_billing_process` cron.
3. Portal tokens expire naturally.
