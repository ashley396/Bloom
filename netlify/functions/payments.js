import crypto from "node:crypto";
import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail,requireRoles } from "./_shared/supabase.js";
const ALLOWED=["owner","manager","cashier","accountant"];
export async function handler(event){const ready=preflight(event);if(ready)return ready;try{const ctx=await currentUser(event);requireRoles(ctx,ALLOWED);const {client,shopId,user}=ctx;
 if(event.httpMethod==="GET"){const {data,error}=await client.from("payments").select("*").eq("shop_id",shopId).order("received_at",{ascending:false}).limit(500);if(error)throw error;return json(200,{items:data||[]})}
 if(event.httpMethod==="POST"){const body=bodyOf(event),amount=Math.round(Number(body.amount||0)*100)/100,method=String(body.method||"Other");if(!body.order_id)return json(400,{error:"Choose an order first."});if(!Number.isFinite(amount)||amount<=0)return json(400,{error:"Enter a valid payment amount."});if(!["Cash","Check","Gift Card","Store Credit","Other"].includes(method))return json(400,{error:"Invalid manual payment method."});const key=String(body.idempotency_key||crypto.randomUUID());const {data,error}=await client.rpc("post_order_payment",{p_shop_id:shopId,p_order_id:body.order_id,p_amount:amount,p_method:method,p_idempotency_key:key,p_actor_user_id:user.id,p_processor:"manual",p_metadata:{source:"Bloom payments page"}});if(error)throw error;return json(201,data)}
 return methodNotAllowed();}catch(error){return fail(error)}}
