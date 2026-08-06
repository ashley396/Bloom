import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { publicSettings, fail, adminIfConfigured } from "./_shared/supabase.js";
import { checkRateLimit, structuredLog, writeShopAudit } from "./_shared/production.js";
import { validateEmail } from "./_shared/validation.js";
import { fetchWithTimeout, requestIdOf } from "./_shared/upstream.js";

export async function handler(event){
  const requestId=requestIdOf(event);
  const ready=preflight(event); if(ready) return ready;
  if(event.httpMethod!=="POST") return methodNotAllowed();
  const limit=checkRateLimit(event,{key:"auth-login",limit:30,windowMs:60_000});
  if(!limit.allowed) return json(429,{error:"Too many sign-in attempts. Please wait and try again."});
  try{
    const body=bodyOf(event);
    const emailCheck=validateEmail(body.email,{required:true});
    if(!emailCheck.ok) return json(400,{error:emailCheck.error});
    if(!body.password||String(body.password).length<8) return json(400,{error:"Password is required."});
    const {url,anonKey}=publicSettings();
    const response=await fetchWithTimeout(`${url}/auth/v1/token?grant_type=password`,{
      method:"POST",headers:{"Content-Type":"application/json",apikey:anonKey,Authorization:`Bearer ${anonKey}`},
      body:JSON.stringify({email:emailCheck.value,password:body.password})
    },{timeoutMs:5_000,service:"Authentication service"});
    const data=await response.json();
    if(!response.ok){
      structuredLog("warn","login_failed",{email:emailCheck.value,request_id:requestId});
      const auditClient=adminIfConfigured();
      if(auditClient) await writeShopAudit(auditClient,{userId:null,eventType:"login_failed",entityType:"auth",metadata:{email:emailCheck.value}});
      return json(401,{error:"Invalid email or password."});
    }
    structuredLog("info","login_success",{user_id:data.user?.id,request_id:requestId});
    const auditClient=adminIfConfigured();
    if(auditClient) await writeShopAudit(auditClient,{userId:data.user?.id,eventType:"login_success",entityType:"auth",entityId:data.user?.id});
    return json(200,{accessToken:data.access_token,refreshToken:data.refresh_token,expiresIn:data.expires_in,user:data.user});
  }catch(error){ return fail(error); }
}
