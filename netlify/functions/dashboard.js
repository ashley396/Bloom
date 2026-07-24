import { json,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";

function localDate(value){
  if(!value) return "";
  return String(value).slice(0,10);
}

export async function handler(event){
  const ready=preflight(event); if(ready) return ready;
  if(event.httpMethod!=="GET") return methodNotAllowed();
  try{
    const {client,shopId}=await currentUser(event);
    const [orders,inventory,customers,expenses]=await Promise.all([
      client.from("orders").select("*").eq("shop_id",shopId).order("created_at",{ascending:false}),
      client.from("inventory").select("*").eq("shop_id",shopId).is("deleted_at",null).order("name"),
      client.from("customers").select("id,name,created_at").eq("shop_id",shopId).is("deleted_at",null),
      client.from("expenses").select("*").eq("shop_id",shopId).order("expense_date",{ascending:false})
    ]);
    for(const r of [orders,inventory,customers,expenses]) if(r.error) throw r.error;

    const allOrders=orders.data||[], allExpenses=expenses.data||[], today=new Date().toISOString().slice(0,10);
    const paidOrders=allOrders.filter(o=>o.payment_status==="PAID"&&o.status!=="CANCELLED");
    const sales=paidOrders.reduce((a,o)=>a+Number(o.total||0),0);
    const expenseTotal=allExpenses.reduce((a,e)=>a+Number(e.amount||0),0);
    const todaySales=paidOrders.filter(o=>localDate(o.paid_at||o.created_at)===today).reduce((a,o)=>a+Number(o.total||0),0);

    const weeklySales=[];
    for(let offset=6;offset>=0;offset--){
      const date=new Date(); date.setUTCHours(0,0,0,0); date.setUTCDate(date.getUTCDate()-offset);
      const key=date.toISOString().slice(0,10);
      weeklySales.push({date:key,label:date.toLocaleDateString("en-US",{weekday:"short",timeZone:"UTC"}),total:paidOrders.filter(o=>localDate(o.paid_at||o.created_at)===key).reduce((a,o)=>a+Number(o.total||0),0)});
    }

    const activeOrders=allOrders.filter(o=>!["COMPLETED","CANCELLED"].includes(o.status));
    const deliveryOrders=activeOrders.filter(o=>o.fulfillment==="DELIVERY");
    const lowStockItems=(inventory.data||[]).filter(i=>Number(i.quantity)<=Number(i.low_stock_level));
    const ordersDueToday=activeOrders.filter(o=>localDate(o.delivery_date)===today).length;
    const deliveriesToday=deliveryOrders.filter(o=>localDate(o.delivery_date)===today).length;

    return json(200,{
      ordersToday:allOrders.filter(o=>localDate(o.created_at)===today).length,
      ordersDueToday,
      totalSales:sales,
      todaySales,
      weekSales:weeklySales.reduce((a,x)=>a+x.total,0),
      weeklySales,
      totalExpenses:expenseTotal,
      profit:sales-expenseTotal,
      unpaidTotal:activeOrders.filter(o=>o.payment_status!=="PAID").reduce((a,o)=>a+Number(o.total||0),0),
      deliveries:deliveryOrders.length,
      deliveriesToday,
      lowStock:lowStockItems.length,
      lowStockItems:lowStockItems.slice(0,5),
      customers:(customers.data||[]).length,
      queue:activeOrders.slice(0,10),
      upcomingDeliveries:deliveryOrders.sort((a,b)=>String(a.delivery_date||"").localeCompare(String(b.delivery_date||""))).slice(0,5),
      recentExpenses:allExpenses.slice(0,5)
    });
  }catch(error){ return fail(error); }
}
