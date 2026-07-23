import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured in Netlify`);
  return value;
}

export function adminClient() {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function requireUser(event) {
  const authorization = event.headers.authorization || event.headers.Authorization;
  if (!authorization?.startsWith("Bearer ")) {
    const error = new Error("Sign in required");
    error.statusCode = 401;
    throw error;
  }
  const token = authorization.slice(7);
  const supabase = adminClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    const expired = new Error("Your session has expired. Please sign in again.");
    expired.statusCode = 401;
    throw expired;
  }
  return { supabase, user: data.user };
}

export function handleError(error) {
  console.error(error);
  return {
    statusCode: error.statusCode || 500,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ error: error.message || "Unexpected server error" })
  };
}
