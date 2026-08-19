import { json,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail,requireRoles } from "./_shared/supabase.js";
import { shopDateStr } from "./_shared/shop-time.js";

/**
 * Pure aggregation, kept separate from the handler (same shape as
 * dashboard.js's exported localDate/ageDays/freshness) so the real bug
 * found in the money/date audit — revenue bucketed by month using the
 * order's raw UTC paid_at/created_at timestamp instead of the shop's own
 * calendar month — can be tested without mocking Supabase at all.
 *
 * A sale paid at, say, 9pm Pacific on August 31st is already Sept 1st in
 * UTC; slicing the raw timestamp string put that month's last day of
 * revenue into next month's bucket. expense_date is a plain `date`
 * column with no time-of-day component (see the migration), so it has
 * no such ambiguity and is sliced as-is.
 */
export function buildFinanceReport(orders = [], expenses = [], timezone){
  const months={},categoryTotals={};
  let totalRevenue=0,totalExpenses=0;
  for(const row of orders){
    const paid=String(row.payment_status||"").toUpperCase()==="PAID";
    const cancelled=String(row.status||"").toUpperCase()==="CANCELLED";
    if(!paid||cancelled)continue;
    const amount=Number(row.total||0);
    if(!Number.isFinite(amount))continue;
    const instant=row.paid_at||row.created_at;
    if(!instant)continue;
    const parsed=new Date(instant);
    if(Number.isNaN(parsed.getTime()))continue;
    const key=shopDateStr(timezone,parsed).slice(0,7);
    if(!/^\d{4}-\d{2}$/.test(key))continue;
    months[key]??={month:key,revenue:0,expenses:0,profit:0};
    months[key].revenue+=amount;totalRevenue+=amount;
  }
  for(const row of expenses){
    const amount=Number(row.amount||0);
    if(!Number.isFinite(amount))continue;
    const key=String(row.expense_date||"").slice(0,7),category=String(row.category||"Other");
    if(/^\d{4}-\d{2}$/.test(key)){months[key]??={month:key,revenue:0,expenses:0,profit:0};months[key].expenses+=amount}
    categoryTotals[category]=(categoryTotals[category]||0)+amount;totalExpenses+=amount;
  }
  const items=Object.values(months).sort((a,b)=>b.month.localeCompare(a.month)).map(x=>({...x,profit:x.revenue-x.expenses}));
  const categories=Object.entries(categoryTotals).sort((a,b)=>b[1]-a[1]).map(([category,amount])=>({category,amount,percent:totalExpenses?amount/totalExpenses*100:0}));
  const profit=totalRevenue-totalExpenses,margin=totalRevenue?profit/totalRevenue*100:0;
  return {items,categories,totals:{revenue:totalRevenue,expenses:totalExpenses,profit,margin}};
}

export async function handler(event){
  const ready=preflight(event);if(ready)return ready;
  if(event.httpMethod!=="GET")return methodNotAllowed();
  try{
    const ctx=await currentUser(event);requireRoles(ctx,['owner', 'manager', 'accountant']);const {client,shopId}=ctx;
    const [ordersResult,expensesResult,shopResult]=await Promise.all([
      client.from("orders").select("total,payment_status,status,paid_at,created_at").eq("shop_id",shopId),
      client.from("expenses").select("amount,expense_date,category").eq("shop_id",shopId),
      client.from("shops").select("timezone").eq("id",shopId).maybeSingle()
    ]);
    if(ordersResult.error)throw ordersResult.error;
    if(expensesResult.error)throw expensesResult.error;

    const report=buildFinanceReport(ordersResult.data||[],expensesResult.data||[],shopResult.data?.timezone);
    return json(200,report);
  }catch(error){return fail(error)}
}
