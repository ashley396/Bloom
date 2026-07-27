import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { publicSettings, fail } from "./_shared/supabase.js";
export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  if(event.httpMethod!=="POST") return methodNotAllowed();
  try{
    const body=bodyOf(event); const {url,anonKey}=publicSettings();
    const siteUrl=(process.env.DEPLOY_PRIME_URL||process.env.SITE_URL||process.env.URL||"https://bloom-technologies.netlify.app").replace(/\/$/,"");
    const response=await fetch(`${url}/auth/v1/signup?redirect_to=${encodeURIComponent(`${siteUrl}/login.html?confirmed=1`)}`,{
      method:"POST",headers:{"Content-Type":"application/json",apikey:anonKey,Authorization:`Bearer ${anonKey}`},
      body:JSON.stringify({email:body.email,password:body.password,data:{full_name:body.fullName||"",shop_name:body.shopName||"My Flower Shop",business_phone:body.businessPhone||"",business_type:body.businessType||"",business_address:body.businessAddress||"",business_city:body.businessCity||"",business_state:body.businessState||"",business_zip:body.businessZip||"",plan_code:["starter","pro","premium"].includes(body.planCode)?body.planCode:"pro",subscription_price:[39,79,129].includes(Number(body.subscriptionPrice))?Number(body.subscriptionPrice):79,trial_days:14,trial_started_at:new Date().toISOString()}})
    });
    const data=await response.json();
    if(!response.ok) return json(response.status,{error:data.msg||data.message||"Could not create account"});
    return json(200,{accessToken:data.access_token||null,refreshToken:data.refresh_token||null,expiresIn:data.expires_in||null,user:data.user||null,confirmationRequired:!data.access_token});
  }catch(error){ return fail(error); }
}
