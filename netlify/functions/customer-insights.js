import { json,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";

const clean=value=>String(value||"").trim().toLowerCase();
const phoneDigits=value=>String(value||"").replace(/\D/g,"").slice(-10);
const localDate=value=>value?String(value).slice(0,10):"";

export async function handler(event){
 const ready=preflight(event);if(ready)return ready;
 if(event.httpMethod!=="GET")return methodNotAllowed();
 try{
  const {client,shopId}=await currentUser(event);
  const customerId=event.queryStringParameters?.customer_id;
  if(!customerId)throw new Error("Missing customer_id");
  const {data:customer,error:customerError}=await client.from("customers").select("*").eq("id",customerId).eq("shop_id",shopId).is("deleted_at",null).single();
  if(customerError)throw customerError;
  const [{data:orders,error:ordersError},{data:payments,error:paymentsError}]=await Promise.all([
   client.from("orders").select("*").eq("shop_id",shopId).order("created_at",{ascending:false}),
   client.from("payments").select("order_id,amount,refunded_amount,status,received_at,payment_method").eq("shop_id",shopId).eq("status","SUCCEEDED")
  ]);
  if(ordersError)throw ordersError;
  const wantedName=clean(customer.name),wantedPhone=phoneDigits(customer.phone);
  const matches=(orders||[]).filter(order=>{
   const nameMatch=wantedName&&clean(order.customer_name)===wantedName;
   const orderPhone=phoneDigits(order.customer_phone);
   const phoneMatch=wantedPhone&&orderPhone&&orderPhone===wantedPhone;
   return phoneMatch||nameMatch;
  });
  const orderIds=new Set(matches.map(x=>x.id));
  const ledger=(paymentsError?[]:(payments||[])).filter(x=>orderIds.has(x.order_id));
  const paymentTotal=ledger.reduce((sum,p)=>sum+Number(p.amount||0)-Number(p.refunded_amount||0),0);
  const bookedTotal=matches.filter(x=>x.status!=="CANCELLED").reduce((sum,o)=>sum+Number(o.total||0),0);
  const outstanding=matches.filter(x=>x.status!=="CANCELLED").reduce((sum,o)=>sum+Math.max(0,Number(o.total||0)-Number(o.amount_paid||0)),0);
  const recipients=[...new Set(matches.map(x=>x.recipient_name).filter(Boolean))].slice(0,12);
  const occasions=[...new Set(matches.map(x=>x.occasion).filter(Boolean))].slice(0,12);
  const lastOrder=matches[0]||null;
  return json(200,{customer,summary:{orderCount:matches.length,lifetimeValue:paymentTotal||bookedTotal,outstanding,averageOrder:matches.length?bookedTotal/matches.length:0,lastOrderDate:localDate(lastOrder?.created_at),recipients,occasions},orders:matches.slice(0,25),payments:ledger.slice(0,25)});
 }catch(error){return fail(error)}
}
