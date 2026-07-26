import { createClient } from "@supabase/supabase-js";
function env(name){const value=process.env[name];if(!value){const e=new Error(`${name} is not configured in Netlify`);e.statusCode=503;throw e}return value}
export function publicSettings(){return{url:env("SUPABASE_URL").replace(/\/$/,""),anonKey:env("SUPABASE_ANON_KEY")}}
export function admin(){return createClient(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false,autoRefreshToken:false}})}
function denied(message,statusCode=403){const e=new Error(message);e.statusCode=statusCode;throw e}
export async function currentUser(event){
 const auth=event.headers.authorization||event.headers.Authorization||"";
 if(!auth.startsWith("Bearer "))denied("Please sign in",401);
 const client=admin(),token=auth.slice(7),{data,error}=await client.auth.getUser(token);
 if(error||!data.user)denied("Your session expired. Please sign in again.",401);
 const {data:profile,error:profileError}=await client.from("profiles").select("default_shop_id").eq("id",data.user.id).maybeSingle();if(profileError)throw profileError;
 let membership=null;
 if(profile?.default_shop_id){const r=await client.from("shop_members").select("shop_id,role,status").eq("user_id",data.user.id).eq("shop_id",profile.default_shop_id).eq("status","active").maybeSingle();if(r.error)throw r.error;membership=r.data}
 if(!membership){const r=await client.from("shop_members").select("shop_id,role,status").eq("user_id",data.user.id).eq("status","active").order("created_at",{ascending:true}).limit(1).maybeSingle();if(r.error)throw r.error;membership=r.data}
 if(!membership)denied("This account does not have an active Bloom shop membership.");
 return{client,user:data.user,shopId:membership.shop_id,role:String(membership.role||"staff").toLowerCase(),membership}
}
export function requireRoles(context,roles){if(!roles.includes(context.role))denied("You do not have permission to perform this action.")}
export function fail(error){console.error("Bloom function error:",error);return{statusCode:error.statusCode||500,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify({error:error.message||"Unexpected Bloom error"})}}
