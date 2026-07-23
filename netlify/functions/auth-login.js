import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { publicSettings, fail } from "./_shared/supabase.js";
export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  if(event.httpMethod!=="POST") return methodNotAllowed();
  try{
    const body=bodyOf(event); const {url,anonKey}=publicSettings();
    const response=await fetch(`${url}/auth/v1/token?grant_type=password`,{
      method:"POST",headers:{"Content-Type":"application/json",apikey:anonKey,Authorization:`Bearer ${anonKey}`},
      body:JSON.stringify({email:body.email,password:body.password})
    });
    const data=await response.json();
    if(!response.ok) return json(response.status,{error:data.msg||data.message||"Sign in failed"});
    return json(200,{accessToken:data.access_token,refreshToken:data.refresh_token,expiresIn:data.expires_in,user:data.user});
  }catch(error){ return fail(error); }
}
