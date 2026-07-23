const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let createMode=false, session=readSession(), customerItems=[], inventoryItems=[], orderItems=[];

function readSession(){try{return JSON.parse(localStorage.getItem("bloom_session")||"null")}catch{return null}}
function saveSession(d){session={accessToken:d.accessToken,refreshToken:d.refreshToken,user:d.user};localStorage.setItem("bloom_session",JSON.stringify(session))}
function signOut(){session=null;localStorage.removeItem("bloom_session");showAuth()}
function toast(m){const e=$("#toast");e.textContent=m;e.hidden=false;clearTimeout(window.bloomToast);window.bloomToast=setTimeout(()=>e.hidden=true,3200)}
function money(v){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(v||0))}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function dateText(v){if(!v)return "Not scheduled";const d=new Date(`${v}T12:00:00`);return Number.isNaN(d.getTime())?v:d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}

async function api(path,options={},retry=true){
  const headers={"Content-Type":"application/json",...(options.headers||{})};
  if(session?.accessToken) headers.Authorization=`Bearer ${session.accessToken}`;
  const r=await fetch(`/api/${path}`,{...options,headers}), d=await r.json().catch(()=>({}));
  if(r.status===401&&retry&&session?.refreshToken){
    const rr=await fetch("/api/auth-refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({refreshToken:session.refreshToken})});
    const rd=await rr.json().catch(()=>({}));
    if(rr.ok){saveSession(rd);return api(path,options,false)}
    signOut();
  }
  if(!r.ok) throw new Error(d.error||"Request failed");
  return d;
}

function showAuth(msg=""){$("#auth").hidden=false;$("#app").hidden=true;$("#authMessage").textContent=msg}
function showApp(){$("#auth").hidden=true;$("#app").hidden=false;$("#accountEmail").textContent=session?.user?.email||""}
function showPage(id){$$(".page").forEach(p=>p.classList.toggle("active",p.id===id));$$("nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===id));loadPage(id)}

async function loadPage(id){
  try{
    if(id==="dashboardPage") return loadDashboard();
    if(id==="customersPage"){
      const {items}=await api("customers");customerItems=items||[];renderCustomers();return;
    }
    if(id==="ordersPage"){
      const {items}=await api("orders");orderItems=items||[];$("#ordersList").innerHTML=orderItems.length?orderItems.map(renderOrder).join(""):empty("No orders yet.");return;
    }
    if(id==="inventoryPage"){
      const {items}=await api("inventory");inventoryItems=items||[];$("#inventoryList").innerHTML=inventoryItems.length?inventoryItems.map(renderInventory).join(""):empty("No inventory yet.");return;
    }
    if(id==="expensesPage"){
      const {items}=await api("expenses");$("#expensesList").innerHTML=items.length?items.map(renderExpense).join(""):empty("No expenses yet.");
    }
  }catch(e){toast(e.message)}
}
function empty(message){return `<article class="empty">${esc(message)}</article>`}
function renderCustomers(){
  const q=$("#customerSearch").value.trim().toLowerCase();
  const filtered=customerItems.filter(x=>[x.name,x.phone,x.email,x.address,x.notes].join(" ").toLowerCase().includes(q));
  $("#customersList").innerHTML=filtered.length?filtered.map(renderCustomer).join(""):empty(q?"No customers match your search.":"No customers yet.");
}
function renderCustomer(x){return `<article><div class="card-top"><div><strong>${esc(x.name)}</strong><p class="card-meta">${esc(x.phone||"No phone")}${x.email?`<br>${esc(x.email)}`:""}${x.address?`<br>${esc(x.address)}`:""}</p></div><span class="badge">Customer</span></div>${x.notes?`<div class="card-note">${esc(x.notes)}</div>`:""}<div class="card-actions"><button class="secondary" data-edit-customer="${x.id}">Edit</button><button class="danger" data-delete-customer="${x.id}" data-name="${esc(x.name)}">Delete</button></div></article>`}
function renderOrder(x){return `<article><div class="card-top"><div><strong>${esc(x.order_number)}</strong><p class="card-meta">${esc(x.customer_name)}<br>${esc(x.fulfillment)} · ${dateText(x.delivery_date)}</p></div><span class="badge">${esc(x.status)}</span></div><div class="receipt-line"><span>Total</span><strong>${money(x.total)}</strong></div><div class="card-actions"><button class="secondary" data-receipt="${x.id}">View receipt</button></div></article>`}
function renderInventory(x){const low=Number(x.quantity)<=Number(x.low_stock_level);return `<article><div class="card-top"><div><strong>${esc(x.name)}</strong><p class="card-meta">${esc(x.category)}<br>${x.quantity} ${esc(x.unit)} · Cost ${money(x.cost)} · Price ${money(x.price)}</p></div><span class="badge ${low?"low":"ok"}">${low?"LOW":"IN STOCK"}</span></div><div class="card-actions"><button class="secondary" data-edit-inventory="${x.id}">Edit</button><button class="danger" data-delete-inventory="${x.id}" data-name="${esc(x.name)}">Delete</button></div></article>`}
function renderExpense(x){return `<article><div class="card-top"><div><strong>${esc(x.category)}</strong><p class="card-meta">${esc(x.vendor||"No vendor")}<br>${dateText(x.expense_date)}</p></div><strong>${money(x.amount)}</strong></div>${x.notes?`<div class="card-note">${esc(x.notes)}</div>`:""}</article>`}

async function loadDashboard(){
  try{
    const d=await api("dashboard");
    $("#ordersToday").textContent=d.ordersToday;$("#totalSales").textContent=money(d.totalSales);$("#totalExpenses").textContent=money(d.totalExpenses);$("#profit").textContent=money(d.profit);$("#deliveries").textContent=d.deliveries;$("#lowStock").textContent=d.lowStock;
    $("#queue").innerHTML=d.queue.length?d.queue.map(renderOrder).join(""):empty("No active orders yet. Enjoy the quiet moment.");
  }catch(e){toast(e.message)}
}

function openCustomer(item=null){
  const form=$("#customerForm");form.reset();form.elements.id.value=item?.id||"";
  for(const key of ["name","phone","email","address","notes"]) form.elements[key].value=item?.[key]||"";
  $("#customerDialogTitle").textContent=item?"Edit customer":"Add customer";$("#customerDialog").showModal();
}
function openInventory(item=null){
  const form=$("#inventoryForm");form.reset();form.elements.id.value=item?.id||"";
  for(const key of ["name","category","quantity","low_stock_level","unit","cost","price"]) if(item) form.elements[key].value=item[key]??"";
  $("#inventoryDialogTitle").textContent=item?"Edit inventory":"Add inventory";$("#inventoryDialog").showModal();
}
function openReceipt(order){
  if(!order)return toast("Order not found");
  $("#receiptContent").innerHTML=`<div class="receipt"><div class="receipt-brand"><h1>✿ Bloom</h1><p>Beautiful flowers, thoughtfully made</p></div><div class="receipt-head"><div><div class="receipt-label">Receipt</div><strong>${esc(order.order_number)}</strong></div><div><div class="receipt-label">Date</div><strong>${new Date(order.created_at).toLocaleDateString()}</strong></div></div><div class="receipt-grid"><div><div class="receipt-label">Customer</div><strong>${esc(order.customer_name)}</strong>${order.occasion?`<p>${esc(order.occasion)}</p>`:""}</div><div><div class="receipt-label">Fulfillment</div><strong>${esc(order.fulfillment)}</strong><p>${dateText(order.delivery_date)}</p>${order.delivery_address?`<p>${esc(order.delivery_address)}</p>`:""}</div></div><div class="receipt-line"><span>Floral order subtotal</span><span>${money(order.subtotal)}</span></div><div class="receipt-line"><span>Tax</span><span>${money(order.tax)}</span></div><div class="receipt-line"><span>Delivery</span><span>${money(order.delivery_fee)}</span></div><div class="receipt-total-row"><span>Total</span><span>${money(order.total)}</span></div>${order.notes?`<div class="receipt-note"><div class="receipt-label">Order notes / card message</div><p>${esc(order.notes)}</p></div>`:""}<div class="receipt-thanks">Thank you for supporting a local flower shop.</div></div>`;
  $("#receiptDialog").showModal();
}

$("#switchMode").onclick=()=>{createMode=!createMode;$("#shopWrap").hidden=!createMode;$("#nameWrap").hidden=!createMode;$("#authButton").textContent=createMode?"Create account":"Sign in";$("#switchMode").textContent=createMode?"Already have an account? Sign in":"Create a Bloom account";$("#authMessage").textContent=""};
$("#authForm").onsubmit=async e=>{e.preventDefault();$("#authButton").disabled=true;$("#authMessage").textContent="";try{const d=await api(createMode?"auth-signup":"auth-login",{method:"POST",body:JSON.stringify({shopName:$("#shopName").value,fullName:$("#fullName").value,email:$("#email").value,password:$("#password").value})},false);if(d.confirmationRequired){$("#authMessage").textContent="Check your email to confirm your account, then sign in.";return}saveSession(d);showApp();loadDashboard()}catch(err){$("#authMessage").textContent=err.message}finally{$("#authButton").disabled=false}};
$("#logout").onclick=signOut;
$$("[data-page]").forEach(b=>b.onclick=()=>showPage(b.dataset.page));
$$("[data-open]").forEach(b=>b.onclick=()=>{if(b.dataset.open==="customerDialog")openCustomer();else if(b.dataset.open==="inventoryDialog")openInventory();else document.getElementById(b.dataset.open).showModal()});
$$(".close").forEach(b=>b.onclick=()=>b.closest("dialog").close());
$("#customerSearch").addEventListener("input",renderCustomers);

$("#customerForm").onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form));const editing=Boolean(data.id);try{await api("customers",{method:editing?"PATCH":"POST",body:JSON.stringify(data)});form.reset();$("#customerDialog").close();toast(editing?"Customer updated":"Customer saved");await loadPage("customersPage")}catch(error){toast(error.message||"Could not save customer")}};
$("#inventoryForm").onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form));const editing=Boolean(data.id);try{await api("inventory",{method:editing?"PATCH":"POST",body:JSON.stringify(data)});form.reset();$("#inventoryDialog").close();toast(editing?"Inventory updated":"Inventory saved");await loadPage("inventoryPage");await loadDashboard()}catch(error){toast(error.message||"Could not save inventory")}};
for(const [formId,path,dialogId,success,page] of [["orderForm","orders","orderDialog","Order created","ordersPage"],["expenseForm","expenses","expenseDialog","Expense saved","expensesPage"]]){$(`#${formId}`).onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form));try{await api(path,{method:"POST",body:JSON.stringify(data)});form.reset();$(`#${dialogId}`).close();toast(success);await loadPage(page);await loadDashboard()}catch(error){toast(error.message||"Could not save")}}}

document.addEventListener("click",async e=>{
  const editCustomer=e.target.closest("[data-edit-customer]");if(editCustomer){openCustomer(customerItems.find(x=>x.id===editCustomer.dataset.editCustomer));return}
  const deleteCustomer=e.target.closest("[data-delete-customer]");if(deleteCustomer){if(!confirm(`Move ${deleteCustomer.dataset.name} to the recycle bin?`))return;try{await api("customers",{method:"DELETE",body:JSON.stringify({id:deleteCustomer.dataset.deleteCustomer})});toast("Customer moved to recycle bin");await loadPage("customersPage")}catch(err){toast(err.message)}return}
  const editInventory=e.target.closest("[data-edit-inventory]");if(editInventory){openInventory(inventoryItems.find(x=>x.id===editInventory.dataset.editInventory));return}
  const deleteInventory=e.target.closest("[data-delete-inventory]");if(deleteInventory){if(!confirm(`Move ${deleteInventory.dataset.name} to the recycle bin?`))return;try{await api("inventory",{method:"DELETE",body:JSON.stringify({id:deleteInventory.dataset.deleteInventory})});toast("Inventory item moved to recycle bin");await loadPage("inventoryPage");await loadDashboard()}catch(err){toast(err.message)}return}
  const receipt=e.target.closest("[data-receipt]");if(receipt){let order=orderItems.find(x=>x.id===receipt.dataset.receipt);if(!order){const {items}=await api("orders");orderItems=items||[];order=orderItems.find(x=>x.id===receipt.dataset.receipt)}openReceipt(order)}
});
$("#closeReceipt").onclick=()=>$("#receiptDialog").close();$("#printReceipt").onclick=()=>window.print();
$("#checkout").onclick=async()=>{try{const d=await api("create-checkout",{method:"POST",body:JSON.stringify({amount:$("#paymentAmount").value,description:$("#paymentDescription").value})});location.href=d.url}catch(e){toast(e.message)}};

if(session?.accessToken){showApp();loadDashboard()}else{showAuth()}
