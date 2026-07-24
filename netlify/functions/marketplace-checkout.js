import Stripe from "stripe";
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
export async function handler(event){
 const ready=preflight(event);if(ready)return ready;if(event.httpMethod!=="POST")return methodNotAllowed();
 try{
  if(!process.env.STRIPE_SECRET_KEY){const e=new Error("STRIPE_SECRET_KEY is not configured in Netlify.");e.statusCode=503;throw e}
  const stripe=new Stripe(process.env.STRIPE_SECRET_KEY),{client,user}=await currentUser(event),body=bodyOf(event);
  const {data:item,error}=await client.from("marketplace_listings").select("id,name,price,supplier_id,suppliers(stripe_connect_account_id)").eq("id",body.listing_id).single();if(error)throw error;
  const destination=item.suppliers?.stripe_connect_account_id;if(!destination)return json(409,{error:"This supplier has not completed Stripe Connect onboarding."});
  const qty=Math.max(1,Number(body.quantity||1)),amount=Math.round(Number(item.price)*qty*100),fee=Math.round(amount*(Number(process.env.BLOOM_MARKETPLACE_FEE_PERCENT||5)/100));
  const site=(process.env.SITE_URL||event.headers.origin||"").replace(/\/$/,"");
  const session=await stripe.checkout.sessions.create({mode:"payment",customer_email:user.email,line_items:[{quantity:qty,price_data:{currency:"usd",unit_amount:Math.round(Number(item.price)*100),product_data:{name:item.name}}}],payment_intent_data:{application_fee_amount:fee,transfer_data:{destination}},success_url:`${site}/?marketplace=success`,cancel_url:`${site}/?marketplace=cancelled`,metadata:{listing_id:item.id}});
  return json(200,{url:session.url});
 }catch(error){return fail(error)}
}
