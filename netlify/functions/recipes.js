import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";
export async function handler(event){
 const ready=preflight(event);if(ready)return ready;
 try{
  const {client,shopId}=await currentUser(event);
  const productId=event.queryStringParameters?.product_id;
  if(event.httpMethod==="GET"){
   if(!productId)throw new Error("Missing product_id");
   const {data,error}=await client.from("product_recipes").select("*").eq("shop_id",shopId).eq("product_id",productId).order("created_at");
   if(error)throw error;return json(200,{items:data||[]});
  }
  if(event.httpMethod==="POST"){
   const body=bodyOf(event);if(!body.product_id)throw new Error("Missing product_id");
   const rows=(body.items||[]).filter(x=>x.ingredient_name).map(x=>({shop_id:shopId,product_id:body.product_id,inventory_id:x.inventory_id||null,ingredient_name:x.ingredient_name,quantity:Number(x.quantity||1),unit:x.unit||"stem",unit_cost:Number(x.unit_cost||0)}));
   const {error:delError}=await client.from("product_recipes").delete().eq("shop_id",shopId).eq("product_id",body.product_id);if(delError)throw delError;
   if(rows.length){const {error}=await client.from("product_recipes").insert(rows);if(error)throw error;}
   return json(200,{ok:true});
  }
  return methodNotAllowed();
 }catch(error){return fail(error)}
}
