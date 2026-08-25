import test from "node:test";
import assert from "node:assert/strict";
import { hashPortalToken, generatePortalToken, resolveCustomerPortalSession, assertPortalCustomer } from "../netlify/functions/_shared/customer-portal-auth.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// customer-portal-auth.js had only 39.3% coverage despite being the whole
// auth boundary for the customer-facing portal — a bug here either locks
// a real customer out or, worse, lets a token resolve to the wrong scope.

test("hashPortalToken: is deterministic and produces a real sha256 hex digest", () => {
  const hash = hashPortalToken("my-token");
  assert.equal(hash, hashPortalToken("my-token"));
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test("hashPortalToken: different tokens hash to different values", () => {
  assert.notEqual(hashPortalToken("token-a"), hashPortalToken("token-b"));
});

test("hashPortalToken: null/undefined input hashes the empty string rather than throwing", () => {
  assert.equal(hashPortalToken(null), hashPortalToken(""));
});

test("generatePortalToken: produces a real, sufficiently long, URL-safe random token, different each call", () => {
  const a = generatePortalToken();
  const b = generatePortalToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 24);
  assert.doesNotMatch(a, /[+/=]/, "must be base64url, not plain base64 (no +, /, or = padding)");
});

test("resolveCustomerPortalSession: a valid, unexpired token resolves to its real shop/customer scope", async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const client = createFakeSupabaseClient([
    { data: { shop_id: "shop-1", customer_id: "cust-1", expires_at: future }, error: null },
  ]);
  const result = await resolveCustomerPortalSession(client, "real-token");
  assert.deepEqual(result, { ok: true, shopId: "shop-1", customerId: "cust-1" });
});

test("resolveCustomerPortalSession: an unknown token reports invalid_token, not a crash", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  const result = await resolveCustomerPortalSession(client, "bogus-token");
  assert.deepEqual(result, { ok: false, error: "invalid_token" });
});

test("resolveCustomerPortalSession: an expired token is rejected even though the row itself was found", async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const client = createFakeSupabaseClient([
    { data: { shop_id: "shop-1", customer_id: "cust-1", expires_at: past }, error: null },
  ]);
  const result = await resolveCustomerPortalSession(client, "expired-token");
  assert.deepEqual(result, { ok: false, error: "expired" });
});

test("resolveCustomerPortalSession: the table not existing yet (42P01) degrades to a clear portal_not_configured state, not a raw DB error", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { code: "42P01", message: "relation does not exist" } }]);
  const result = await resolveCustomerPortalSession(client, "any-token");
  assert.deepEqual(result, { ok: false, error: "portal_not_configured" });
});

test("resolveCustomerPortalSession: any other database error is thrown, not swallowed", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { code: "500", message: "connection lost" } }]);
  await assert.rejects(
    () => resolveCustomerPortalSession(client, "any-token"),
    (err) => {
      assert.equal(err.message, "connection lost");
      return true;
    }
  );
});

test("assertPortalCustomer: allows access when the resolved session's customerId matches the requested one", () => {
  assert.deepEqual(assertPortalCustomer({ customerId: "cust-1" }, "cust-1"), { ok: true });
});

test("assertPortalCustomer: forbids access when the session's scope is for a different customer", () => {
  const result = assertPortalCustomer({ customerId: "cust-1" }, "cust-2");
  assert.equal(result.ok, false);
  assert.equal(result.error, "forbidden");
});

test("assertPortalCustomer: compares as strings — a UUID/string vs number type mismatch is not treated as a mismatch", () => {
  assert.deepEqual(assertPortalCustomer({ customerId: 123 }, "123"), { ok: true });
});
