// ============================================================================
// Stripe Connect sample — onboarding, product creation, a storefront, and
// destination-charge checkout, end to end.
//
// Run it:
//   1. cp .env.example .env   (then fill in STRIPE_SECRET_KEY at minimum)
//   2. npm install
//   3. npm start
//   4. open http://localhost:4242
//
// Everything below is one file on purpose — the point of this sample is to
// read top-to-bottom as "here's every step of a Connect integration," not to
// demonstrate how to structure a larger app. Each numbered section maps to
// one part of a real Connect integration; copy whichever section you need.
// ============================================================================

import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stripeClient } from "./stripeClient.js";
import { users, productAccountMap } from "./store.js";
import {
  renderStorefront,
  renderOnboardIndex,
  renderOnboardStatus,
  renderAdminProducts,
  renderSuccess,
  renderError,
} from "./views.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 4242);
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const PLATFORM_FEE_BPS = Number(process.env.PLATFORM_FEE_BPS || 1000); // 1000 bps = 10%
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));

// Small helpers used by more than one route.
const dollarsToCents = (value) => {
  const cents = Math.round(Number(value) * 100);
  if (!Number.isFinite(cents) || cents < 50) {
    // Stripe rejects charges below $0.50 USD outright — failing here with
    // a plain-English reason beats letting Stripe's error surface raw.
    throw Object.assign(new Error("Price must be at least $0.50."), { statusCode: 400 });
  }
  return cents;
};
const applicationFeeFor = (amountInCents) => Math.round((amountInCents * PLATFORM_FEE_BPS) / 10000);

// Express 5 forwards a rejected promise from an async route handler to the
// error middleware at the bottom of this file automatically — no
// try/catch-and-next() boilerplate needed around every route below.

// ============================================================================
// 1. Onboarding connected accounts
//
//    Every seller on this platform is its own Stripe *connected account*.
//    Two steps: create the account (once), then send the seller through
//    Stripe-hosted onboarding (Account Links) to collect the identity/bank
//    info Stripe needs before that account can receive money.
// ============================================================================

app.get("/onboard", (req, res) => {
  res.send(
    renderOnboardIndex({
      users: [...users.values()],
      flash: req.query.flash,
    })
  );
});

app.post("/onboard/start", express.urlencoded({ extended: true }), async (req, res) => {
  const user = users.get(req.body.userId);
  if (!user) return res.status(404).send(renderError(404, "Unknown demo user."));

  // --- Create the connected account (Accounts v2) ---------------------
  //
  // This uses the V2 Core Accounts API, not the older `type: "express"`
  // V1 shape. Every property here is deliberate:
  //   - dashboard: "express"            → the seller manages payouts etc.
  //                                        through Stripe's own hosted,
  //                                        platform-branded dashboard.
  //   - defaults.responsibilities       → THIS platform is on the hook for
  //                                        collecting Stripe's fees and for
  //                                        absorbing losses/disputes, not
  //                                        the connected account itself —
  //                                        that's what makes this a
  //                                        "destination charge" setup
  //                                        rather than a direct-charge one.
  //   - configuration.recipient         → this account's job is to
  //                                        *receive* money (a payout
  //                                        destination), requested via the
  //                                        stripe_balance/stripe_transfers
  //                                        capability below.
  const account = await stripeClient.v2.core.accounts.create({
    display_name: user.name,
    contact_email: user.email,
    identity: {
      country: "us",
    },
    dashboard: "express",
    defaults: {
      responsibilities: {
        fees_collector: "application",
        losses_collector: "application",
      },
    },
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: {
              requested: true,
            },
          },
        },
      },
    },
  });

  // Persist the mapping from our user to their new Stripe account. (Only
  // the *account ID* is stored — never onboarding status; see the status
  // route below for why.)
  user.accountId = account.id;

  // --- Send the seller through Stripe-hosted onboarding ----------------
  const accountLink = await createOnboardingLink(account.id);
  res.redirect(303, accountLink.url);
});

app.post("/onboard/continue/:accountId", async (req, res) => {
  // Account Links are single-use and expire quickly, so "continue
  // onboarding" always mints a brand new one rather than reusing the
  // original — this route is identical whether it's someone's first visit
  // back after a refresh, or their fifth.
  const accountLink = await createOnboardingLink(req.params.accountId);
  res.redirect(303, accountLink.url);
});

async function createOnboardingLink(accountId) {
  return stripeClient.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        // Must match the capability configuration requested when the
        // account was created above.
        configurations: ["recipient"],
        refresh_url: `${APP_URL}/onboard`,
        return_url: `${APP_URL}/onboard/status/${accountId}`,
      },
    },
  });
}

app.get("/onboard/status/:accountId", async (req, res) => {
  const { accountId } = req.params;

  // --- Always ask Stripe for onboarding status, live -------------------
  //
  // Requirements can change on Stripe's side at any time — new regulatory
  // information requested, a capability re-verified, etc. — so this
  // sample deliberately never caches "is onboarding done?" anywhere; it
  // asks the API on every page view instead. (The webhook section below
  // is for *reacting* to those changes, e.g. to notify someone — it's
  // still not a substitute for checking live status before acting on it.)
  const account = await stripeClient.v2.core.accounts.retrieve(accountId, {
    include: ["configuration.recipient", "requirements"],
  });

  const readyToReceivePayments =
    account?.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active";

  const requirementsStatus = account.requirements?.summary?.minimum_deadline?.status;
  const onboardingComplete = requirementsStatus !== "currently_due" && requirementsStatus !== "past_due";

  // requirements.entries' exact shape can evolve since Accounts v2 is a
  // newer API surface — read defensively and fall back to empty lists
  // rather than let an unexpected shape crash this page. Check
  // https://docs.stripe.com/api/v2/core/accounts/object for the current
  // schema if these ever come back empty when you expect otherwise.
  const entries = account.requirements?.entries || [];
  const currentlyDue = entries.filter((e) => e.status === "currently_due").map((e) => e.requirement);
  const pastDue = entries.filter((e) => e.status === "past_due").map((e) => e.requirement);

  const user = [...users.values()].find((u) => u.accountId === accountId);

  res.send(
    renderOnboardStatus({
      accountId,
      displayName: user?.name || account.display_name,
      onboardingComplete,
      readyToReceivePayments,
      currentlyDue,
      pastDue,
      flash: req.query.flash,
    })
  );
});

// ============================================================================
// 2. Listening for requirements changes (thin-event webhooks)
//
//    Account v2 only emits "thin" events: a small envelope with just the
//    event id and type, verified by signature — you then fetch the full
//    event body yourself in a second call. Configure a webhook destination
//    for this in the Dashboard (Developers → Webhooks → + Add destination
//    → Connected accounts → Show advanced options → Payload style: Thin),
//    or point the Stripe CLI at this route while developing locally:
//
//      stripe listen --thin-events \
//        "v2.core.account[requirements].updated,v2.core.account[configuration.recipient].capability_status_updated" \
//        --forward-thin-to http://localhost:4242/webhook
// ============================================================================

app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!STRIPE_WEBHOOK_SECRET || STRIPE_WEBHOOK_SECRET.includes("REPLACE_ME")) {
    return res
      .status(500)
      .send(
        "STRIPE_WEBHOOK_SECRET is not set. Copy .env.example to .env, run the `stripe listen` command above (or create a Dashboard webhook destination), and paste the whsec_... value it gives you."
      );
  }

  const signature = req.headers["stripe-signature"];
  let thinEvent;
  try {
    // Verifies the signature and hands back the small envelope — NOT the
    // full event payload. Thin events exist so a slow "go fetch the full
    // body" step never blocks signature verification, and so handlers
    // always act on freshly-fetched data instead of a payload that could
    // have been queued/delayed.
    thinEvent = stripeClient.parseThinEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Now fetch the full event body, now that we know it's genuinely from
  // Stripe.
  const event = await stripeClient.v2.core.events.retrieve(thinEvent.id);

  switch (event.type) {
    case "v2.core.account[requirements].updated": {
      const accountId = event.related_object?.id;
      console.log(
        `[webhook] requirements updated for account ${accountId} — re-fetch GET /onboard/status/${accountId} to see what's newly due.`
      );
      // A real app: look up which user owns this accountId and surface a
      // "please finish onboarding" prompt (email, in-app banner, etc.).
      break;
    }
    case "v2.core.account[configuration.recipient].capability_status_updated": {
      const accountId = event.related_object?.id;
      console.log(`[webhook] recipient capability status changed for account ${accountId}.`);
      // A real app: if this just flipped to "active", this is a good
      // moment to notify the seller they can start selling.
      break;
    }
    default:
      console.log(`[webhook] Unhandled event type: ${event.type}`);
  }

  // Respond quickly — Stripe retries on non-2xx/timeout, and this handler
  // has already done the one thing that needs to happen synchronously
  // (verify the signature).
  res.json({ received: true });
});

// ============================================================================
// 3. Creating products
//
//    Products live at the PLATFORM level, not on the connected account —
//    this platform owns pricing/catalog, and tags each product with which
//    seller fulfills it via metadata.
// ============================================================================

app.get("/admin/products", async (req, res) => {
  // Only offer sellers who have actually finished onboarding — creating a
  // product for an account that can't yet receive transfers would just
  // produce a broken "Buy" button on the storefront.
  const onboardedUsers = [...users.values()].filter((u) => u.accountId);
  const readyAccounts = [];
  for (const user of onboardedUsers) {
    const account = await stripeClient.v2.core.accounts.retrieve(user.accountId, {
      include: ["configuration.recipient"],
    });
    const ready = account?.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active";
    if (ready) readyAccounts.push({ accountId: user.accountId, name: user.name });
  }

  const products = await listAllProducts();

  res.send(renderAdminProducts({ readyAccounts, products, flash: req.query.flash }));
});

app.post("/admin/products", express.urlencoded({ extended: true }), async (req, res) => {
  const { accountId, name, description, price } = req.body;
  if (!accountId || !name || !price) {
    return res.status(400).send(renderError(400, "Seller, name, and price are all required."));
  }
  const unitAmount = dollarsToCents(price);

  // --- Create the product at the platform level -------------------------
  const product = await stripeClient.products.create({
    name,
    description: description || undefined,
    default_price_data: {
      unit_amount: unitAmount,
      currency: "usd",
    },
    // The metadata mapping is the source of truth for "who fulfills this
    // product" — it survives a server restart even though the in-memory
    // map below does not.
    metadata: {
      connected_account_id: accountId,
    },
  });

  // Local cache alongside the metadata (see store.js for why both exist).
  productAccountMap.set(product.id, accountId);

  res.redirect(303, "/admin/products?flash=" + encodeURIComponent(`Created "${name}".`));
});

// ============================================================================
// 4. Displaying products (the storefront)
// ============================================================================

async function listAllProducts() {
  const list = await stripeClient.products.list({ active: true, expand: ["data.default_price"] });
  return list.data
    .filter((p) => p.default_price && typeof p.default_price === "object")
    .map((p) => {
      const connectedAccountId = p.metadata?.connected_account_id || productAccountMap.get(p.id) || null;
      const seller = [...users.values()].find((u) => u.accountId === connectedAccountId);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        priceAmount: p.default_price.unit_amount,
        priceCurrency: p.default_price.currency,
        connectedAccountId,
        sellerLabel: seller ? seller.name : connectedAccountId || "unknown seller",
      };
    });
}

app.get("/", async (req, res) => {
  const products = await listAllProducts();
  res.send(renderStorefront({ products, flash: req.query.flash }));
});

// ============================================================================
// 5. Processing charges — a destination charge with an application fee
//
//    The customer pays THIS platform (via Stripe-hosted Checkout). Stripe
//    then automatically transfers the seller's share to their connected
//    account, and this platform keeps `application_fee_amount` as revenue.
//    One Checkout Session call does both the charge and the split.
// ============================================================================

app.post("/checkout/:productId", async (req, res) => {
  const product = await stripeClient.products.retrieve(req.params.productId, { expand: ["default_price"] });
  const connectedAccountId = product.metadata?.connected_account_id || productAccountMap.get(product.id);
  if (!connectedAccountId) {
    return res.status(409).send(renderError(409, "This product has no seller account on file — recreate it from /admin/products."));
  }

  const unitAmount = product.default_price.unit_amount;
  const currency = product.default_price.currency;
  const applicationFeeAmount = applicationFeeFor(unitAmount);

  const session = await stripeClient.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        // Built inline from the product's own stored price rather than
        // referencing `product.default_price.id` directly — either works;
        // this makes the amount actually being charged explicit right
        // here at checkout time.
        price_data: {
          currency,
          unit_amount: unitAmount,
          product_data: {
            name: product.name,
            description: product.description || undefined,
          },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      // This platform's cut of the sale. Stripe deducts it from the
      // total and credits it to this platform's own balance.
      application_fee_amount: applicationFeeAmount,
      // The REST of the charge — total minus the application fee — is
      // transferred straight to the seller's connected account. This is
      // what makes it a "destination charge": the charge is created here,
      // on the platform, but its destination is the seller.
      transfer_data: {
        destination: connectedAccountId,
      },
    },
    success_url: `${APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/?flash=${encodeURIComponent("Checkout cancelled.")}`,
  });

  res.redirect(303, session.url);
});

app.get("/success", async (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) return res.redirect(303, "/");

  const session = await stripeClient.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
  const paymentIntent = session.payment_intent;

  res.send(
    renderSuccess({
      amountTotal: session.amount_total,
      currency: session.currency,
      sellerAccountId: paymentIntent?.transfer_data?.destination,
      applicationFeeAmount: paymentIntent?.application_fee_amount,
    })
  );
});

// ============================================================================
// Error handling — last, so it catches anything thrown/rejected above,
// including Stripe API errors (Express 5 forwards rejected async handlers
// here automatically).
// ============================================================================
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.statusCode || err.httpStatus || 500;
  res.status(status).send(renderError(status, err.message || "Unexpected error."));
});

app.listen(PORT, () => {
  console.log(`Stripe Connect sample running at ${APP_URL}`);
  console.log(`  Storefront:       ${APP_URL}/`);
  console.log(`  Onboard sellers:  ${APP_URL}/onboard`);
  console.log(`  Create products:  ${APP_URL}/admin/products`);
});
