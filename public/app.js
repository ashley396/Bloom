const app = document.querySelector("#app");
let state = {status:null, view:"dashboard"};

async function api(url, options={}) {
  const res = await fetch(url,{headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.message || data.error || "Request failed");
  return data;
}
const money = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(n||0));
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

async function boot(){
  state.status = await api("/api/status");
  if(state.status.setupRequired) return renderSetup();
  if(!state.status.authenticated) return renderLogin();
  renderShell();
  show("dashboard");
}

function renderSetup(){
  app.innerHTML = `<div class="auth"><section class="panel">
    <div class="brand"><div class="logo">✿</div><div><h1>Welcome to Bloom</h1><p class="muted">Create your flower shop and owner account.</p></div></div>
    <form id="setup" class="form">
      <label>Shop name<input name="shopName" required value="Lilies in Bloom"></label>
      <label>Shop address<input name="address"></label>
      <div class="form two"><label>Owner name<input name="ownerName" required></label><label>Phone<input name="phone"></label></div>
      <label>Email<input type="email" name="email" required></label>
      <label>Password<input type="password" name="password" minlength="8" required></label>
      <button class="primary">Create Bloom shop</button><p id="msg" class="muted"></p>
    </form></section></div>`;
  document.querySelector("#setup").onsubmit = async e => {
    e.preventDefault(); const msg=document.querySelector("#msg");
    try{await api("/api/setup",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});boot()}
    catch(err){msg.textContent=err.message}
  };
}
function renderLogin(){
  app.innerHTML = `<div class="auth"><section class="panel">
    <div class="brand"><div class="logo">✿</div><div><h1>Bloom</h1><p class="muted">The connected commerce platform for independent florists.</p></div></div>
    <form id="login" class="form">
      <label>Email<input type="email" name="email" required></label>
      <label>Password<input type="password" name="password" required></label>
      <button class="primary">Sign in</button><p id="msg" class="muted"></p>
    </form></section></div>`;
  document.querySelector("#login").onsubmit=async e=>{e.preventDefault();try{await api("/api/login",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});boot()}catch(err){document.querySelector("#msg").textContent=err.message}};
}
function renderShell(){
  app.innerHTML=`<div class="shell">
  <aside><div class="brand"><div class="logo">✿</div><div><strong>Bloom</strong><div style="opacity:.7;font-size:.82rem">${esc(state.status.shop?.name||"Flower Shop")}</div></div></div>
  <nav>${["dashboard","customers","orders","inventory","market"].map(v=>`<button data-view="${v}">${v[0].toUpperCase()+v.slice(1)}</button>`).join("")}</nav>
  <button id="logout" class="secondary" style="margin-top:26px">Sign out</button></aside>
  <main><div class="top"><div><h1 id="title"></h1><p id="subtitle" class="muted"></p></div><div class="actions" id="actions"></div></div><div id="content"></div></main></div>`;
  document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>show(b.dataset.view));
  document.querySelector("#logout").onclick=async()=>{await api("/api/logout",{method:"POST"});boot()};
}
async function show(view){
  state.view=view;
  document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  const title=document.querySelector("#title"), sub=document.querySelector("#subtitle"), actions=document.querySelector("#actions"), content=document.querySelector("#content");
  actions.innerHTML="";
  if(view==="dashboard"){
    title.textContent="Good morning"; sub.textContent="Here is what needs your attention today.";
    const d=await api("/api/dashboard");
    content.innerHTML=`<div class="grid">
      <div class="card metric"><span class="muted">Today's orders</span><strong>${d.metrics.todaysOrders}</strong></div>
      <div class="card metric"><span class="muted">Customers</span><strong>${d.metrics.totalCustomers}</strong></div>
      <div class="card metric"><span class="muted">Recorded sales</span><strong>${money(d.metrics.sales)}</strong></div>
      <div class="card metric"><span class="muted">Low-stock items</span><strong>${d.metrics.lowStock}</strong></div>
      <div class="card span2"><h3>Today's workflow</h3>${d.todaysOrders.length?ordersTable(d.todaysOrders):'<p class="muted">No orders scheduled for today.</p>'}</div>
      <div class="card span2"><h3>Bloom insight</h3><div class="alert">${esc(d.insight)}</div></div>
    </div>`;
  } else if(view==="customers"){
    title.textContent="Customers";sub.textContent="Customer profiles, notes, and contact information.";
    actions.innerHTML=`<button class="primary" id="add">Add customer</button>`;
    const rows=await api("/api/customers");
    content.innerHTML=`<div class="card">${rows.length?`<table class="table"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Notes</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.phone)}</td><td>${esc(x.email)}</td><td>${esc(x.notes)}</td></tr>`).join("")}</tbody></table>`:'<p class="muted">No customers yet.</p>'}</div><div id="modal"></div>`;
    document.querySelector("#add").onclick=()=>formCustomer();
  } else if(view==="orders"){
    title.textContent="Orders";sub.textContent="Create and manage florist orders.";
    actions.innerHTML=`<button class="primary" id="add">New order</button>`;
    const rows=await api("/api/orders");
    content.innerHTML=`<div class="card">${rows.length?ordersTable(rows):'<p class="muted">No orders yet.</p>'}</div><div id="modal"></div>`;
    document.querySelector("#add").onclick=()=>formOrder();
  } else if(view==="inventory"){
    title.textContent="Inventory";sub.textContent="Fresh flowers, greenery, containers, and supplies.";
    actions.innerHTML=`<button class="primary" id="add">Add inventory</button>`;
    const rows=await api("/api/inventory");
    content.innerHTML=`<div class="card"><table class="table"><thead><tr><th>Item</th><th>Category</th><th>On hand</th><th>Reorder at</th><th>Cost</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.category)}</td><td><span class="badge">${x.quantity} ${esc(x.unit)}</span></td><td>${x.reorderLevel}</td><td>${money(x.cost)}</td></tr>`).join("")}</tbody></table></div><div id="modal"></div>`;
    document.querySelector("#add").onclick=()=>formInventory();
  } else if(view==="market"){
    title.textContent="Bloom Market";sub.textContent="Early Access supplier discovery for the Thanksgiving launch.";
    const rows=await api("/api/suppliers");
    content.innerHTML=`<div class="grid">${rows.map(x=>`<div class="card span2"><span class="badge">${x.verified?"Verified supplier":"Supplier"}</span><h3 style="margin-top:12px">${esc(x.name)}</h3><p class="muted">${esc(x.location)}</p><p><strong>Categories:</strong> ${x.categories.map(esc).join(", ")}</p><div class="alert">${esc(x.special)}</div></div>`).join("")}</div>`;
  }
}
function ordersTable(rows){return `<table class="table"><thead><tr><th>Order</th><th>Customer</th><th>Recipient</th><th>Status</th><th>Total</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.number)}</td><td>${esc(x.customerName)}</td><td>${esc(x.recipient)}</td><td><span class="badge">${esc(x.status)}</span></td><td>${money(x.total)}</td></tr>`).join("")}</tbody></table>`}
function mountForm(html, onSubmit){
  const m=document.querySelector("#modal");m.innerHTML=`<div class="card" style="margin-top:18px">${html}</div>`;
  const f=m.querySelector("form");f.onsubmit=async e=>{e.preventDefault();await onSubmit(Object.fromEntries(new FormData(f)));show(state.view)};
}
function formCustomer(){mountForm(`<h3>Add customer</h3><form class="form"><div class="form two"><label>Name<input name="name" required></label><label>Phone<input name="phone"></label></div><label>Email<input type="email" name="email"></label><label>Notes<textarea name="notes"></textarea></label><button class="primary">Save customer</button></form>`,d=>api("/api/customers",{method:"POST",body:JSON.stringify(d)}))}
function formOrder(){mountForm(`<h3>New order</h3><form class="form"><div class="form two"><label>Customer<input name="customerName" required></label><label>Recipient<input name="recipient"></label></div><div class="form two"><label>Occasion<input name="occasion"></label><label>Total<input type="number" step=".01" name="total" required></label></div><div class="form two"><label>Fulfillment<select name="fulfillment"><option>DELIVERY</option><option>PICKUP</option></select></label><label>Delivery date<input type="date" name="deliveryDate"></label></div><label>Card message<textarea name="cardMessage"></textarea></label><button class="primary">Create order</button></form>`,d=>api("/api/orders",{method:"POST",body:JSON.stringify(d)}))}
function formInventory(){mountForm(`<h3>Add inventory item</h3><form class="form"><div class="form two"><label>Name<input name="name" required></label><label>Category<input name="category"></label></div><div class="form two"><label>Quantity<input type="number" name="quantity"></label><label>Reorder level<input type="number" name="reorderLevel"></label></div><div class="form two"><label>Unit<input name="unit" value="each"></label><label>Unit cost<input type="number" step=".01" name="cost"></label></div><button class="primary">Save item</button></form>`,d=>api("/api/inventory",{method:"POST",body:JSON.stringify(d)}))}
boot().catch(err=>{app.innerHTML=`<div class="auth"><div class="panel"><h1>Bloom could not start</h1><p>${esc(err.message)}</p></div></div>`});
