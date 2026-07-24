import Stripe from "stripe";
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";

export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  if(!["GET","POST"].includes(event.httpMethod)) return methodNotAllowed();
  try{
    if(!process.env.STRIPE_SECRET_KEY){const e=new Error("STRIPE_SECRET_KEY is not configured in Netlify.");e.statusCode=503;throw e}
    const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
    const {client,shopId,user}=await currentUser(event);
    const {data:shop,error}=await client.from("shops").select("id,name,stripe_connect_account_id").eq("id",shopId).single(); if(error)throw error;
    if(event.httpMethod==="GET"){
      if(!shop.stripe_connect_account_id)return json(200,{connected:false});
      const account=await stripe.accounts.retrieve(shop.stripe_connect_account_id);
      return json(200,{connected:true,accountId:account.id,chargesEnabled:account.charges_enabled,payoutsEnabled:account.payouts_enabled,detailsSubmitted:account.details_submitted});
    }
    const body=bodyOf(event),site=(process.env.SITE_URL||event.headers.origin||"").replace(/\/$/,"");
    let accountId=shop.stripe_connect_account_id;
    if(!accountId){
      const account=await stripe.accounts.create({type:"express",country:"US",email:user.email,capabilities:{card_payments:{requested:true},transfers:{requested:true}},business_profile:{name:shop.name},metadata:{bloom_shop_id:shopId}});
      accountId=account.id;
      const {error:updateError}=await client.from("shops").update({stripe_connect_account_id:accountId}).eq("id",shopId);if(updateError)throw updateError;
    }
    if(body.action==="dashboard"){
      const link=await stripe.accounts.createLoginLink(accountId);return json(200,{url:link.url});
    }
    const link=await stripe.accountLinks.create({account:accountId,refresh_url:`${site}/?connect=refresh`,return_url:`${site}/?connect=complete`,type:"account_onboarding"});
    return json(200,{url:link.url});
  }catch(error){return fail(error)}
}
