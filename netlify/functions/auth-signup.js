import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { publicSettings, fail } from "./_shared/supabase.js";
import { authRedirectPath } from "./_shared/site-url.js";
import { checkRateLimit } from "./_shared/production.js";
import { fetchWithTimeout, requestIdOf } from "./_shared/upstream.js";
import { validateEmail } from "./_shared/validation.js";
import { logAuthEvent, mapAuthProviderFailure, jsonAuthError } from "./_shared/auth-email.js";

export async function handler(event){
  const requestId=requestIdOf(event);
  const ready=preflight(event); if(ready) return ready;
  if(event.httpMethod!=="POST") return methodNotAllowed();
  const limit=checkRateLimit(event,{key:"auth-signup",limit:10,windowMs:60_000});
  if(!limit.allowed) return json(429,{error:"Too many account requests. Please wait and try again.",code:"auth_rate_limited"});
  try{
    const body=bodyOf(event); const {url,anonKey}=publicSettings();
    const emailCheck=validateEmail(body.email,{required:true});
    if(!emailCheck.ok) return json(400,{error:emailCheck.error,code:emailCheck.code||"invalid_email"});
    const password=String(body.password||"");
    if(password.length<8) return json(400,{error:"Password must be at least 8 characters.",code:"password_too_short"});
    const origin=event.headers?.origin||event.headers?.Origin||"";
    const confirmUrl=authRedirectPath(process.env,origin,"/verify-email?confirmed=1");
    const response=await fetchWithTimeout(`${url}/auth/v1/signup?redirect_to=${encodeURIComponent(confirmUrl)}`,{
      method:"POST",headers:{"Content-Type":"application/json",apikey:anonKey,Authorization:`Bearer ${anonKey}`},
      body:JSON.stringify({email:emailCheck.value,password,data:{full_name:body.fullName||"",shop_name:body.shopName||"My Flower Shop",business_phone:body.businessPhone||"",business_type:body.businessType||"",business_address:body.businessAddress||"",business_city:body.businessCity||"",business_state:body.businessState||"",business_zip:body.businessZip||"",plan_code:["starter","pro","premium"].includes(body.planCode)?body.planCode:"pro",subscription_price:[39,79,129].includes(Number(body.subscriptionPrice))?Number(body.subscriptionPrice):79,trial_days:14,trial_started_at:new Date().toISOString()}})
    },{timeoutMs:5_000,service:"Account creation service"});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const mapped=mapAuthProviderFailure(response,data,{flow:"signup"});
      logAuthEvent("warn","signup_failed",{email_domain:emailCheck.value.split("@")[1],provider_status:response.status,code:mapped.code,request_id:requestId},event);
      return jsonAuthError(mapped);
    }
    logAuthEvent("info","signup_accepted",{user_id:data.user?.id||null,confirmation_required:!data.access_token,request_id:requestId},event);
    return json(200,{accessToken:data.access_token||null,refreshToken:data.refresh_token||null,expiresIn:data.expires_in||null,user:data.user||null,confirmationRequired:!data.access_token});
  }catch(error){ return fail(error); }
}
