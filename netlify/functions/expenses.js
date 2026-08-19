import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";
import { shopDateStr } from "./_shared/shop-time.js";

function parseDataUrl(value){
  const match=String(value||"").match(/^data:([^;]+);base64,(.+)$/);
  if(!match) return null;
  return {mime:match[1],buffer:Buffer.from(match[2],"base64")};
}
async function uploadReceipt(client,shopId,value){
  const file=parseDataUrl(value); if(!file)return null;
  if(file.buffer.length>5*1024*1024)throw new Error("Receipt image must be under 5 MB");
  const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","application/pdf":"pdf"}[file.mime]||"bin";
  const path=`${shopId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const {error}=await client.storage.from("expense-receipts").upload(path,file.buffer,{contentType:file.mime,upsert:false});
  if(error)throw error; return path;
}
export async function handler(event){
  const ready=preflight(event); if(ready)return ready;
  try{
    const {client,shopId}=await currentUser(event);
    if(event.httpMethod==="GET"){
      const {data,error}=await client.from("expenses").select("*").eq("shop_id",shopId).order("expense_date",{ascending:false});
      if(error)throw error;
      const items=await Promise.all((data||[]).map(async item=>{if(!item.receipt_path)return item;const {data:signed}=await client.storage.from("expense-receipts").createSignedUrl(item.receipt_path,3600);return {...item,receipt_url:signed?.signedUrl||null}}));
      return json(200,{items});
    }
    if(event.httpMethod==="POST"){
      const body=bodyOf(event);if(!body.amount||Number(body.amount)<=0)return json(400,{error:"Expense amount is required"});
      const receiptPath=await uploadReceipt(client,shopId,body.receipt_data_url);
      let expenseDate=body.expense_date;
      if(!expenseDate){
        // No date supplied — default to the shop's own today, not the
        // server's UTC day (an evening entry in any US timezone would
        // otherwise get dated tomorrow).
        const {data:shop}=await client.from("shops").select("timezone").eq("id",shopId).maybeSingle();
        expenseDate=shopDateStr(shop?.timezone);
      }
      const payload={shop_id:shopId,expense_date:expenseDate,category:body.category||"Other",vendor:body.vendor||null,amount:Number(body.amount),notes:body.notes||null,receipt_path:receiptPath};
      const {data,error}=await client.from("expenses").insert(payload).select().single();if(error)throw error;return json(201,{item:data});
    }
    if(event.httpMethod==="PATCH"){
      const body=bodyOf(event);if(!body.id)throw new Error("Missing expense id");if(!body.amount||Number(body.amount)<=0)return json(400,{error:"Expense amount is required"});
      const {data:existing,error:readError}=await client.from("expenses").select("*").eq("id",body.id).eq("shop_id",shopId).single();if(readError)throw readError;
      let receiptPath=existing.receipt_path;const replacement=await uploadReceipt(client,shopId,body.receipt_data_url);
      if(replacement){receiptPath=replacement;if(existing.receipt_path)await client.storage.from("expense-receipts").remove([existing.receipt_path]);}
      const payload={expense_date:body.expense_date||existing.expense_date,category:body.category||"Other",vendor:body.vendor||null,amount:Number(body.amount),notes:body.notes||null,receipt_path:receiptPath};
      const {data,error}=await client.from("expenses").update(payload).eq("id",body.id).eq("shop_id",shopId).select().single();if(error)throw error;return json(200,{item:data});
    }
    if(event.httpMethod==="DELETE"){
      const body=bodyOf(event);if(!body.id)throw new Error("Missing expense id");
      const {data:existing}=await client.from("expenses").select("receipt_path").eq("id",body.id).eq("shop_id",shopId).maybeSingle();
      const {error}=await client.from("expenses").delete().eq("id",body.id).eq("shop_id",shopId);if(error)throw error;
      if(existing?.receipt_path)await client.storage.from("expense-receipts").remove([existing.receipt_path]);return json(200,{ok:true});
    }
    return methodNotAllowed();
  }catch(error){return fail(error)}
}
