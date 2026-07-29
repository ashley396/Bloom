import { createClient } from "@supabase/supabase-js";
import { safePublicError, structuredLog } from "./production.js";

/** Netlify / Node — read from process.env only (no file loading here). */
const SERVER_KEY_ENV_NAMES = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"];
const CLIENT_KEY_ENV_NAMES = ["SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY"];

/** Shown to florists when an action truly needs the service role (not raw env names in UI). */
export const FOUNDER_SERVER_KEY_HINT =
  "This needs Florisyn's secure server connection, which is not set up in Netlify yet. You can still view and switch your existing shop locations. If you manage hosting, add the Supabase service key there—or contact Florisyn support.";

export const FOUNDER_ADD_STORE_KEY_HINT =
  "Adding a new shop location needs Florisyn's secure server connection (not configured in Netlify yet). You can still view and switch your current locations.";

function env(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    const e = new Error(`${name} is not configured in Netlify`);
    e.statusCode = 503;
    throw e;
  }
  return String(value).trim();
}

/** First non-empty env var from `names`, or null. */
export function firstEnv(names, env = process.env) {
  for (const name of names) {
    const value = env[name];
    if (value && String(value).trim()) return { name, value: String(value).trim() };
  }
  return null;
}

export function resolveSupabaseServerKey(env = process.env) {
  return firstEnv(SERVER_KEY_ENV_NAMES, env);
}

export function resolveSupabaseClientKey(env = process.env) {
  return firstEnv(CLIENT_KEY_ENV_NAMES, env);
}

function requireServerKey() {
  const resolved = resolveSupabaseServerKey();
  if (!resolved) {
    const e = new Error(FOUNDER_SERVER_KEY_HINT);
    e.statusCode = 503;
    e.code = "supabase_server_key_missing";
    throw e;
  }
  return resolved.value;
}

/** Throws a founder-friendly 503 when the service role / secret key is missing. */
export function requireServerKeyFor(purpose = "default") {
  const resolved = resolveSupabaseServerKey();
  if (resolved) return resolved.value;
  const e = new Error(purpose === "add_store" ? FOUNDER_ADD_STORE_KEY_HINT : FOUNDER_SERVER_KEY_HINT);
  e.statusCode = 503;
  e.code = "supabase_server_key_missing";
  throw e;
}

/** User-scoped Supabase client (anon/publishable key + member JWT). Respects RLS. */
export function userClient(accessToken) {
  const token = String(accessToken || "").trim();
  if (!token) denied("Please sign in", 401);
  const url = env("SUPABASE_URL").replace(/\/$/, "");
  return createClient(url, requireClientKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

function requireClientKey() {
  const resolved = resolveSupabaseClientKey();
  if (!resolved) {
    const e = new Error(
      `Supabase client API key is not configured in Netlify (set ${CLIENT_KEY_ENV_NAMES.join(" or ")})`
    );
    e.statusCode = 503;
    throw e;
  }
  return resolved.value;
}

export function publicSettings() {
  return {
    url: env("SUPABASE_URL").replace(/\/$/, ""),
    anonKey: requireClientKey()
  };
}

export function admin() {
  return createClient(env("SUPABASE_URL"), requireServerKey(), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

/** Service-role client when configured; null otherwise (e.g. login audit without blocking sign-in). */
export function adminIfConfigured() {
  const resolved = resolveSupabaseServerKey();
  if (!resolved) return null;
  return createClient(env("SUPABASE_URL").replace(/\/$/, ""), resolved.value, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
function denied(message,statusCode=403){const e=new Error(message);e.statusCode=statusCode;throw e}
function isMissingColumnError(error,column="status"){const msg=String(error?.message||error||"").toLowerCase();return msg.includes(column.toLowerCase())&&(msg.includes("column")||msg.includes("schema cache"))}
async function activeMembership(client,userId,preferredShopId){const base=()=>client.from("shop_members").select("shop_id,role,status").eq("user_id",userId);let membership=null;if(preferredShopId){let r=await base().eq("shop_id",preferredShopId).eq("status","active").maybeSingle();if(r.error&&isMissingColumnError(r.error,"status"))r=await base().eq("shop_id",preferredShopId).maybeSingle();if(r.error)throw r.error;membership=r.data}if(!membership){let r=await base().eq("status","active").order("created_at",{ascending:true}).limit(1).maybeSingle();if(r.error&&isMissingColumnError(r.error,"status"))r=await base().order("created_at",{ascending:true}).limit(1).maybeSingle();if(r.error)throw r.error;membership=r.data}return membership}
export async function currentUser(event){
 const auth=event.headers.authorization||event.headers.Authorization||"";
 if(!auth.startsWith("Bearer "))denied("Please sign in",401);
 const token=auth.slice(7);
 const adminClient=adminIfConfigured();
 const client=adminClient??userClient(token);
 const {data,error}=await client.auth.getUser(token);
 if(error||!data.user)denied("Your session expired. Please sign in again.",401);
 const {data:profile,error:profileError}=await client.from("profiles").select("default_shop_id").eq("id",data.user.id).maybeSingle();if(profileError)throw profileError;
 const membership=await activeMembership(client,data.user.id,profile?.default_shop_id);
 if(!membership)denied("This account does not have an active Florisyn shop membership.");
 return{client,user:data.user,shopId:membership.shop_id,role:String(membership.role||"staff").toLowerCase(),membership,usesServiceRole:Boolean(adminClient)}
}
export function requireRoles(context,roles){if(!roles.includes(context.role))denied("You do not have permission to perform this action.")}
export function fail(error){structuredLog("error","function_error",{message:error.message,status:error.statusCode||500});console.error("Florisyn function error:",error);return{statusCode:error.statusCode||500,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify({error:safePublicError(error)})}}
