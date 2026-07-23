const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let createMode=false, session=readSession();

function readSession(){try{return JSON.parse(localStorage.getItem("bloom_session")||"null")}catch{return null}}
function saveSession(d){session={accessToken:d.accessToken,refreshToken:d.refreshToken,user:d.user};localStorage.setItem("bloom_session",JSON.stringify(session))}
function signOut(){session=null;localStorage.removeItem("bloom_session");showAuth()}
function toast(m){const e=$("#toast");e.textContent=m;e.hidden=false;setTimeout(()=>e.hidden=true,3000)}
function money(v){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(v||0))}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

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
  if(id==="dashboardPage") return loadDashboard();
  const map={customersPage:["customers","customersList",renderCustomer],ordersPage:["orders","ordersList",renderOrder],inventoryPage:["inventory","inventoryList",renderInventory],expensesPage:["expenses","expensesList",renderExpense]};
  if(!map[id]) return;
  const [path,target,render]=map[id];
  try{const {items}=await api(path);$(`#${target}`).innerHTML=items.length?items.map(render).join(""):"<p>No records yet.</p>"}catch(e){toast(e.message)}
}
function renderCustomer(x){return `<article><strong>${esc(x.name)}</strong><p>${esc(x.phone)} ${x.email?"· "+esc(x.email):""}</p><small>${esc(x.address)}</small></article>`}
function renderOrder(x){return `<article><div class="row"><div><strong>${esc(x.order_number)}</strong><p>${esc(x.customer_name)} · ${esc(x.fulfillment)} · ${money(x.total)}</p></div><span class="badge">${esc(x.status)}</span></div></article>`}
function renderInventory(x){return `<article><div class="row"><div><strong>${esc(x.name)}</strong><p>${esc(x.category)} · ${x.quantity} ${esc(x.unit)}</p></div><span class="badge">${Number(x.quantity)<=Number(x.low_stock_level)?"LOW":"OK"}</span></div></article>`}
function renderExpense(x){return `<article><strong>${esc(x.category)}</strong><p>${esc(x.vendor)} · ${money(x.amount)}</p><small>${esc(x.expense_date)}</small></article>`}

async function loadDashboard(){
  try{
    const d=await api("dashboard");
    $("#ordersToday").textContent=d.ordersToday;$("#totalSales").textContent=money(d.totalSales);$("#totalExpenses").textContent=money(d.totalExpenses);$("#profit").textContent=money(d.profit);$("#deliveries").textContent=d.deliveries;$("#lowStock").textContent=d.lowStock;
    $("#queue").innerHTML=d.queue.length?d.queue.map(renderOrder).join(""):"<p>No active orders yet.</p>";
  }catch(e){toast(e.message)}
}

$("#switchMode").onclick=()=>{createMode=!createMode;$("#shopWrap").hidden=!createMode;$("#nameWrap").hidden=!createMode;$("#authButton").textContent=createMode?"Create account":"Sign in";$("#switchMode").textContent=createMode?"Already have an account? Sign in":"Create a Bloom account";$("#authMessage").textContent=""};

$("#authForm").onsubmit=async e=>{
  e.preventDefault();$("#authButton").disabled=true;$("#authMessage").textContent="";
  try{
    const d=await api(createMode?"auth-signup":"auth-login",{method:"POST",body:JSON.stringify({shopName:$("#shopName").value,fullName:$("#fullName").value,email:$("#email").value,password:$("#password").value})},false);
    if(d.confirmationRequired){$("#authMessage").textContent="Check your email to confirm your account, then sign in.";return}
    saveSession(d);showApp();loadDashboard();
  }catch(err){$("#authMessage").textContent=err.message}finally{$("#authButton").disabled=false}
};

$("#logout").onclick=signOut;
$$("[data-page]").forEach(b=>b.onclick=()=>showPage(b.dataset.page));
$$("[data-open]").forEach(b=>b.onclick=()=>document.getElementById(b.dataset.open).showModal());
$$(".close").forEach(b=>b.onclick=()=>b.closest("dialog").close());

for(const [formId,path,dialogId,success] of [
  ["customerForm","customers","customerDialog","Customer saved"],
  ["orderForm","orders","orderDialog","Order created"],
  ["inventoryForm","inventory","inventoryDialog","Inventory saved"],
  ["expenseForm","expenses","expenseDialog","Expense saved"]
]){
 $(`#${formId}`).onsubmit = async e => {
  e.preventDefault();

  const form = e.currentTarget;
  const formData = Object.fromEntries(new FormData(form));

  try {
    await api(path, {
      method: "POST",
      body: JSON.stringify(formData)
    });

    form.reset();
    $(`#${dialogId}`).close();
    toast(success);
    loadDashboard();
  } catch (err) {
    toast(err.message);
  }
};

$("#checkout").onclick=async()=>{
  try{const d=await api("create-checkout",{method:"POST",body:JSON.stringify({amount:$("#paymentAmount").value,description:$("#paymentDescription").value})});location.href=d.url}catch(e){toast(e.message)}
};

if(session?.accessToken){showApp();loadDashboard()}else{showAuth()}
