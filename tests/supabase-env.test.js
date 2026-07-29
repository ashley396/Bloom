import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveSupabaseServerKey,
  resolveSupabaseClientKey,
  firstEnv,
  requireServerKeyFor,
  adminIfConfigured,
  FOUNDER_ADD_STORE_KEY_HINT
} from "../netlify/functions/_shared/supabase.js";
import { safePublicError } from "../netlify/functions/_shared/production.js";

test("resolveSupabaseServerKey prefers legacy name then secret key", () => {
  assert.equal(
    resolveSupabaseServerKey({ SUPABASE_SERVICE_ROLE_KEY: "legacy-jwt" })?.value,
    "legacy-jwt"
  );
  assert.equal(
    resolveSupabaseServerKey({ SUPABASE_SECRET_KEY: "sb_secret_abc" })?.value,
    "sb_secret_abc"
  );
  assert.equal(
    resolveSupabaseServerKey({
      SUPABASE_SERVICE_ROLE_KEY: "legacy",
      SUPABASE_SECRET_KEY: "secret"
    })?.value,
    "legacy"
  );
  assert.equal(resolveSupabaseServerKey({}), null);
});

test("resolveSupabaseClientKey accepts anon or publishable", () => {
  assert.equal(resolveSupabaseClientKey({ SUPABASE_ANON_KEY: "anon" })?.value, "anon");
  assert.equal(
    resolveSupabaseClientKey({ SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" })?.value,
    "sb_publishable_x"
  );
});

test("firstEnv trims whitespace", () => {
  assert.deepEqual(firstEnv(["A", "B"], { B: "  key  " }), { name: "B", value: "key" });
});

test("requireServerKeyFor throws founder-friendly add_store message", () => {
  assert.throws(
    () => requireServerKeyFor("add_store"),
    (err) => {
      assert.equal(err.statusCode, 503);
      assert.equal(err.message, FOUNDER_ADD_STORE_KEY_HINT);
      assert.match(err.message, /view and switch/i);
      assert.doesNotMatch(err.message, /SUPABASE_SERVICE_ROLE_KEY/);
      return true;
    }
  );
});

test("adminIfConfigured returns null when no server key env is set", () => {
  const prevRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevSecret = process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
  try {
    assert.equal(adminIfConfigured(), null);
  } finally {
    if (prevRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevRole;
    if (prevSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = prevSecret;
  }
});

test("safePublicError maps legacy server key technical text", () => {
  assert.match(
    safePublicError({
      statusCode: 503,
      message: "Supabase server API key is not configured in Netlify (set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY)"
    }),
    /secure server connection/i
  );
  assert.match(
    safePublicError({
      statusCode: 503,
      message: "SUPABASE_SERVICE_ROLE_KEY is not configured in Netlify"
    }),
    /secure server connection/i
  );
});
