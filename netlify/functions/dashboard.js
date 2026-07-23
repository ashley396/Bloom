import { json,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";
export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  if(event.httpMethod!=="GET") return methodNotAllowed();
  try{
    const {client,shopId}=await currentUser(event);
    const [orders,inventory,customers,expenses]=await Promise.all([
      client.from("orders").select("*").eq("shop_id",shopId).order("created_at",{ascending:false}),
      client.from("inventory").select("*").eq("shop_id",shopId).is("deleted_at",null).order("name"),
      client.from("customers").select("id").eq("shop_id",shopId).is("deleted_at",null),
      client.from("expenses").select("*").eq("shop_id",shopId).order("expense_date",{ascending:false})
    ]);
    for(const r of [orders,inventory,customers,expenses]) if(r.error) throw r.error;
    const allOrders=orders.data||[], allExpenses=expenses.data||[], today=new Date().toISOString().slice(0,10);
    const sales=allOrders.filter(o=>o.status!=="CANCELLED").reduce((a,o)=>a+Number(o.total||0),0);
    const expenseTotal=allExpenses.reduce((a,e)=>a+Number(e.amount||0),0);
    return json(200,{
      ordersToday:allOrders.filter(o=>String(o.created_at).slice(0,10)===today).length,
      totalSales:sales,totalExpenses:expenseTotal,profit:sales-expenseTotal,
      deliveries:allOrders.filter(o=>o.fulfillment==="DELIVERY"&&!["COMPLETED","CANCELLED"].includes(o.status)).length,
      lowStock:(inventory.data||[]).filter(i=>Number(i.quantity)<=Number(i.low_stock_level)).length,
      customers:(customers.data||[]).length,
      queue:allOrders.filter(o=>!["COMPLETED","CANCELLED"].includes(o.status)).slice(0,10)
    });
  }catch(error){ return fail(error); }
}
