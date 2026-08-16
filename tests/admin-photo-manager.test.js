import test from "node:test";
import assert from "node:assert/strict";
import { createAdminPhotoManagerHandler } from "../netlify/functions/admin-photo-manager.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

const ONE_BY_ONE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function superAdminRow() {
  return { data: { user_id: "u1", role: "super_admin", active: true }, error: null };
}

test("public_list: no auth required, maps floral_library rows into the catalog product shape", async () => {
  const storage = createFakeSupabaseStorage();
  const client = createFakeSupabaseClient([
    {
      data: [
        {
          id: "row-1",
          context: "floral_library",
          category: "Funeral",
          name: "Real Casket Spray",
          short_description: "A real one.",
          description: "A real casket spray photo.",
          recipe: [{ name: "Roses", qty: 12 }],
          suggested_retail: 199.99,
          image_path: "platform/floral_library/abc.jpg",
          alt_text: "Real casket spray photo",
        },
      ],
      error: null,
    },
  ], { storage });
  const handler = createAdminPhotoManagerHandler({ createServerClient: () => client });
  const res = await handler({
    httpMethod: "GET",
    queryStringParameters: { action: "public_list", context: "floral_library" },
    headers: {},
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].id, "admin-row-1");
  assert.equal(body.items[0].categories[0], "Funeral");
  assert.equal(body.items[0].suggested_retail.default, 199.99);
  assert.equal(body.items[0].primary_image.url, "https://fake.storage/platform-library-media/platform/floral_library/abc.jpg");
  // No auth call should have been attempted.
});

test("public_list: rejects an unknown context without touching the database", async () => {
  const handler = createAdminPhotoManagerHandler({});
  const res = await handler({
    httpMethod: "GET",
    queryStringParameters: { action: "public_list", context: "bogus" },
    headers: {},
  });
  assert.equal(res.statusCode, 400);
});

test("public_list: degrades to an empty list (not a 500) when no server key is configured", async () => {
  const handler = createAdminPhotoManagerHandler({
    createServerClient: () => {
      throw new Error("missing key");
    },
  });
  const res = await handler({
    httpMethod: "GET",
    queryStringParameters: { action: "public_list", context: "website_hero" },
    headers: {},
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { items: [] });
});

test("list: requires an authenticated platform admin", async () => {
  const handler = createAdminPhotoManagerHandler({
    authenticate: async () => {
      throw new Error("no session");
    },
  });
  const res = await handler({ httpMethod: "GET", queryStringParameters: { action: "list" }, headers: {} });
  assert.equal(res.statusCode, 401);
});

test("upload: validates required fields before touching storage", async () => {
  const client = createFakeSupabaseClient([superAdminRow()], { storage: createFakeSupabaseStorage() });
  const handler = createAdminPhotoManagerHandler({
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client,
  });
  const res = await handler({
    httpMethod: "POST",
    queryStringParameters: { action: "upload" },
    headers: {},
    body: JSON.stringify({ context: "website_hero", dataUrl: ONE_BY_ONE_PNG }), // missing name/category/alt_text
  });
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /Name is required/);
});

test("upload: happy path uploads the image, inserts a row, and writes an audit entry", async () => {
  const storage = createFakeSupabaseStorage();
  const client = createFakeSupabaseClient([
    superAdminRow(),
    {
      data: {
        id: "new-row",
        context: "website_hero",
        category: "signature",
        name: "Real Hero Photo",
        image_path: "platform/website_hero/xyz.png",
        alt_text: "A real hero photo",
      },
      error: null,
    }, // insert().select().single()
  ], { storage });
  const handler = createAdminPhotoManagerHandler({
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client,
  });
  const res = await handler({
    httpMethod: "POST",
    queryStringParameters: { action: "upload" },
    headers: {},
    body: JSON.stringify({
      context: "website_hero",
      category: "signature",
      name: "Real Hero Photo",
      alt_text: "A real hero photo",
      dataUrl: ONE_BY_ONE_PNG,
      filename: "hero.png",
    }),
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.item.id, "new-row");
  assert.ok(body.item.image_url.includes("platform/website_hero/xyz.png"));

  const uploadCall = storage.calls.find((c) => c.op === "upload");
  assert.ok(uploadCall, "expected the image to actually be uploaded");
  assert.equal(uploadCall.bucket, "platform-library-media");
  assert.match(uploadCall.path, /^platform\/website_hero\/.+\.png$/);

  const insertCall = client.calls.find((c) => c.table === "platform_library_photos" && c.ops.some(([op]) => op === "insert"));
  assert.ok(insertCall, "expected a real insert into platform_library_photos");
  assert.equal(insertCall.payload.name, "Real Hero Photo");
  assert.equal(insertCall.payload.created_by, "u1");

  const auditCall = client.calls.find((c) => c.table === "platform_admin_audit");
  assert.ok(auditCall, "expected an audit trail entry for the upload");
  assert.equal(auditCall.payload.action, "admin_photo_uploaded");
});

test("upload: a floral_library photo needs a positive price", async () => {
  const client = createFakeSupabaseClient([superAdminRow()], { storage: createFakeSupabaseStorage() });
  const handler = createAdminPhotoManagerHandler({
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client,
  });
  const res = await handler({
    httpMethod: "POST",
    queryStringParameters: { action: "upload" },
    headers: {},
    body: JSON.stringify({
      context: "floral_library",
      category: "Funeral",
      name: "Casket Spray",
      alt_text: "A casket spray",
      dataUrl: ONE_BY_ONE_PNG,
    }),
  });
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /positive price/);
});

test("update: edits an existing row and writes an audit entry", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "row-1", name: "Updated Name" }, error: null }, // update().eq().select().maybeSingle()
  ], { storage: createFakeSupabaseStorage() });
  const handler = createAdminPhotoManagerHandler({
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client,
  });
  const res = await handler({
    httpMethod: "POST",
    queryStringParameters: { action: "update" },
    headers: {},
    body: JSON.stringify({
      id: "row-1",
      context: "website_hero",
      category: "signature",
      name: "Updated Name",
      alt_text: "Updated alt text",
    }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).item.name, "Updated Name");
  const auditCall = client.calls.find((c) => c.table === "platform_admin_audit");
  assert.equal(auditCall.payload.action, "admin_photo_updated");
});

test("delete: removes the row, the storage file, and writes an audit entry", async () => {
  const storage = createFakeSupabaseStorage();
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "row-1", image_path: "platform/website_hero/xyz.png" }, error: null }, // select existing
    { data: null, error: null }, // delete
  ], { storage });
  const handler = createAdminPhotoManagerHandler({
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client,
  });
  const res = await handler({
    httpMethod: "POST",
    queryStringParameters: { action: "delete" },
    headers: {},
    body: JSON.stringify({ id: "row-1" }),
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });

  const removeCall = storage.calls.find((c) => c.op === "remove");
  assert.ok(removeCall, "expected the storage file to be removed");
  assert.deepEqual(removeCall.paths, ["platform/website_hero/xyz.png"]);

  const auditCall = client.calls.find((c) => c.table === "platform_admin_audit");
  assert.equal(auditCall.payload.action, "admin_photo_deleted");
});

test("delete: 404s for an unknown id without touching storage", async () => {
  const storage = createFakeSupabaseStorage();
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: null, error: null }, // select existing -> not found
  ], { storage });
  const handler = createAdminPhotoManagerHandler({
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client,
  });
  const res = await handler({
    httpMethod: "POST",
    queryStringParameters: { action: "delete" },
    headers: {},
    body: JSON.stringify({ id: "missing" }),
  });
  assert.equal(res.statusCode, 404);
  assert.equal(storage.calls.length, 0);
});
