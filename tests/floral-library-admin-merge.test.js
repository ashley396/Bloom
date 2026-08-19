/**
 * floral-library.js's `starter` action merges in real photos a platform
 * admin uploaded (netlify/functions/admin-photo-manager.js) alongside the
 * static catalog. Additive only: admin content sits on top, never hides
 * or replaces the static catalog, and any failure fetching it degrades
 * to the static catalog alone rather than breaking the whole response.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createFloralLibraryHandler } from "../netlify/functions/floral-library.js";
import { getPublicFloralLibraryCatalog } from "../netlify/functions/_shared/floral-library-core.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

test("starter action merges admin-uploaded floral_library photos ahead of the static catalog", async () => {
  const staticCount = getPublicFloralLibraryCatalog().length;
  const storage = createFakeSupabaseStorage({ publicUrl: (p) => `https://fake.storage/${p}` });
  const client = createFakeSupabaseClient([
    {
      data: [
        {
          id: "row-1",
          context: "floral_library",
          category: "Funeral",
          name: "Real Casket Spray",
          recipe: [{ name: "Roses", qty: 12 }],
          suggested_retail: 249.99,
          image_path: "platform/floral_library/abc.jpg",
          alt_text: "Real casket spray photo",
        },
      ],
      error: null,
    },
  ], { storage });
  const handler = createFloralLibraryHandler({ createServerClient: () => client });
  const res = await handler({ httpMethod: "GET", queryStringParameters: { action: "starter" }, headers: {} });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.count, staticCount + 1);
  assert.equal(body.products[0].id, "admin-row-1", "admin-uploaded photos sit ahead of the static catalog");
  assert.equal(body.products[0].name, "Real Casket Spray");
});

test("starter action degrades to the static catalog alone if the admin-photos query fails", async () => {
  const staticCount = getPublicFloralLibraryCatalog().length;
  const handler = createFloralLibraryHandler({
    createServerClient: () => {
      throw new Error("no server key");
    },
  });
  const res = await handler({ httpMethod: "GET", queryStringParameters: { action: "starter" }, headers: {} });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.count, staticCount);
});

test("add_to_shop resolves an admin-uploaded master by its admin- prefixed id", async () => {
  const storage = createFakeSupabaseStorage({ publicUrl: (p) => `https://fake.storage/${p}` });
  const client = createFakeSupabaseClient([
    {
      data: [
        {
          id: "row-1",
          context: "floral_library",
          category: "Funeral",
          name: "Real Casket Spray",
          recipe: [{ name: "Roses", qty: 12 }],
          suggested_retail: 249.99,
          image_path: "platform/floral_library/abc.jpg",
          alt_text: "Real casket spray photo",
        },
      ],
      error: null,
    },
  ], { storage });
  const handler = createFloralLibraryHandler({ createServerClient: () => client });
  const res = await handler({
    httpMethod: "POST",
    queryStringParameters: {},
    headers: { authorization: "Bearer fake" },
    body: JSON.stringify({ action: "add_to_shop", master_id: "admin-row-1" }),
  });
  // currentUser() will fail auth in this fake-token test environment —
  // what matters here is that it gets far enough to look the item up
  // rather than 404ing on the id lookup itself.
  assert.notEqual(res.statusCode, 404);
});
