import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let supabase;
let session;
let createMode = false;

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  setTimeout(() => el.hidden = true, 3000);
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  const response = await fetch(`/api/${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

function showPage(id) {
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === id));
  $$(".bottom-nav button").forEach((b) => b.classList.toggle("active", b.dataset.page === id));
  if (id === "customersPage") loadCustomers();
  if (id === "ordersPage") loadOrders();
  if (id === "inventoryPage") loadInventory();
}

async function loadDashboard() {
  const data = await api("dashboard");
  $("#ordersToday").textContent = data.ordersToday;
  $("#deliveries").textContent = data.deliveries;
  $("#salesToday").textContent = money(data.salesToday);
  $("#lowStock").textContent = data.lowStock;
  $("#queue").innerHTML = data.queue.length ? data.queue.map((o) => `
    <article><div class="row"><div><strong>${o.order_number}</strong><p>${o.customer_name} · ${o.occasion || "Order"} · ${money(o.total)}</p></div><span class="badge">${o.status.replaceAll("_"," ")}</span></div></article>
  `).join("") : "<p>No active orders yet.</p>";
}

async function loadCustomers() {
  const { customers } = await api("customers");
  $("#customersList").innerHTML = customers.length ? customers.map((c) => `
    <article><strong>${c.name}</strong><p>${c.phone || ""}${c.email ? " · " + c.email : ""}</p><small>${c.address || ""}</small></article>
  `).join("") : "<p>No customers yet.</p>";
}

async function loadOrders() {
  const { orders } = await api("orders");
  $("#ordersList").innerHTML = orders.length ? orders.map((o) => `
    <article><div class="row"><div><strong>${o.order_number}</strong><p>${o.customer_name} · ${o.fulfillment} · ${money(o.total)}</p></div><span class="badge">${o.status.replaceAll("_"," ")}</span></div></article>
  `).join("") : "<p>No orders yet.</p>";
}

async function loadInventory() {
  const { inventory } = await api("inventory");
  $("#inventoryList").innerHTML = inventory.length ? inventory.map((i) => `
    <article><div class="row"><div><strong>${i.name}</strong><p>${i.category} · ${i.quantity} ${i.unit}</p></div><span class="badge">${Number(i.quantity) <= Number(i.low_stock_level) ? "LOW" : "OK"}</span></div></article>
  `).join("") : "<p>No inventory yet.</p>";
}

async function start() {
  try {
    const config = await fetch("/api/config").then(async (r) => {
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || "Configuration failed");
      return b;
    });
    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
    const result = await supabase.auth.getSession();
    session = result.data.session;
    $("#boot").hidden = true;
    if (session) {
      $("#app").hidden = false;
      await loadDashboard();
    } else {
      $("#auth").hidden = false;
    }

    supabase.auth.onAuthStateChange(async (_event, newSession) => {
      session = newSession;
      $("#auth").hidden = !!session;
      $("#app").hidden = !session;
      if (session) await loadDashboard();
    });
  } catch (error) {
    $("#boot").innerHTML = `<div class="auth-card"><h1>Bloom could not start</h1><p class="error">${error.message}</p></div>`;
  }
}

$("#toggleAuth").addEventListener("click", () => {
  createMode = !createMode;
  $("#nameLabel").hidden = !createMode;
  $("#authSubmit").textContent = createMode ? "Create account" : "Sign in";
  $("#toggleAuth").textContent = createMode ? "Already have an account? Sign in" : "Create an account";
});

$("#authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#authMessage").textContent = "";
  const email = $("#email").value.trim();
  const password = $("#password").value;
  try {
    const result = createMode
      ? await supabase.auth.signUp({ email, password, options: { data: { full_name: $("#fullName").value.trim() } } })
      : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    if (createMode && !result.data.session) $("#authMessage").textContent = "Check your email to confirm your account.";
  } catch (error) { $("#authMessage").textContent = error.message; }
});

$("#signOut").addEventListener("click", () => supabase.auth.signOut());
$$("[data-page]").forEach((b) => b.addEventListener("click", () => showPage(b.dataset.page)));
$$("[data-open]").forEach((b) => b.addEventListener("click", () => document.getElementById(b.dataset.open).showModal()));

$("#customerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("customers", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
    $("#customerModal").close(); event.currentTarget.reset(); toast("Customer saved"); await loadCustomers();
  } catch (error) { toast(error.message); }
});

$("#orderForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("orders", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
    $("#orderModal").close(); event.currentTarget.reset(); toast("Order created"); await loadDashboard(); await loadOrders();
  } catch (error) { toast(error.message); }
});

$("#inventoryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("inventory", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
    $("#inventoryModal").close(); event.currentTarget.reset(); toast("Inventory saved"); await loadDashboard(); await loadInventory();
  } catch (error) { toast(error.message); }
});

$("#checkoutButton").addEventListener("click", async () => {
  try {
    const data = await api("create-checkout", {
      method: "POST",
      body: JSON.stringify({ amount: $("#paymentAmount").value, description: $("#paymentDescription").value })
    });
    location.href = data.url;
  } catch (error) { toast(error.message); }
});

const params = new URLSearchParams(location.search);
if (params.get("payment") === "success") setTimeout(() => toast("Payment completed"), 800);
if (params.get("payment") === "cancelled") setTimeout(() => toast("Payment cancelled"), 800);

start();
