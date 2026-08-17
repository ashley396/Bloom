// Stand-in "database" so this sample runs with zero external setup.
//
// Everything here is an in-memory Map and resets on server restart —
// that's fine for a demo, but before shipping this for real, replace it
// with actual persistence. The main Florisyn app already does exactly
// that: it keeps this same kind of user → Stripe account mapping in a
// real column (`shops.stripe_connect_account_id`, written in
// netlify/functions/stripe-connect.js) instead of memory. Swap `users`
// below for a query against your own users/sellers table the same way.
//
// Note what's deliberately NOT cached here: onboarding *status*
// (requirements, capability state). That's always fetched live from the
// Stripe API in server.js — see GET /onboard/status/:accountId — because
// requirements can change on Stripe's side at any time (new regulatory
// info requested, a capability re-verified, etc.), and a cached copy
// would just go stale. Persist the account ID; ask Stripe for status.

// Demo "users" you can onboard as separate connected accounts. In a real
// app this is your actual users/sellers table.
export const users = new Map([
  ["demo-seller-1", { id: "demo-seller-1", name: "Seller One", email: "seller-one@example.com", accountId: null }],
  ["demo-seller-2", { id: "demo-seller-2", name: "Seller Two", email: "seller-two@example.com", accountId: null }],
]);

// product.id -> connected account id. Products are also tagged with this
// same value in Stripe metadata (see POST /admin/products in server.js),
// so a fresh server instance could rebuild this map by reading
// `product.metadata.connected_account_id` back out of Stripe instead of
// relying on this cache — the metadata is the source of truth.
export const productAccountMap = new Map();
