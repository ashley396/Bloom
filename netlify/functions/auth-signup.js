import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { publicSettings, fail } from "./_shared/supabase.js";
import { authRedirectPath } from "./_shared/site-url.js";
import { checkDistributedRateLimit } from "./_shared/production.js";
import { fetchWithTimeout, requestIdOf } from "./_shared/upstream.js";
import { validateEmail } from "./_shared/validation.js";
import { logAuthEvent, mapAuthProviderFailure, jsonAuthError } from "./_shared/auth-email.js";
import { sendSignupConfirmationEmail } from "./_shared/auth-confirmation-email.js";
import { emailProviderConfigured } from "./_shared/notification-email.js";

export async function handler(event){
  const requestId=requestIdOf(event);
  const ready=preflight(event); if(ready) return ready;
  if(event.httpMethod!=="POST") return methodNotAllowed();
  const limit=await checkDistributedRateLimit(event,{key:"auth-signup",limit:10,windowMs:60_000});
  if(!limit.allowed){
    const retryAfterSeconds=Math.max(1,Math.ceil((limit.retryAfterMs||60_000)/1000));
    const limited=json(429,{error:"Too many account requests. Please wait and try again.",code:"auth_rate_limited",retryAfterSeconds},process.env,event);
    limited.headers={...limited.headers,"Retry-After":String(retryAfterSeconds)};
    return limited;
  }
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
      return jsonAuthError(mapped, process.env, event);
    }

    const confirmationRequired=!data.access_token;
    let confirmationEmail={sent:false,provider:null,reason:null};
    if(confirmationRequired){
      confirmationEmail=await sendSignupConfirmationEmail({
        email:emailCheck.value,
        fullName:body.fullName||"",
        shopName:body.shopName||"",
        origin,
        env:process.env
      });
      logAuthEvent(confirmationEmail.sent?"info":"warn",confirmationEmail.sent?"signup_confirmation_email_sent":"signup_confirmation_email_skipped",{
        email_domain:emailCheck.value.split("@")[1],
        provider:confirmationEmail.provider||null,
        reason:confirmationEmail.reason||null,
        mailer_configured:emailProviderConfigured(process.env).configured,
        request_id:requestId
      },event);
    }

    // Never mint florist sessions from signup. Login (and refresh) enforce shop membership.
    // Returning tokens here would let unattached accounts bypass that gate.
    logAuthEvent("info","signup_accepted",{user_id:data.user?.id||null,confirmation_required:confirmationRequired,confirmation_email_sent:Boolean(confirmationEmail.sent),session_tokens_omitted:true,request_id:requestId},event);
    return json(200,{
      accessToken:null,
      refreshToken:null,
      expiresIn:null,
      user:data.user?{id:data.user.id,email:data.user.email}:null,
      confirmationRequired,
      confirmationEmailSent:Boolean(confirmationEmail.sent),
      confirmationEmailProvider:confirmationEmail.provider||null,
      nextStep:confirmationRequired?"verify_email":"sign_in"
    },process.env,event);
  }catch(error){ return fail(error,process.env,event); }
}
