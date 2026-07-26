import { createClient } from "@supabase/supabase-js";

export function env(name) {
  const value = process.env[name];
  if (!value) {
    const error = new Error(`${name} is not configured in Netlify`);
    error.statusCode = 503;
    throw error;
  }
  return value;
}

export function admin() {
  return createClient(env("SUPABASE_URL").replace(/\/$/, ""), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export async function authenticatedUser(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  if (!auth.startsWith("Bearer ")) {
    const error = new Error("Please sign in");
    error.statusCode = 401;
    throw error;
  }
  const client = admin();
  const { data, error } = await client.auth.getUser(auth.slice(7));
  if (error || !data.user) {
    const err = new Error("Your session expired. Please sign in again.");
    err.statusCode = 401;
    throw err;
  }
  return { client, user: data.user };
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
