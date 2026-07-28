import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";

const TABLE = "marketplace_listings";
const FIELDS = ["supplier_name", "product_name", "category", "category_slug", "unit", "price", "minimum_quantity", "available_quantity", "image_url", "description", "delivery_notes", "active", "sku", "low_stock_threshold", "allows_shipping", "allows_local_pickup"];
const ORDER = "created_at";

export async function handler(event){
  const ready=preflight(event); if(ready)return ready;
  try{
    const {client,shopId}=await currentUser(event);
    if(event.httpMethod==="GET"){
      let q=client.from(TABLE).select("*").eq("shop_id",shopId);
      if(TABLE==="products")q=q.is("deleted_at",null);
      const {data,error}=await q.order(ORDER,{ascending:false});
      if(error)throw error; return json(200,{items:data||[]});
    }
    if(event.httpMethod==="POST"){
      const body=bodyOf(event),payload={shop_id:shopId};
      for(const f of FIELDS)if(f in body)payload[f]=body[f];
      const {data,error}=await client.from(TABLE).insert(payload).select("*").single();
      if(error)throw error; return json(201,{item:data});
    }
    if(event.httpMethod==="PATCH"){
      const body=bodyOf(event); if(!body.id)throw new Error("Missing id");
      const payload={}; for(const f of FIELDS)if(f in body)payload[f]=body[f];
      const {data,error}=await client.from(TABLE).update(payload).eq("id",body.id).eq("shop_id",shopId).select("*").single();
      if(error)throw error; return json(200,{item:data});
    }
    if(event.httpMethod==="DELETE"){
      const body=bodyOf(event); if(!body.id)throw new Error("Missing id");
      const query=TABLE==="products"
        ? client.from(TABLE).update({deleted_at:new Date().toISOString()}).eq("id",body.id).eq("shop_id",shopId)
        : client.from(TABLE).delete().eq("id",body.id).eq("shop_id",shopId);
      const {error}=await query; if(error)throw error; return json(200,{ok:true});
    }
    return methodNotAllowed();
  }catch(error){return fail(error)}
}
