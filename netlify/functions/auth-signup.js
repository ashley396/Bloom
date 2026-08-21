import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { publicSettings, fail } from "./_shared/supabase.js";
import { authRedirectPath } from "./_shared/site-url.js";
import { checkRateLimit } from "./_shared/production.js";
import { fetchWithTimeout, requestIdOf } from "./_shared/upstream.js";
import { validateEmail } from "./_shared/validation.js";
import { logAuthEvent, mapAuthProviderFailure, jsonAuthError } from "./_shared/auth-email.js";
import { signUpWithBrandedConfirmation } from "./_shared/auth-confirmation-email.js";
import { planPrice, validSubscriptionPrices } from "./_shared/shop-billing.js";

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
    const userMetadata={full_name:body.fullName||"",shop_name:body.shopName||"My Flower Shop",business_phone:body.businessPhone||"",business_type:body.businessType||"",business_address:body.businessAddress||"",business_city:body.businessCity||"",business_state:body.businessState||"",business_zip:body.businessZip||"",plan_code:["starter","pro","premium"].includes(body.planCode)?body.planCode:"pro",subscription_price:validSubscriptionPrices().includes(Number(body.subscriptionPrice))?Number(body.subscriptionPrice):planPrice("professional"),billing_interval:body.billingInterval==="annual"?"annual":"monthly",referral_code:body.referralCode||null,trial_days:14,trial_started_at:new Date().toISOString()};

    // Preferred path: create the Supabase user via the Admin API and send
    // our own branded confirmation email — no default Supabase email goes
    // out, so there's only ever one confirmation token in play (see
    // signUpWithBrandedConfirmation for why the old flow raced two tokens
    // against each other). Falls through to the legacy public-signup path
    // below only when this never created an account in the first place —
    // never after a real account exists, or a fresh signup would be
    // rejected as "already registered".
    const branded=await signUpWithBrandedConfirmation({
      email:emailCheck.value,password,userMetadata,
      fullName:body.fullName||"",shopName:body.shopName||"My Flower Shop",
      origin,env:process.env
    }).catch((error)=>({ok:false,code:error?.code||error?.message||"branded_signup_failed"}));

    if(branded.code==="account_already_registered"){
      logAuthEvent("warn","signup_failed",{email_domain:emailCheck.value.split("@")[1],code:"account_already_registered",request_id:requestId},event);
      return json(400,{error:"An account with this email may already exist. Sign in or use Forgot Password.",code:"account_already_registered"});
    }

    if(branded.user){
      const confirmationEmailSent=Boolean(branded.sent);
      const confirmationEmailProvider=branded.provider||null;
      if(!confirmationEmailSent){
        logAuthEvent("warn","signup_confirmation_email_not_sent",{user_id:branded.user.id,code:branded.code||"confirmation_email_failed",provider:confirmationEmailProvider,request_id:requestId},event);
      }
      logAuthEvent("info","signup_accepted",{user_id:branded.user.id,confirmation_required:true,confirmation_email_sent:confirmationEmailSent,confirmation_email_provider:confirmationEmailProvider,request_id:requestId},event);
      return json(200,{accessToken:null,refreshToken:null,expiresIn:null,user:branded.user,confirmationRequired:true,confirmationEmailSent,confirmationEmailProvider});
    }

    if(!branded.ok){
      logAuthEvent("warn","signup_branded_path_unavailable",{email_domain:emailCheck.value.split("@")[1],code:branded.code||"branded_signup_failed",request_id:requestId},event);
    }

    // Legacy path: no branded email provider configured, or the branded
    // path failed before creating any Supabase user. Supabase's own
    // default confirmation email is the delivery mechanism here, same as
    // before this fix.
    const response=await fetchWithTimeout(`${url}/auth/v1/signup?redirect_to=${encodeURIComponent(confirmUrl)}`,{
      method:"POST",headers:{"Content-Type":"application/json",apikey:anonKey,Authorization:`Bearer ${anonKey}`},
      body:JSON.stringify({email:emailCheck.value,password,data:userMetadata})
    },{timeoutMs:5_000,service:"Account creation service"});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const mapped=mapAuthProviderFailure(response,data,{flow:"signup"});
      logAuthEvent("warn","signup_failed",{email_domain:emailCheck.value.split("@")[1],provider_status:response.status,code:mapped.code,request_id:requestId},event);
      return jsonAuthError(mapped);
    }
    logAuthEvent("info","signup_accepted",{user_id:data.user?.id||null,confirmation_required:!data.access_token,confirmation_email_sent:false,confirmation_email_provider:null,request_id:requestId},event);
    return json(200,{accessToken:data.access_token||null,refreshToken:data.refresh_token||null,expiresIn:data.expires_in||null,user:data.user||null,confirmationRequired:!data.access_token,confirmationEmailSent:false,confirmationEmailProvider:null});
  }catch(error){ return fail(error); }
}
