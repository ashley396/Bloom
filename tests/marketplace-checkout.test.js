import test from "node:test";
import assert from "node:assert/strict";

import { handleMarketplaceCheckout } from "../netlify/functions/marketplace-checkout.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

const USER = { id: "user_1", email: "florist@example.test" };
const SHOP_ID = "buyer_shop_1";

function withEnv(vars, fn) {
  const prior = {};
  for (const [key, value] of Object.entries(vars)) {
    prior[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

function postEvent(body) {
  return { httpMethod: "POST", headers: {}, body: JSON.stringify(body) };
}

function approvedApplication(overrides = {}) {
  return { status: "approved", documents_expire_at: null, approval_expires_at: null, profile_data: {}, ...overrides };
}

function listingRow(overrides = {}) {
  return {
    id: "listing_1",
    product_name: "Dozen roses (wholesale)",
    price: 12,
    shop_id: "seller_shop_1",
    active: true,
    shops: { stripe_connect_account_id: "acct_seller_1" },
    ...overrides,
  };
}

function baseDependencies({ application = approvedApplication(), listings = [listingRow()], stripeSessions = [] } = {}) {
  const client = createFakeSupabaseClient([
    { data: application, error: null }, // marketplace_verification_applications lookup
    { data: listings, error: null }, // marketplace_listings lookup
    { data: [], error: null }, // seller profile lookup (minimum order) — no profile/minimum configured by default
    { data: [], error: null }, // pricing tier lookup (per seller) — no tiers configured by default
    { data: null, error: null }, // best-effort marketplace_wholesale_orders insert (per seller)
  ]);
  let sessionIndex = 0;
  return {
    client,
    currentUser: async () => ({ client, user: USER, shopId: SHOP_ID }),
    createStripe: () => ({
      checkout: {
        sessions: {
          create: async (params) => {
            const session = stripeSessions[sessionIndex] || { id: `cs_${sessionIndex}`, url: `https://stripe.test/session/${sessionIndex}` };
            sessionIndex += 1;
            client.calls.push({ stripeCheckoutCreate: params });
            return session;
          },
        },
      },
    }),
  };
}

test("marketplace checkout: disabled flag returns 503 before touching Stripe or the database", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x" }, async () => {
    const response = await handleMarketplaceCheckout(postEvent({ listing_id: "listing_1" }), {
      isFeatureEnabled: () => false,
    });
    assert.equal(response.statusCode, 503);
  }));

test("marketplace checkout: missing STRIPE_SECRET_KEY returns a clear 503", () =>
  withEnv({ STRIPE_SECRET_KEY: undefined }, async () => {
    const response = await handleMarketplaceCheckout(postEvent({ listing_id: "listing_1" }), {
      isFeatureEnabled: () => true,
    });
    assert.equal(response.statusCode, 503);
    assert.match(JSON.parse(response.body).error, /STRIPE_SECRET_KEY/);
  }));

test("marketplace checkout: an empty cart is rejected with 400", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x" }, async () => {
    const deps = baseDependencies();
    const response = await handleMarketplaceCheckout(postEvent({}), { ...deps, isFeatureEnabled: () => true });
    assert.equal(response.statusCode, 400);
  }));

for (const [status, reason] of [
  [undefined, "missing_application"],
  ["submitted", "not_approved"],
  ["rejected", "not_approved"],
]) {
  test(`marketplace checkout: unverified buyer (${reason}) is blocked with 403 before any Stripe call`, () =>
    withEnv({ STRIPE_SECRET_KEY: "sk_test_x" }, async () => {
      const application = status === undefined ? null : approvedApplication({ status });
      const deps = baseDependencies({ application });
      const response = await handleMarketplaceCheckout(postEvent({ listing_id: "listing_1" }), {
        ...deps,
        isFeatureEnabled: () => true,
      });
      assert.equal(response.statusCode, 403);
      const stripeCalls = deps.client.calls.filter((c) => c.stripeCheckoutCreate);
      assert.equal(stripeCalls.length, 0);
    }));
}

test("marketplace checkout: expired verification documents are blocked", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x" }, async () => {
    const application = approvedApplication({ documents_expire_at: "2000-01-01T00:00:00.000Z" });
    const deps = baseDependencies({ application });
    const response = await handleMarketplaceCheckout(postEvent({ listing_id: "listing_1" }), {
      ...deps,
      isFeatureEnabled: () => true,
    });
    assert.equal(response.statusCode, 403);
    assert.match(JSON.parse(response.body).error, /expired/i);
  }));

test("marketplace checkout: an inactive listing is rejected with 409, not silently checked out", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x" }, async () => {
    const deps = baseDependencies({ listings: [listingRow({ active: false })] });
    const response = await handleMarketplaceCheckout(postEvent({ listing_id: "listing_1" }), {
      ...deps,
      isFeatureEnabled: () => true,
    });
    assert.equal(response.statusCode, 409);
  }));

test("marketplace checkout: a seller with no Stripe Connect account is rejected with 409", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x" }, async () => {
    const deps = baseDependencies({ listings: [listingRow({ shops: { stripe_connect_account_id: null } })] });
    const response = await handleMarketplaceCheckout(postEvent({ listing_id: "listing_1" }), {
      ...deps,
      isFeatureEnabled: () => true,
    });
    assert.equal(response.statusCode, 409);
    assert.match(JSON.parse(response.body).error, /Stripe Connect/);
  }));

test("marketplace checkout: a valid single-seller cart builds one Stripe session with the platform fee and correct destination", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://florisyn-staging.netlify.app", BLOOM_MARKETPLACE_FEE_PERCENT: "5" }, async () => {
    const deps = baseDependencies({ listings: [listingRow({ price: 20 })] });
    const response = await handleMarketplaceCheckout(
      postEvent({ items: [{ listing_id: "listing_1", quantity: 3 }] }),
      { ...deps, isFeatureEnabled: () => true },
    );
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.sessions.length, 1);
    assert.equal(body.sessions[0].total, 60); // 20 * 3

    const stripeCall = deps.client.calls.find((c) => c.stripeCheckoutCreate)?.stripeCheckoutCreate;
    assert.ok(stripeCall, "expected a Stripe checkout session to be created");
    assert.equal(stripeCall.payment_intent_data.transfer_data.destination, "acct_seller_1");
    // amount = 6000 cents, 5% platform fee = 300 cents
    assert.equal(stripeCall.payment_intent_data.application_fee_amount, 300);
    assert.equal(stripeCall.line_items[0].price_data.unit_amount, 2000);
    assert.equal(stripeCall.customer_email, USER.email);
    assert.equal(stripeCall.metadata.buyer_shop_id, SHOP_ID);
  }));

test("marketplace checkout: a valid promo code discounts that seller's line items and is recorded on the session and order", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://florisyn-staging.netlify.app", BLOOM_MARKETPLACE_FEE_PERCENT: "5" }, async () => {
    const deps = baseDependencies({ listings: [listingRow({ price: 20 })] });
    // Response queue order: application, listings, seller profile (minimum order), promo lookup, tier lookup, order insert.
    const extraClient = createFakeSupabaseClient([
      { data: approvedApplication(), error: null },
      { data: [listingRow({ price: 20 })], error: null },
      { data: [], error: null },
      { data: [{ shop_id: "seller_shop_1", code: "SPRING10", percent_off: 10, active: true, starts_at: null, ends_at: null }], error: null },
      { data: [], error: null },
      { data: null, error: null },
    ]);
    const deps2 = {
      client: extraClient,
      currentUser: async () => ({ client: extraClient, user: USER, shopId: SHOP_ID }),
      createStripe: deps.createStripe,
    };
    const response = await handleMarketplaceCheckout(
      postEvent({ items: [{ listing_id: "listing_1", quantity: 2 }], promo_code: "spring10" }),
      { ...deps2, isFeatureEnabled: () => true },
    );
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.sessions[0].promo_applied, true);
    assert.equal(body.sessions[0].total, 36); // 20 * 2 = 40, 10% off = 36

    // createStripe's fake session.create() records calls onto the client it
    // closed over (deps.client, from baseDependencies), not extraClient.
    const stripeCall = deps.client.calls.find((c) => c.stripeCheckoutCreate)?.stripeCheckoutCreate;
    assert.equal(stripeCall.line_items[0].price_data.unit_amount, 1800); // $20 - 10% = $18.00 = 1800 cents
    assert.equal(stripeCall.payment_intent_data.application_fee_amount, 180); // 5% of 3600 cents
    assert.equal(stripeCall.metadata.promotion_code, "SPRING10");
    assert.equal(stripeCall.metadata.discount_percent, "10");
  }));

test("marketplace checkout: a promo code that matches no seller in the cart is rejected with 400 instead of silently charging full price", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://florisyn-staging.netlify.app" }, async () => {
    const extraClient = createFakeSupabaseClient([
      { data: approvedApplication(), error: null },
      { data: [listingRow({ price: 20 })], error: null },
      { data: [], error: null }, // seller profile lookup — no minimum configured
      { data: [], error: null }, // no promo rows match this seller
    ]);
    const response = await handleMarketplaceCheckout(
      postEvent({ items: [{ listing_id: "listing_1", quantity: 1 }], promo_code: "NOTREAL" }),
      {
        client: extraClient,
        currentUser: async () => ({ client: extraClient, user: USER, shopId: SHOP_ID }),
        createStripe: () => ({ checkout: { sessions: { create: async () => { throw new Error("must not create a Stripe session for a rejected code"); } } } }),
        isFeatureEnabled: () => true,
      },
    );
    assert.equal(response.statusCode, 400);
    assert.match(JSON.parse(response.body).error, /isn't valid for the items in your cart/);
  }));

test("marketplace checkout: an expired promo code is treated as invalid, never applied", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://florisyn-staging.netlify.app" }, async () => {
    const extraClient = createFakeSupabaseClient([
      { data: approvedApplication(), error: null },
      { data: [listingRow({ price: 20 })], error: null },
      { data: [], error: null }, // seller profile lookup — no minimum configured
      { data: [{ shop_id: "seller_shop_1", code: "OLDCODE", percent_off: 50, active: true, ends_at: "2000-01-01T00:00:00.000Z" }], error: null },
    ]);
    const response = await handleMarketplaceCheckout(
      postEvent({ items: [{ listing_id: "listing_1", quantity: 1 }], promo_code: "OLDCODE" }),
      {
        client: extraClient,
        currentUser: async () => ({ client: extraClient, user: USER, shopId: SHOP_ID }),
        createStripe: () => ({ checkout: { sessions: { create: async () => { throw new Error("must not create a Stripe session for an expired code"); } } } }),
        isFeatureEnabled: () => true,
      },
    );
    assert.equal(response.statusCode, 400);
  }));

test("marketplace checkout: no promo_code in the request never touches the promotions table and behaves exactly as before", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://florisyn-staging.netlify.app" }, async () => {
    const deps = baseDependencies({ listings: [listingRow({ price: 20 })] });
    const response = await handleMarketplaceCheckout(
      postEvent({ items: [{ listing_id: "listing_1", quantity: 1 }] }),
      { ...deps, isFeatureEnabled: () => true },
    );
    assert.equal(response.statusCode, 200);
    const promoCalls = deps.client.calls.filter((c) => c.table === "marketplace_promotions");
    assert.equal(promoCalls.length, 0);
  }));

test("marketplace checkout: a cart spanning two sellers creates one session per seller", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://florisyn-staging.netlify.app" }, async () => {
    const listings = [
      listingRow({ id: "listing_1", shop_id: "seller_a", shops: { stripe_connect_account_id: "acct_a" }, price: 10 }),
      listingRow({ id: "listing_2", shop_id: "seller_b", shops: { stripe_connect_account_id: "acct_b" }, price: 15 }),
    ];
    const deps = baseDependencies({ listings });
    const response = await handleMarketplaceCheckout(
      postEvent({
        items: [
          { listing_id: "listing_1", quantity: 1 },
          { listing_id: "listing_2", quantity: 1 },
        ],
      }),
      { ...deps, isFeatureEnabled: () => true },
    );
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.sessions.length, 2);
    assert.ok(body.message);
    const destinations = deps.client.calls
      .filter((c) => c.stripeCheckoutCreate)
      .map((c) => c.stripeCheckoutCreate.payment_intent_data.transfer_data.destination)
      .sort();
    assert.deepEqual(destinations, ["acct_a", "acct_b"]);
  }));

// MARKETPLACE VOLUME PRICING: marketplace_pricing_tiers has existed since
// the greenfield baseline and the seller dashboard's Pricing tab has
// always let a seller create real tiers, but checkout never read one back
// until now — a buyer ordering any quantity always paid full listing
// price. These tests prove the tier lookup is actually wired in, applies
// the correct (highest-threshold-met) tier, and never stacks with a promo
// code.

test("marketplace checkout: a cart quantity crossing a seller's pricing tier threshold is discounted", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://florisyn-staging.netlify.app", BLOOM_MARKETPLACE_FEE_PERCENT: "5" }, async () => {
    // Response queue order: application, listings, seller profile (minimum
    // order), tier lookup, order insert. No promo_code in the request, so
    // the promotions table is never touched.
    const extraClient = createFakeSupabaseClient([
      { data: approvedApplication(), error: null },
      { data: [listingRow({ price: 20 })], error: null },
      { data: [], error: null },
      { data: [{ id: "tier_1", name: "Volume florist", min_quantity: 10, discount_percent: 15, active: true }], error: null },
      { data: null, error: null },
    ]);
    const stripeSessions = [];
    let sessionIndex = 0;
    const response = await handleMarketplaceCheckout(
      postEvent({ items: [{ listing_id: "listing_1", quantity: 10 }] }),
      {
        client: extraClient,
        currentUser: async () => ({ client: extraClient, user: USER, shopId: SHOP_ID }),
        createStripe: () => ({
          checkout: {
            sessions: {
              create: async (params) => {
                const session = stripeSessions[sessionIndex] || { id: `cs_${sessionIndex}`, url: `https://stripe.test/session/${sessionIndex}` };
                sessionIndex += 1;
                extraClient.calls.push({ stripeCheckoutCreate: params });
                return session;
              },
            },
          },
        }),
        isFeatureEnabled: () => true,
      },
    );
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.sessions[0].pricing_tier_applied, "Volume florist");
    assert.equal(body.sessions[0].total, 170); // 20 * 10 = 200, 15% off = 170

    const stripeCall = extraClient.calls.find((c) => c.stripeCheckoutCreate)?.stripeCheckoutCreate;
    assert.equal(stripeCall.line_items[0].price_data.unit_amount, 1700); // $20 - 15% = $17.00
    assert.equal(stripeCall.metadata.pricing_tier, "Volume florist");
    assert.equal(stripeCall.metadata.pricing_tier_min_quantity, "10");
    assert.equal(stripeCall.metadata.discount_percent, "15");
    assert.equal(stripeCall.metadata.promotion_code, undefined);
  }));

test("marketplace checkout: a cart quantity below every tier's threshold pays full price", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://florisyn-staging.netlify.app" }, async () => {
    const extraClient = createFakeSupabaseClient([
      { data: approvedApplication(), error: null },
      { data: [listingRow({ price: 20 })], error: null },
      { data: [], error: null },
      { data: [{ id: "tier_1", name: "Volume florist", min_quantity: 50, discount_percent: 15, active: true }], error: null },
      { data: null, error: null },
    ]);
    const response = await handleMarketplaceCheckout(
      postEvent({ items: [{ listing_id: "listing_1", quantity: 5 }] }),
      {
        client: extraClient,
        currentUser: async () => ({ client: extraClient, user: USER, shopId: SHOP_ID }),
        createStripe: () => ({ checkout: { sessions: { create: async (params) => { extraClient.calls.push({ stripeCheckoutCreate: params }); return { id: "cs_0", url: "https://stripe.test/session/0" }; } } } }),
        isFeatureEnabled: () => true,
      },
    );
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.sessions[0].pricing_tier_applied, null);
    assert.equal(body.sessions[0].total, 100); // 20 * 5, no discount

    const stripeCall = extraClient.calls.find((c) => c.stripeCheckoutCreate)?.stripeCheckoutCreate;
    assert.equal(stripeCall.line_items[0].price_data.unit_amount, 2000);
    assert.equal(stripeCall.metadata.discount_percent, undefined);
    assert.equal(stripeCall.metadata.pricing_tier, undefined);
  }));

test("marketplace checkout: a pricing tier and a promo code never stack — the buyer gets whichever discount is larger", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://florisyn-staging.netlify.app" }, async () => {
    // Tier (20%) beats the promo (10%): the tier should win, and the
    // promo's own 10% must never be added on top of it.
    const extraClient = createFakeSupabaseClient([
      { data: approvedApplication(), error: null },
      { data: [listingRow({ price: 10 })], error: null },
      { data: [], error: null },
      { data: [{ shop_id: "seller_shop_1", code: "SPRING10", percent_off: 10, active: true, starts_at: null, ends_at: null }], error: null },
      { data: [{ id: "tier_1", name: "Big volume", min_quantity: 10, discount_percent: 20, active: true }], error: null },
      { data: null, error: null },
    ]);
    const response = await handleMarketplaceCheckout(
      postEvent({ items: [{ listing_id: "listing_1", quantity: 10 }], promo_code: "spring10" }),
      {
        client: extraClient,
        currentUser: async () => ({ client: extraClient, user: USER, shopId: SHOP_ID }),
        createStripe: () => ({ checkout: { sessions: { create: async (params) => { extraClient.calls.push({ stripeCheckoutCreate: params }); return { id: "cs_0", url: "https://stripe.test/session/0" }; } } } }),
        isFeatureEnabled: () => true,
      },
    );
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    // 10 * 10 = 100, 20% off (the tier, not the promo) = 80 — never 100 * (1 - 0.30) = 70.
    assert.equal(body.sessions[0].total, 80);
    assert.equal(body.sessions[0].pricing_tier_applied, "Big volume");
    assert.equal(body.sessions[0].promo_applied, false);

    const stripeCall = extraClient.calls.find((c) => c.stripeCheckoutCreate)?.stripeCheckoutCreate;
    assert.equal(stripeCall.metadata.discount_percent, "20");
    assert.equal(stripeCall.metadata.pricing_tier, "Big volume");
    assert.equal(stripeCall.metadata.promotion_code, undefined);
  }));

test("marketplace checkout: when the promo code beats the tier, the promo wins and the tier is never applied", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://florisyn-staging.netlify.app" }, async () => {
    const extraClient = createFakeSupabaseClient([
      { data: approvedApplication(), error: null },
      { data: [listingRow({ price: 10 })], error: null },
      { data: [], error: null },
      { data: [{ shop_id: "seller_shop_1", code: "BIGSALE", percent_off: 30, active: true, starts_at: null, ends_at: null }], error: null },
      { data: [{ id: "tier_1", name: "Small volume", min_quantity: 10, discount_percent: 5, active: true }], error: null },
      { data: null, error: null },
    ]);
    const response = await handleMarketplaceCheckout(
      postEvent({ items: [{ listing_id: "listing_1", quantity: 10 }], promo_code: "bigsale" }),
      {
        client: extraClient,
        currentUser: async () => ({ client: extraClient, user: USER, shopId: SHOP_ID }),
        createStripe: () => ({ checkout: { sessions: { create: async (params) => { extraClient.calls.push({ stripeCheckoutCreate: params }); return { id: "cs_0", url: "https://stripe.test/session/0" }; } } } }),
        isFeatureEnabled: () => true,
      },
    );
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    // 10 * 10 = 100, 30% off (the promo, not the tier) = 70.
    assert.equal(body.sessions[0].total, 70);
    assert.equal(body.sessions[0].promo_applied, true);
    assert.equal(body.sessions[0].pricing_tier_applied, null);

    const stripeCall = extraClient.calls.find((c) => c.stripeCheckoutCreate)?.stripeCheckoutCreate;
    assert.equal(stripeCall.metadata.discount_percent, "30");
    assert.equal(stripeCall.metadata.promotion_code, "BIGSALE");
    assert.equal(stripeCall.metadata.pricing_tier, undefined);
  }));

// MINIMUM ORDER AMOUNT: a seller's storefront profile has always let them
// set and display a minimum order ($) — shown to buyers on the storefront
// detail panel since the storefront-enrichment phase — but checkout never
// enforced it. These tests prove the check is actually wired in, blocks
// checkout entirely (no Stripe session at all) when a seller's minimum
// isn't met, and is evaluated against the pre-discount subtotal so a
// promo/tier discount can never be used to slip an order under it.

test("marketplace checkout: a cart below a seller's minimum order amount is rejected with 409 before any Stripe session is created", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://florisyn-staging.netlify.app" }, async () => {
    // Response queue order: application, listings, seller profile (minimum order).
    const extraClient = createFakeSupabaseClient([
      { data: approvedApplication(), error: null },
      { data: [listingRow({ price: 20 })], error: null },
      { data: [{ shop_id: "seller_shop_1", display_name: "Rose Co", minimum_order_amount: 150 }], error: null },
    ]);
    const response = await handleMarketplaceCheckout(
      postEvent({ items: [{ listing_id: "listing_1", quantity: 1 }] }), // $20, well under the $150 minimum
      {
        client: extraClient,
        currentUser: async () => ({ client: extraClient, user: USER, shopId: SHOP_ID }),
        createStripe: () => ({ checkout: { sessions: { create: async () => { throw new Error("must not create a Stripe session below the seller's minimum order"); } } } }),
        isFeatureEnabled: () => true,
      },
    );
    assert.equal(response.statusCode, 409);
    const body = JSON.parse(response.body);
    assert.match(body.error, /Rose Co/);
    assert.match(body.error, /minimum order of 150\.00/);
    assert.equal(body.items[0].seller_shop_id, "seller_shop_1");
    assert.equal(body.items[0].minimum, 150);
    assert.equal(body.items[0].subtotal, 20);
  }));

test("marketplace checkout: a cart at or above a seller's minimum order amount checks out normally", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://florisyn-staging.netlify.app" }, async () => {
    const extraClient = createFakeSupabaseClient([
      { data: approvedApplication(), error: null },
      { data: [listingRow({ price: 20 })], error: null },
      { data: [{ shop_id: "seller_shop_1", display_name: "Rose Co", minimum_order_amount: 150 }], error: null },
      { data: [], error: null }, // tier lookup
      { data: null, error: null }, // order insert
    ]);
    const response = await handleMarketplaceCheckout(
      postEvent({ items: [{ listing_id: "listing_1", quantity: 10 }] }), // $200, above the $150 minimum
      {
        client: extraClient,
        currentUser: async () => ({ client: extraClient, user: USER, shopId: SHOP_ID }),
        createStripe: () => ({ checkout: { sessions: { create: async (params) => { extraClient.calls.push({ stripeCheckoutCreate: params }); return { id: "cs_0", url: "https://stripe.test/session/0" }; } } } }),
        isFeatureEnabled: () => true,
      },
    );
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).sessions[0].total, 200);
  }));

test("marketplace checkout: a promo/tier discount can never be used to slip an order under a seller's minimum — the minimum is checked pre-discount", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://florisyn-staging.netlify.app" }, async () => {
    // $200 subtotal meets the $150 minimum, but a 50% promo would bring
    // the actual charge down to $100 — still checks out, because the
    // minimum is evaluated against the cart's real subtotal, not the
    // post-discount amount.
    const extraClient = createFakeSupabaseClient([
      { data: approvedApplication(), error: null },
      { data: [listingRow({ price: 20 })], error: null },
      { data: [{ shop_id: "seller_shop_1", display_name: "Rose Co", minimum_order_amount: 150 }], error: null },
      { data: [{ shop_id: "seller_shop_1", code: "HALFOFF", percent_off: 50, active: true, starts_at: null, ends_at: null }], error: null },
      { data: [], error: null }, // tier lookup
      { data: null, error: null }, // order insert
    ]);
    const response = await handleMarketplaceCheckout(
      postEvent({ items: [{ listing_id: "listing_1", quantity: 10 }], promo_code: "halfoff" }),
      {
        client: extraClient,
        currentUser: async () => ({ client: extraClient, user: USER, shopId: SHOP_ID }),
        createStripe: () => ({ checkout: { sessions: { create: async (params) => { extraClient.calls.push({ stripeCheckoutCreate: params }); return { id: "cs_0", url: "https://stripe.test/session/0" }; } } } }),
        isFeatureEnabled: () => true,
      },
    );
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).sessions[0].total, 100); // $200 - 50% = $100, below the $150 minimum, but the gate already passed on the $200 subtotal
  }));

test("marketplace checkout: a seller with no minimum_order_amount configured never blocks checkout", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://florisyn-staging.netlify.app" }, async () => {
    const extraClient = createFakeSupabaseClient([
      { data: approvedApplication(), error: null },
      { data: [listingRow({ price: 1 })], error: null },
      { data: [{ shop_id: "seller_shop_1", display_name: "Rose Co", minimum_order_amount: 0 }], error: null },
      { data: [], error: null }, // tier lookup
      { data: null, error: null }, // order insert
    ]);
    const response = await handleMarketplaceCheckout(
      postEvent({ items: [{ listing_id: "listing_1", quantity: 1 }] }),
      {
        client: extraClient,
        currentUser: async () => ({ client: extraClient, user: USER, shopId: SHOP_ID }),
        createStripe: () => ({ checkout: { sessions: { create: async (params) => { extraClient.calls.push({ stripeCheckoutCreate: params }); return { id: "cs_0", url: "https://stripe.test/session/0" }; } } } }),
        isFeatureEnabled: () => true,
      },
    );
    assert.equal(response.statusCode, 200);
  }));

// MARKETPLACE SHIPPING: marketplace_seller_profiles has always let a
// seller mark pickup_available — but nothing ever charged for shipping
// as the alternative. These tests prove a ship-only seller's flat fee is
// actually charged (as its own visible Stripe line item, excluded from
// the platform's application fee), a seller who also offers pickup is
// never charged (the cart can't yet say which the buyer wants), and a
// free-shipping threshold waives the fee once met.

test("marketplace checkout: a ship-only seller's flat fee is charged as its own Stripe line item, excluded from the platform fee", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://florisyn-staging.netlify.app", BLOOM_MARKETPLACE_FEE_PERCENT: "5" }, async () => {
    const extraClient = createFakeSupabaseClient([
      { data: approvedApplication(), error: null },
      { data: [listingRow({ price: 20 })], error: null },
      { data: [{ shop_id: "seller_shop_1", display_name: "Rose Co", pickup_available: false, shipping_flat_fee: 12, free_shipping_over: null }], error: null },
      { data: [], error: null }, // tier lookup
      { data: null, error: null }, // order insert
    ]);
    const response = await handleMarketplaceCheckout(
      postEvent({ items: [{ listing_id: "listing_1", quantity: 2 }] }), // $40 merchandise + $12 shipping
      {
        client: extraClient,
        currentUser: async () => ({ client: extraClient, user: USER, shopId: SHOP_ID }),
        createStripe: () => ({ checkout: { sessions: { create: async (params) => { extraClient.calls.push({ stripeCheckoutCreate: params }); return { id: "cs_0", url: "https://stripe.test/session/0" }; } } } }),
        isFeatureEnabled: () => true,
      },
    );
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.sessions[0].shipping_fee, 12);
    assert.equal(body.sessions[0].total, 52); // $40 merchandise + $12 shipping

    const stripeCall = extraClient.calls.find((c) => c.stripeCheckoutCreate)?.stripeCheckoutCreate;
    assert.equal(stripeCall.line_items.length, 2);
    assert.equal(stripeCall.line_items[0].price_data.unit_amount, 2000); // merchandise unchanged
    assert.equal(stripeCall.line_items[1].price_data.product_data.name, "Shipping");
    assert.equal(stripeCall.line_items[1].price_data.unit_amount, 1200);
    // Platform fee is 5% of the $40 merchandise only (2000 cents), not the
    // $52 total — shipping is a pass-through cost, not marketplace revenue.
    assert.equal(stripeCall.payment_intent_data.application_fee_amount, 200);
    assert.equal(stripeCall.metadata.shipping_fee, "12");
  }));

test("marketplace checkout: a seller who offers pickup is never charged shipping, even with a flat fee configured", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://florisyn-staging.netlify.app" }, async () => {
    const extraClient = createFakeSupabaseClient([
      { data: approvedApplication(), error: null },
      { data: [listingRow({ price: 20 })], error: null },
      { data: [{ shop_id: "seller_shop_1", display_name: "Rose Co", pickup_available: true, shipping_flat_fee: 12, free_shipping_over: null }], error: null },
      { data: [], error: null }, // tier lookup
      { data: null, error: null }, // order insert
    ]);
    const response = await handleMarketplaceCheckout(
      postEvent({ items: [{ listing_id: "listing_1", quantity: 2 }] }),
      {
        client: extraClient,
        currentUser: async () => ({ client: extraClient, user: USER, shopId: SHOP_ID }),
        createStripe: () => ({ checkout: { sessions: { create: async (params) => { extraClient.calls.push({ stripeCheckoutCreate: params }); return { id: "cs_0", url: "https://stripe.test/session/0" }; } } } }),
        isFeatureEnabled: () => true,
      },
    );
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.sessions[0].shipping_fee, 0);
    assert.equal(body.sessions[0].total, 40); // no shipping added

    const stripeCall = extraClient.calls.find((c) => c.stripeCheckoutCreate)?.stripeCheckoutCreate;
    assert.equal(stripeCall.line_items.length, 1);
  }));

test("marketplace checkout: a free-shipping threshold waives a ship-only seller's fee once the subtotal meets it", () =>
  withEnv({ STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://florisyn-staging.netlify.app" }, async () => {
    const extraClient = createFakeSupabaseClient([
      { data: approvedApplication(), error: null },
      { data: [listingRow({ price: 20 })], error: null },
      { data: [{ shop_id: "seller_shop_1", display_name: "Rose Co", pickup_available: false, shipping_flat_fee: 12, free_shipping_over: 100 }], error: null },
      { data: [], error: null }, // tier lookup
      { data: null, error: null }, // order insert
    ]);
    const response = await handleMarketplaceCheckout(
      postEvent({ items: [{ listing_id: "listing_1", quantity: 10 }] }), // $200 subtotal, over the $100 free-shipping threshold
      {
        client: extraClient,
        currentUser: async () => ({ client: extraClient, user: USER, shopId: SHOP_ID }),
        createStripe: () => ({ checkout: { sessions: { create: async (params) => { extraClient.calls.push({ stripeCheckoutCreate: params }); return { id: "cs_0", url: "https://stripe.test/session/0" }; } } } }),
        isFeatureEnabled: () => true,
      },
    );
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.sessions[0].shipping_fee, 0);
    assert.equal(body.sessions[0].total, 200); // no shipping added — subtotal already meets the threshold
  }));
