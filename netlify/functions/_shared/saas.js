import { createClient } from "@supabase/supabase-js";
import {
  userClient,
  resolveSupabaseServerKey,
  FOUNDER_SERVER_KEY_HINT
} from "./supabase.js";

export function env(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    const error = new Error(`${name} is not configured in Netlify`);
    error.statusCode = 503;
    throw error;
  }
  return String(value).trim();
}

/** Service-role client (webhooks, bootstrap). Requires server key. */
export function admin() {
  const resolved = resolveSupabaseServerKey();
  if (!resolved) {
    const error = new Error(FOUNDER_SERVER_KEY_HINT);
    error.statusCode = 503;
    error.code = "supabase_server_key_missing";
    throw error;
  }
  return createClient(env("SUPABASE_URL").replace(/\/$/, ""), resolved.value, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

/** Bearer JWT auth — works with anon + member token when server key is absent. */
export async function authenticatedUser(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  if (!auth.startsWith("Bearer ")) {
    const error = new Error("Please sign in");
    error.statusCode = 401;
    throw error;
  }
  const token = auth.slice(7);
  const client = userClient(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    const err = new Error("Your session expired. Please sign in again.");
    err.statusCode = 401;
    throw err;
  }
  return { client, user: data.user, usesServiceRole: false };
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body)
  };
}

export function fail(error) {
  console.error(error);
  return json(error.statusCode || 500, { error: error.message || "Unexpected error" });
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}
