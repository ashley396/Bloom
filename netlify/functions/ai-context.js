import { json, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";

export async function handler(event){
  const ready=preflight(event);if(ready)return ready;
  if(event.httpMethod!=="GET")return methodNotAllowed();
  try{
    const {client,shopId}=await currentUser(event);
    const [
      {data:shop},{data:inventory},{data:orders},{data:deliveries},
      {data:products},{data:customers},{data:recipeRows},{data:staff},
      {data:aiProfile}
    ]=await Promise.all([
      client.from("shops").select("name,address,phone,tagline").eq("id",shopId).maybeSingle(),
      client.from("inventory").select("name,color,variety,quantity,unit,low_stock_level,cost,price,arrival_date,vase_life_days").eq("shop_id",shopId).order("created_at",{ascending:false}).limit(30),
      client.from("orders").select("order_number,customer_name,total,payment_status,delivery_date,status,estimated_cost,occasion,fulfillment").eq("shop_id",shopId).order("created_at",{ascending:false}).limit(15),
      client.from("deliveries").select("status,recipient_name,address,delivery_date").eq("shop_id",shopId).order("delivery_date",{ascending:true}).limit(12),
      // Real catalog Lily can recommend from and price accurately. Never
      // description/gallery/SEO fields — those are long-form copy Lily
      // doesn't need just to talk about what the shop sells.
      client.from("products").select("name,category,price,available_online,featured").eq("shop_id",shopId).is("deleted_at",null).eq("active",true).order("created_at",{ascending:false}).limit(40),
      // Never phone/email/address/notes here — same discipline as
      // lib/marketing/audience-segments.js: Lily can reference a customer
      // by name and status, never surface their contact info through an
      // AI response.
      client.from("customers").select("name,vip,is_business").eq("shop_id",shopId).is("deleted_at",null).order("created_at",{ascending:false}).limit(30),
      // Real bills-of-materials so Lily can answer "what's in X" or reason
      // about ingredient cost — joined to the product name since
      // product_recipes only stores product_id.
      client.from("product_recipes").select("ingredient_name,quantity,unit,unit_cost,products(name)").eq("shop_id",shopId).order("created_at",{ascending:false}).limit(60),
      // Public staff-front-page fields only (see staff.js
      // PUBLIC_STAFF_FIELDS) — never pay/tax/contact/PIN.
      client.from("staff").select("name").eq("shop_id",shopId).eq("active",true).order("created_at",{ascending:false}).limit(20),
      // The florist's onboarding-collected shop voice + delivery/marketing
      // notes (see complete-florist-onboarding.js) — was captured and never
      // read anywhere; included here so it reaches the assistant chat path.
      client.from("ai_shop_profiles").select("lily_enabled,rose_enabled,shop_tone,delivery_notes,marketing_notes").eq("shop_id",shopId).maybeSingle()
    ]);
    const recipes=(recipeRows||[]).map(r=>({
      product_name:r.products?.name||null,
      ingredient_name:r.ingredient_name,
      quantity:r.quantity,
      unit:r.unit,
      unit_cost:r.unit_cost
    }));
    return json(200,{context:{
      shop:shop||{},
      inventory:inventory||[],
      recent_orders:orders||[],
      deliveries:deliveries||[],
      products:products||[],
      customers:customers||[],
      recipes,
      staff:staff||[],
      ai_profile:aiProfile||null
    }});
  }catch(error){return fail(error)}
}
