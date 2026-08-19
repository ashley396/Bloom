import test from "node:test";
import assert from "node:assert/strict";
import { createProviderAdapter } from "../netlify/functions/_shared/payment-hub-providers.js";

/**
 * Real bug, confirmed live: Payment Center kept showing "Test" for a
 * connected Stripe account even after the platform's STRIPE_SECRET_KEY
 * was genuinely switched to a live key, a brand-new connected account was
 * created under that live key, and a real card successfully processed a
 * real charge through it (Stripe test mode flatly refuses real card
 * numbers, so that alone proves the platform key is live). The status()
 * check's "connected, account retrieved successfully" branch derived mode
 * from `account.livemode` on the Stripe Account object instead of from
 * the platform key that's actually running the request — every other
 * branch in this same function already (correctly) uses the key prefix.
 */

test("a successfully-retrieved connected account reports live mode when the platform key is live, regardless of the account object's own livemode field", async () => {
  const env = { STRIPE_SECRET_KEY: "sk_live_abc123" };
  const shop = { stripe_connect_account_id: "acct_real123" };
  const stripeClient = {
    accounts: {
      // Mirrors what was actually observed in production: a real, live,
      // actively-charging connected account whose own `livemode` field
      // reads false.
      async retrieve() {
        return { id: "acct_real123", livemode: false, charges_enabled: true, payouts_enabled: true };
      }
    }
  };

  const adapter = createProviderAdapter("stripe", { stripeClient, shop, env });
  const status = await adapter.status();

  assert.equal(status.connected, true);
  assert.equal(status.mode, "live");
});

test("stays test mode when the platform key is actually a test key", async () => {
  const env = { STRIPE_SECRET_KEY: "sk_test_abc123" };
  const shop = { stripe_connect_account_id: "acct_test123" };
  const stripeClient = {
    accounts: {
      async retrieve() {
        return { id: "acct_test123", livemode: false, charges_enabled: true, payouts_enabled: true };
      }
    }
  };

  const adapter = createProviderAdapter("stripe", { stripeClient, shop, env });
  const status = await adapter.status();

  assert.equal(status.mode, "test");
});

test("the other status() branches (no account linked, retrieve fails) already agreed with the platform key and still do", async () => {
  const liveEnv = { STRIPE_SECRET_KEY: "sk_live_abc123" };

  const noAccountAdapter = createProviderAdapter("stripe", { shop: {}, env: liveEnv });
  const noAccountStatus = await noAccountAdapter.status();
  assert.equal(noAccountStatus.mode, "live");
  assert.equal(noAccountStatus.connected, false);

  const failingClient = {
    accounts: {
      async retrieve() {
        throw new Error("No such account");
      }
    }
  };
  const failedAdapter = createProviderAdapter("stripe", {
    stripeClient: failingClient,
    shop: { stripe_connect_account_id: "acct_gone" },
    env: liveEnv
  });
  const failedStatus = await failedAdapter.status();
  assert.equal(failedStatus.mode, "live");
  assert.equal(failedStatus.connected, false);
});
