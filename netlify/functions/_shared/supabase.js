import { createClient } from "@supabase/supabase-js";

function env(name){
  const value = process.env[name];
  if(!value){ const e = new Error(`${name} is not configured in Netlify`); e.statusCode = 503; throw e; }
  return value;
}
export function publicSettings(){ return { url: env("SUPABASE_URL").replace(/\/$/,""), anonKey: env("SUPABASE_ANON_KEY") }; }
export function admin(){ return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {auth:{persistSession:false,autoRefreshToken:false}}); }
export async function currentUser(event){
  const auth = event.headers.authorization || event.headers.Authorization || "";
  if(!auth.startsWith("Bearer ")){ const e = new Error("Please sign in"); e.statusCode = 401; throw e; }
  const token = auth.slice(7);
  const client = admin();
  const {data,error} = await client.auth.getUser(token);
  if(error || !data.user){ const e = new Error("Your session expired. Please sign in again."); e.statusCode = 401; throw e; }
  const {data:profile, error:profileError} = await client.from("profiles").select("default_shop_id").eq("id",data.user.id).single();
  if(profileError) throw profileError;
  return {client,user:data.user,shopId:profile.default_shop_id};
}
export function fail(error){
  console.error(error);
  return {statusCode:error.statusCode||500,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify({error:error.message||"Unexpected error"})};
}
