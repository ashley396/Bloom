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
    // Response queue order: application, listings, promo lookup, order insert.
    const extraClient = createFakeSupabaseClient([
      { data: approvedApplication(), error: null },
      { data: [listingRow({ price: 20 })], error: null },
      { data: [{ shop_id: "seller_shop_1", code: "SPRING10", percent_off: 10, active: true, starts_at: null, ends_at: null }], error: null },
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
