import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePhoneDigits,
  normalizeEmail,
  findDuplicateCustomer,
} from "../netlify/functions/_shared/customer-dedup.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// customer-dedup.js had only 31.5% coverage — real dedup logic that
// silently determines whether a new customer form creates a duplicate row
// or reuses an existing one, so it deserves real behavior tests, not just
// a source-level check.

test("normalizePhoneDigits: strips formatting characters down to digits", () => {
  assert.equal(normalizePhoneDigits("(555) 123-4567"), "5551234567");
});

test("normalizePhoneDigits: strips a leading US country code (11 digits starting with 1)", () => {
  assert.equal(normalizePhoneDigits("15551234567"), "5551234567");
});

test("normalizePhoneDigits: an 11-digit number NOT starting with 1 is left as-is", () => {
  assert.equal(normalizePhoneDigits("25551234567"), "25551234567");
});

test("normalizePhoneDigits: null/empty input becomes an empty string, not 'null'", () => {
  assert.equal(normalizePhoneDigits(null), "");
  assert.equal(normalizePhoneDigits(""), "");
});

test("normalizeEmail: trims and lowercases", () => {
  assert.equal(normalizeEmail("  Florist@Example.COM  "), "florist@example.com");
  assert.equal(normalizeEmail(null), "");
});

test("findDuplicateCustomer: no shopId short-circuits to not-duplicate with zero queries", async () => {
  const client = createFakeSupabaseClient([]);
  const result = await findDuplicateCustomer(client, null, { email: "a@b.com" });
  assert.deepEqual(result, { duplicate: false });
  assert.equal(client.calls.length, 0);
});

test("findDuplicateCustomer: an email match is reported and short-circuits before any phone query", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "c1", name: "Jane Doe", email: "jane@example.com", phone: "5551234567" }, error: null },
  ]);
  const result = await findDuplicateCustomer(client, "shop-1", { email: "Jane@Example.com", phone: "9999999999" });
  assert.equal(result.duplicate, true);
  assert.equal(result.field, "email");
  assert.equal(result.existing.id, "c1");
  assert.equal(client.calls.length, 1, "a matched email must skip the phone query entirely");
});

test("findDuplicateCustomer: no email match falls through to checking phone, which then matches", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // email query: no match
    { data: [{ id: "c2", name: "John Roe", email: "other@example.com", phone: "5559876543" }], error: null },
  ]);
  const result = await findDuplicateCustomer(client, "shop-1", { email: "new@example.com", phone: "555-987-6543" });
  assert.equal(result.duplicate, true);
  assert.equal(result.field, "phone");
  assert.equal(result.existing.id, "c2");
});

test("findDuplicateCustomer: phone match works via a shared last-10-digit suffix even with different country-code prefixes", async () => {
  const client = createFakeSupabaseClient([
    { data: [{ id: "c3", name: "Existing", email: null, phone: "5559876543" }], error: null },
  ]);
  const result = await findDuplicateCustomer(client, "shop-1", { phone: "15559876543" });
  assert.equal(result.duplicate, true);
  assert.equal(result.field, "phone");
});

test("findDuplicateCustomer: phone shorter than 7 digits is never checked at all", async () => {
  const client = createFakeSupabaseClient([]);
  const result = await findDuplicateCustomer(client, "shop-1", { phone: "12345" });
  assert.deepEqual(result, { duplicate: false });
  assert.equal(client.calls.length, 0, "a too-short phone number must not trigger a database query");
});

test("findDuplicateCustomer: excludeId is applied to the email query filter and skips itself in the phone scan", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // email query (self excluded via .neq, so no self-match)
    { data: [{ id: "self-id", name: "Me", email: "me@example.com", phone: "5551112222" }], error: null },
  ]);
  const result = await findDuplicateCustomer(client, "shop-1", {
    email: "me@example.com",
    phone: "5551112222",
    excludeId: "self-id",
  });
  assert.deepEqual(result, { duplicate: false }, "a customer must never be reported as a duplicate of themselves");
  const emailCall = client.calls[0];
  assert.ok(emailCall.ops.some(([op, args]) => op === "neq" && args[1] === "self-id"));
});

test("findDuplicateCustomer: neither email nor phone provided means no queries and no duplicate", async () => {
  const client = createFakeSupabaseClient([]);
  const result = await findDuplicateCustomer(client, "shop-1", {});
  assert.deepEqual(result, { duplicate: false });
  assert.equal(client.calls.length, 0);
});

test("findDuplicateCustomer: an email query error is thrown, not swallowed", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: new Error("db down") }]);
  await assert.rejects(
    () => findDuplicateCustomer(client, "shop-1", { email: "a@b.com" }),
    /db down/
  );
});

test("findDuplicateCustomer: a phone query error is thrown, not swallowed", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null },
    { data: null, error: new Error("db down") },
  ]);
  await assert.rejects(
    () => findDuplicateCustomer(client, "shop-1", { email: "a@b.com", phone: "5551234567" }),
    /db down/
  );
});
