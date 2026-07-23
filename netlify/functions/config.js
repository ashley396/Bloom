import { json } from "./_shared/http.js";
export async function handler() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return json(503, { error: "Supabase public settings are not configured in Netlify." });
  return json(200, { supabaseUrl: url, supabaseAnonKey: anonKey });
}
