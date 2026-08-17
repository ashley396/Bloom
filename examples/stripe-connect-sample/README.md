# Stripe Connect sample

A small, standalone Express app showing a full Stripe Connect marketplace
flow end to end: onboard sellers, create products, run a storefront, and
split each sale between the platform and the seller. It's a copy-paste
reference, not wired into any other app in this repo — nothing here shares
code or credentials with the main Florisyn application.

## What's included

| Route | What it demonstrates |
|---|---|
| `GET /onboard` | Start or resume Connect onboarding for a demo seller |
| `POST /onboard/start` | Create a connected account (Accounts v2) + first onboarding link |
| `POST /onboard/continue/:accountId` | Mint a fresh onboarding link (links are single-use) |
| `GET /onboard/status/:accountId` | Read a connected account's live status straight from the API |
| `GET /admin/products` · `POST /admin/products` | Create a platform-level product tied to a seller |
| `GET /` | Storefront listing every product from every onboarded seller |
| `POST /checkout/:productId` | Stripe Checkout with a destination charge + application fee |
| `GET /success` | Confirms the charge and shows the platform/seller split |
| `POST /webhook` | Verifies and handles thin-event Connect account webhooks |

## Setup

```bash
cd examples/stripe-connect-sample
cp .env.example .env      # then edit .env — see below
npm install
npm start                 # http://localhost:4242
```

`.env` needs, at minimum:

- **`STRIPE_SECRET_KEY`** — a *test mode* secret key from
  https://dashboard.stripe.com/test/apikeys. The app throws a clear error
  and refuses to start without a real value here (see `src/stripeClient.js`).

Everything else in `.env.example` has a working default, except:

- **`STRIPE_WEBHOOK_SECRET`** — only needed if you want to exercise the
  `/webhook` route. Easiest way locally, with the [Stripe CLI](https://docs.stripe.com/cli):

  ```bash
  stripe listen --thin-events \
    "v2.core.account[requirements].updated,v2.core.account[configuration.recipient].capability_status_updated" \
    --forward-thin-to http://localhost:4242/webhook
  ```

  Paste the `whsec_...` it prints into `.env`. In production, create the
  event destination in the Dashboard instead: **Developers → Webhooks →
  + Add destination → Events from: Connected accounts → Show advanced
  options → Payload style: Thin** — then select those same two event
  types (search "v2" in the event picker).

## Walking through it

1. Visit `/onboard`, pick a demo seller, click **Onboard to collect
   payments**. You'll land on Stripe-hosted onboarding (Express Dashboard).
   Use [Stripe's test onboarding data](https://docs.stripe.com/connect/testing)
   to get through it quickly in test mode.
2. You're redirected back to `/onboard/status/:accountId`, which asks the
   Stripe API — live, not from any local cache — whether that account can
   receive payments yet.
3. Once a seller is ready, go to `/admin/products` and create a product for
   them. Products are created at the **platform** level; each one is tagged
   with `metadata.connected_account_id` so the storefront and checkout know
   who fulfills it.
4. The storefront at `/` lists every product from every seller. Buying one
   creates a Stripe Checkout Session configured as a **destination
   charge**: the customer pays this platform, Stripe deducts the platform's
   `application_fee_amount`, and transfers the remainder straight to the
   seller's connected account — one API call does the charge and the split.

## Notes on what's simplified for a demo

- **Storage is in-memory** (`src/store.js`) — restarting the server forgets
  which demo user maps to which Stripe account. Swap `store.js` for real
  persistence before shipping this; the mapping itself (user → Stripe
  account ID) is exactly the kind of thing a `users`/`sellers` table
  should hold. (The main Florisyn app already does this for its own
  shops — see `shops.stripe_connect_account_id` and
  `netlify/functions/stripe-connect.js` — as one example of the pattern.)
- **Onboarding *status*, unlike the account ID, is never cached** — every
  status check calls the Stripe API directly, since requirements can
  change on Stripe's side at any time.
- **Two demo sellers, no real auth.** `POST /onboard/start` takes a
  `userId` for a fixed demo user rather than a logged-in session; swap in
  your real current-user lookup.
- **The webhook handler only logs.** In a real app, use the requirements/
  capability-status change to notify the affected seller (email, in-app
  banner, etc.) rather than making them keep refreshing `/onboard/status`.
