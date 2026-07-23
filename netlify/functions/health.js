import { json } from "./_shared/http.js";
export async function handler(){
  const required=["SUPABASE_URL","SUPABASE_ANON_KEY","SUPABASE_SERVICE_ROLE_KEY"];
  const missing=required.filter(k=>!process.env[k]);
  return json(missing.length?503:200,{ok:missing.length===0,app:"Bloom Commercial v4",missing});
}
