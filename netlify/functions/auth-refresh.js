import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { publicSettings, fail } from "./_shared/supabase.js";
import { fetchWithTimeout } from "./_shared/upstream.js";
import { checkRateLimit } from "./_shared/production.js";
export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  if(event.httpMethod!=="POST") return methodNotAllowed();
  const limit=checkRateLimit(event,{key:"auth-refresh",limit:120,windowMs:60_000});
  if(!limit.allowed) return json(429,{error:"Too many session refresh attempts. Please sign in again."});
  try{
    const body=bodyOf(event); const {url,anonKey}=publicSettings();
    if(!String(body.refreshToken||"").trim()) return json(400,{error:"Refresh token is required."});
    const response=await fetchWithTimeout(`${url}/auth/v1/token?grant_type=refresh_token`,{
      method:"POST",headers:{"Content-Type":"application/json",apikey:anonKey,Authorization:`Bearer ${anonKey}`},
      body:JSON.stringify({refresh_token:body.refreshToken})
    },{timeoutMs:5_000,service:"Session refresh service"});
    const data=await response.json();
    if(!response.ok) return json(response.status,{error:"Session expired"});
    return json(200,{accessToken:data.access_token,refreshToken:data.refresh_token,expiresIn:data.expires_in,user:data.user});
  }catch(error){ return fail(error); }
}
