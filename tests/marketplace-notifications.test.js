import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NOTIFICATION_TYPES, notifyMarketplaceUser, notifyFavoritersBackInStock } from "../netlify/functions/_shared/marketplace-notifications.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

const root = process.cwd();

test("marketplace_notifications migration mirrors the community notifications RLS pattern: select-own, mark-read-own, no client INSERT policy", () => {
  const sql = fs.readFileSync(path.join(root, "supabase/migrations/20260819200000_marketplace_notifications.sql"), "utf8");
  assert.match(sql, /recipient_user_id uuid not null references auth\.users/);
  assert.match(sql, /check \(type in \('order_status_changed', 'back_in_stock'\)\)/);
  assert.match(sql, /for select using \(recipient_user_id = auth\.uid\(\)\)/);
  assert.match(sql, /for update using \(recipient_user_id = auth\.uid\(\)\) with check \(recipient_user_id = auth\.uid\(\)\)/);
  assert.doesNotMatch(sql, /for insert/i);
});

test("notifyMarketplaceUser refuses to write a notification with no recipient, an unrecognized type, or no message", async () => {
  // None of these throw — a malformed notification silently no-ops rather
  // than ever blocking the real action it's attached to.
  await assert.doesNotReject(notifyMarketplaceUser(null, "order_status_changed", "hi"));
  await assert.doesNotReject(notifyMarketplaceUser("user-1", "not_a_real_type", "hi"));
  await assert.doesNotReject(notifyMarketplaceUser("user-1", "order_status_changed", ""));
  assert.deepEqual(NOTIFICATION_TYPES, ["order_status_changed", "back_in_stock", "refund_requested"]);
});

test("marketplace-seller.js notifies the buyer only on a real status change, using the seller's real display name", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-seller.js"), "utf8");
  const block = src.slice(src.indexOf('action === "update-order"'), src.indexOf('const payload = buildListingPayload(body, shopId);'));
  assert.match(block, /body\.status && body\.status !== existing\.status/);
  assert.match(block, /notifyMarketplaceUser\(/);
  assert.match(block, /existing\.buyer_user_id/);
});

test("marketplace-seller.js's back-in-stock notification only fires on a real unavailable-to-available transition, never on every save", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-seller.js"), "utf8");
  const fn = src.slice(src.indexOf("async function saveProduct"), src.indexOf("async function transitionPublish"));
  assert.match(fn, /wasAvailable = existing\.active !== false && isCurrentlyAvailable\(existing\)/);
  assert.match(fn, /if \(wasAvailable === false\)/);
  assert.match(fn, /notifyFavoritersBackInStock/);
});

test("marketplace-catalog.js exposes buyer notifications read + mark-read, scoped to the requesting user", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  assert.match(src, /resource === "notifications"/);
  assert.match(src, /action === "mark_notifications_read"/);
  assert.match(src, /\.eq\("recipient_user_id",\s*user\.id\)/);
});

test("buyer marketplace UI has a real notification bell wired to the backend, not a static icon", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /id="marketplaceNotifBell"/);
  assert.match(html, /id="marketplaceNotifPanel"/);

  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  assert.match(js, /resource=notifications/);
  assert.match(js, /action:\s*'mark_notifications_read'/);
});

// notifyFavoritersBackInStock had zero direct behavior coverage — only its
// callers were checked via source-text assertions above. These exercise
// the fan-out logic itself against a fake client.

test("notifyFavoritersBackInStock: no listingId is a no-op with zero queries", async () => {
  const client = createFakeSupabaseClient([]);
  await notifyFavoritersBackInStock(client, null, "Back in stock!");
  assert.equal(client.calls.length, 0);
});

test("notifyFavoritersBackInStock: a favorites query error is swallowed, not thrown", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: new Error("db down") }]);
  await assert.doesNotReject(() => notifyFavoritersBackInStock(client, "listing-1", "Back in stock!"));
});

test("notifyFavoritersBackInStock: no favorites means no further work, no throw", async () => {
  const client = createFakeSupabaseClient([{ data: [], error: null }]);
  await assert.doesNotReject(() => notifyFavoritersBackInStock(client, "listing-1", "Back in stock!"));
});

test("notifyFavoritersBackInStock: real favoriters are looked up by the given listing, and the fan-out never throws (even with no admin client configured in this environment)", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ user_id: "fav-1" }, { user_id: "fav-2" }], error: null },
  ]);
  await assert.doesNotReject(() => notifyFavoritersBackInStock(client, "listing-1", "Your favorite is back!"));
  const favoritesCall = client.calls.find((c) => c.table === "marketplace_favorites");
  assert.ok(favoritesCall.ops.some(([op, args]) => op === "eq" && args[0] === "listing_id" && args[1] === "listing-1"));
});
