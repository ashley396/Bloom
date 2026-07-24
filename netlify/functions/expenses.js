import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";
export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  try{
    const {client,shopId}=await currentUser(event);
    if(event.httpMethod==="GET"){
      const {data,error}=await client.from("expenses").select("*").eq("shop_id",shopId).order("expense_date",{ascending:false});
      if(error) throw error; return json(200,{items:data||[]});
    }
    if(event.httpMethod==="POST"){
      const body=bodyOf(event);
      if(!body.amount) return json(400,{error:"Required field missing"});
      const payload={shop_id:shopId,expense_date:body.expense_date||new Date().toISOString().slice(0,10),category:body.category||"Other",vendor:body.vendor||null,amount:Number(body.amount||0),notes:body.notes||null};
      const {data,error}=await client.from("expenses").insert(payload).select().single();
      if(error) throw error; return json(201,{item:data});
    }
    return methodNotAllowed();
  }catch(error){ return fail(error); }
}
