import { json,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail } from "./_shared/supabase.js";
import { shopDateStr,shopDateStrDaysAgo,weekdayLabel } from "./_shared/shop-time.js";
import { buildNeedsAttentionItems,needsAttentionSummaryText } from "../../lib/assistants/needs-attention.js";

export function localDate(value){return value?String(value).slice(0,10):""}
// todayStr comes from shopDateStr(shop.timezone) — the shop's own calendar
// day, not the server's. Both sides are anchored to UTC midnight of their
// Y-M-D string (not the server's own local time) so the day-count is
// portable regardless of what timezone this Node process happens to run in.
export function ageDays(date,todayStr){if(!date)return 0;const arrived=new Date(`${localDate(date)}T00:00:00Z`);const today=new Date(`${todayStr}T00:00:00Z`);return Math.max(0,Math.floor((today-arrived)/86400000))}
export function freshness(item,todayStr){const life=Math.max(1,Number(item.vase_life_days||7)),age=ageDays(item.arrival_date||item.created_at,todayStr);return Math.max(0,Math.round((1-age/life)*100))}

export async function handler(event){
 const ready=preflight(event);if(ready)return ready;if(event.httpMethod!=="GET")return methodNotAllowed();
 try{
  const {client,shopId}=await currentUser(event);
  const [shop,orders,inventory,customers,expenses,payments]=await Promise.all([
   client.from("shops").select("timezone").eq("id",shopId).maybeSingle(),
   client.from("orders").select("*").eq("shop_id",shopId).order("created_at",{ascending:false}),
   client.from("inventory").select("*").eq("shop_id",shopId).is("deleted_at",null).order("name"),
   client.from("customers").select("id,name,created_at").eq("shop_id",shopId).is("deleted_at",null),
   client.from("expenses").select("*").eq("shop_id",shopId).order("expense_date",{ascending:false}),
   client.from("payments").select("amount,received_at,status,refunded_amount").eq("shop_id",shopId).eq("status","SUCCEEDED")
  ]);for(const r of [orders,inventory,customers,expenses])if(r.error)throw r.error;
  const timezone=shop.data?.timezone,allOrders=orders.data||[],stock=inventory.data||[],allExpenses=expenses.data||[],ledger=payments.error?null:(payments.data||[]),today=shopDateStr(timezone);
  const paid=allOrders.filter(o=>o.payment_status==="PAID"&&o.status!=="CANCELLED");
  const netPayment=p=>Number(p.amount||0)-Number(p.refunded_amount||0);
  const totalSales=ledger?ledger.reduce((a,p)=>a+netPayment(p),0):paid.reduce((a,o)=>a+Number(o.total||0),0),totalExpenses=allExpenses.reduce((a,e)=>a+Number(e.amount||0),0);
  const todaySales=ledger?ledger.filter(p=>localDate(p.received_at)===today).reduce((a,p)=>a+netPayment(p),0):paid.filter(o=>localDate(o.paid_at||o.created_at)===today).reduce((a,o)=>a+Number(o.total||0),0);
  const activeDeliveries=allOrders.filter(o=>o.fulfillment==="DELIVERY"&&!['COMPLETED','CANCELLED'].includes(o.status));
  const dueToday=allOrders.filter(o=>localDate(o.delivery_date)===today&&!['COMPLETED','CANCELLED'].includes(o.status));
  const lowStock=stock.filter(i=>Number(i.quantity||0)<=Number(i.low_stock_level||0)).length;
  const unpaid=allOrders.filter(o=>o.payment_status!=="PAID"&&o.status!=="CANCELLED").reduce((a,o)=>a+Math.max(0,Number(o.total||0)-Number(o.amount_paid||0)),0);
  const freshStock=stock.filter(i=>['flowers','greenery'].includes(String(i.category||'').toLowerCase())).map(i=>({...i,age_days:ageDays(i.arrival_date||i.created_at,today),freshness_score:freshness(i,today)}));
  const useFirst=freshStock.filter(i=>Number(i.quantity||0)>0&&i.freshness_score<=55).sort((a,b)=>a.freshness_score-b.freshness_score).slice(0,5);
  const freshnessScore=freshStock.length?Math.round(freshStock.reduce((a,i)=>a+i.freshness_score,0)/freshStock.length):100;
  const marginOrders=paid.filter(o=>Number(o.total||0)>0);const marginHealth=marginOrders.length?Math.round(marginOrders.reduce((a,o)=>a+Math.max(0,Math.min(100,(Number(o.total||0)-Number(o.estimated_cost||0))/Number(o.total||1)*100)),0)/marginOrders.length):100;
  const wasteValue=useFirst.reduce((a,i)=>a+Number(i.quantity||0)*Number(i.cost||0),0);const wasteRisk=wasteValue>100?'High':wasteValue>30?'Medium':'Low';
  const profitScore=Math.max(0,Math.min(100,Math.round(freshnessScore*.45+marginHealth*.45+(wasteRisk==='Low'?100:wasteRisk==='Medium'?65:30)*.10)));
  const chosen=useFirst.slice(0,3);const dailySpecial=chosen.length?{name:`Fresh Pick ${chosen[0].color||chosen[0].name} Special`,items:chosen.map(i=>({name:i.name,color:i.color,quantity:Math.min(Number(i.quantity||0),i.category==='Greenery'?3:5),unit:i.unit,cost:i.cost})),wastePrevented:Number(chosen.reduce((a,i)=>a+Math.min(Number(i.quantity||0),5)*Number(i.cost||0),0).toFixed(2))}:null;
  const weeklySales=[];for(let n=6;n>=0;n--){const key=shopDateStrDaysAgo(timezone,n);weeklySales.push({label:weekdayLabel(key),total:ledger?ledger.filter(p=>localDate(p.received_at)===key).reduce((a,p)=>a+netPayment(p),0):paid.filter(o=>localDate(o.paid_at||o.created_at)===key).reduce((a,o)=>a+Number(o.total||0),0)})}
  // Lily Step 73 — the same real numbers below (ordersDueToday, deliveries,
  // lowStock, unpaidTotal) also drive a structured "needs attention" list,
  // not just Rose's spoken briefing. Single source of truth: computed once
  // here, never recomputed client-side.
  const needsAttentionItems=buildNeedsAttentionItems({ordersDueToday:dueToday.length,deliveries:activeDeliveries.length,lowStock,unpaidTotal:unpaid});
  return json(200,{todaySales,totalSales,totalExpenses,profit:totalSales-totalExpenses,unpaidTotal:unpaid,ordersDueToday:dueToday.length,deliveriesToday:activeDeliveries.length,deliveries:activeDeliveries.length,lowStock,customers:(customers.data||[]).length,weekSales:weeklySales.reduce((a,x)=>a+x.total,0),ordersToday:allOrders.filter(o=>localDate(o.created_at)===today).length,weeklySales,upcomingDeliveries:activeDeliveries.slice(0,5),profitIntelligence:{profitScore,freshnessScore,marginHealth,wasteRisk,wasteValue,useFirst,dailySpecial},needsAttention:{items:needsAttentionItems,summary:needsAttentionSummaryText(needsAttentionItems)}});
 }catch(error){return fail(error)}
}
