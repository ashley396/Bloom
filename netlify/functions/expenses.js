import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";

function parseDataUrl(value){
  const match=String(value||"").match(/^data:([^;]+);base64,(.+)$/);
  if(!match) return null;
  return {mime:match[1],buffer:Buffer.from(match[2],"base64")};
}
export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  try{
    const {client,shopId}=await currentUser(event);
    if(event.httpMethod==="GET"){
      const {data,error}=await client.from("expenses").select("*").eq("shop_id",shopId).order("expense_date",{ascending:false});
      if(error) throw error;
      const items=await Promise.all((data||[]).map(async item=>{
        if(!item.receipt_path) return item;
        const {data:signed}=await client.storage.from("expense-receipts").createSignedUrl(item.receipt_path,3600);
        return {...item,receipt_url:signed?.signedUrl||null};
      }));
      return json(200,{items});
    }
    if(event.httpMethod==="POST"){
      const body=bodyOf(event);
      if(!body.amount || Number(body.amount)<=0) return json(400,{error:"Expense amount is required"});
      let receiptPath=null;
      const file=parseDataUrl(body.receipt_data_url);
      if(file){
        if(file.buffer.length>5*1024*1024) return json(400,{error:"Receipt image must be under 5 MB"});
        const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","application/pdf":"pdf"}[file.mime]||"bin";
        receiptPath=`${shopId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const {error:uploadError}=await client.storage.from("expense-receipts").upload(receiptPath,file.buffer,{contentType:file.mime,upsert:false});
        if(uploadError) throw uploadError;
      }
      const payload={shop_id:shopId,expense_date:body.expense_date||new Date().toISOString().slice(0,10),category:body.category||"Other",vendor:body.vendor||null,amount:Number(body.amount),notes:body.notes||null,receipt_path:receiptPath};
      const {data,error}=await client.from("expenses").insert(payload).select().single();
      if(error) throw error; return json(201,{item:data});
    }

    if(event.httpMethod==="PATCH"){
      const body=bodyOf(event);
      if(!body.id) return json(400,{error:"Expense id is required"});
      if(!body.amount || Number(body.amount)<=0) return json(400,{error:"Expense amount is required"});
      const {data:existing,error:existingError}=await client.from("expenses").select("*").eq("id",body.id).eq("shop_id",shopId).single();
      if(existingError) throw existingError;
      let receiptPath=existing.receipt_path||null;
      const file=parseDataUrl(body.receipt_data_url);
      if(file){
        if(file.buffer.length>5*1024*1024) return json(400,{error:"Receipt image must be under 5 MB"});
        const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","application/pdf":"pdf"}[file.mime]||"bin";
        const newPath=`${shopId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const {error:uploadError}=await client.storage.from("expense-receipts").upload(newPath,file.buffer,{contentType:file.mime,upsert:false});
        if(uploadError) throw uploadError;
        if(receiptPath) await client.storage.from("expense-receipts").remove([receiptPath]);
        receiptPath=newPath;
      }
      const payload={expense_date:body.expense_date||existing.expense_date,category:body.category||"Other",vendor:body.vendor||null,amount:Number(body.amount),notes:body.notes||null,receipt_path:receiptPath};
      const {data,error}=await client.from("expenses").update(payload).eq("id",body.id).eq("shop_id",shopId).select().single();
      if(error) throw error; return json(200,{item:data});
    }
    if(event.httpMethod==="DELETE"){
      const body=bodyOf(event);
      if(!body.id) return json(400,{error:"Expense id is required"});
      const {data:existing,error:existingError}=await client.from("expenses").select("receipt_path").eq("id",body.id).eq("shop_id",shopId).single();
      if(existingError) throw existingError;
      const {error}=await client.from("expenses").delete().eq("id",body.id).eq("shop_id",shopId);
      if(error) throw error;
      if(existing?.receipt_path) await client.storage.from("expense-receipts").remove([existing.receipt_path]);
      return json(200,{ok:true});
    }
    return methodNotAllowed();
  }catch(error){ return fail(error); }
}
