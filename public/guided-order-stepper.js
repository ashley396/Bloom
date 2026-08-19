(function () {
  const STEPS = ["customer", "recipient", "arrangement", "card_message", "fulfillment", "delivery_details", "pricing", "payment", "review"];
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  // `new Date().toISOString().slice(0,10)` is UTC "today", not local
  // "today" — wrong for hours around local midnight in every US timezone.
  function localTodayStr() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  }

  let state = {};
  let stepIndex = 0;

  function ensureDialog() {
    if (document.getElementById("guidedOrderDialog")) return;
    const d = document.createElement("dialog");
    d.id = "guidedOrderDialog";
    d.className = "guided-order-dialog";
    document.body.appendChild(d);
  }

  function renderStep() {
    const dlg = document.getElementById("guidedOrderDialog");
    const step = STEPS[stepIndex];
    const progress = Math.round(((stepIndex + 1) / STEPS.length) * 100);
    dlg.innerHTML = `<form id="guidedOrderForm" class="guided-order">
      <p class="eyebrow">GUIDED ORDER · ${progress}%</p>
      <h2>Step ${stepIndex + 1}: ${esc(step.replace(/_/g, " "))}</h2>
      <div id="guidedFields"></div>
      <p id="guidedErrors" class="error-summary" role="alert"></p>
      <div class="card-actions">
        <button type="button" class="secondary" id="guidedBack" ${stepIndex ? "" : "disabled"}>Back</button>
        <button type="button" class="primary" id="guidedNext">${stepIndex === STEPS.length - 1 ? "Create order" : "Next"}</button>
        <button type="button" class="secondary close">Cancel</button>
      </div>
    </form>`;
    const fields = dlg.querySelector("#guidedFields");
    if (step === "customer") {
      fields.innerHTML = `<label>Customer<select id="guidedCustomerSelect"><option value="">New customer</option></select></label>
        <label>Name<input name="customer_name" value="${esc(state.customer_name || "")}" placeholder="Required — or Walk-in Customer"></label>
        <label>Phone <span class="label-optional">Optional</span><input name="customer_phone" value="${esc(state.customer_phone || "")}"></label>
        <button type="button" class="secondary" id="guidedWalkIn">Use Walk-in Customer</button>`;
      fields.querySelector("#guidedWalkIn")?.addEventListener("click", () => {
        fields.querySelector("[name=customer_name]").value = "Walk-in Customer";
      });
      const sel = fields.querySelector("#guidedCustomerSelect");
      (window.__bloomCustomers || []).forEach((c) => {
        sel.insertAdjacentHTML("beforeend", `<option value="${esc(c.id)}" data-name="${esc(c.name)}" data-phone="${esc(c.phone || "")}">${esc(c.name)}</option>`);
      });
      sel.onchange = () => {
        const o = sel.selectedOptions[0];
        if (o?.dataset.name) {
          fields.querySelector("[name=customer_name]").value = o.dataset.name;
          fields.querySelector("[name=customer_phone]").value = o.dataset.phone || "";
        }
      };
    } else if (step === "recipient") {
      fields.innerHTML = `<label>Recipient name <span class="label-optional">Optional</span><input name="recipient_name" value="${esc(state.recipient_name || "")}"></label>`;
    } else if (step === "arrangement") {
      fields.innerHTML = `<label>Product<select name="product_id"><option value="">Custom</option></select></label>
        <label>Description<textarea name="arrangement_description">${esc(state.arrangement_description || "")}</textarea></label>`;
      const sel = fields.querySelector("[name=product_id]");
      (window.__bloomProducts || []).forEach((p) => sel.insertAdjacentHTML("beforeend", `<option value="${esc(p.id)}" data-price="${p.price}">${esc(p.name)}</option>`));
    } else if (step === "card_message") {
      fields.innerHTML = `<label>Card message<textarea name="card_message">${esc(state.card_message || "")}</textarea></label>`;
    } else if (step === "fulfillment") {
      fields.innerHTML = `<label>Fulfillment<select name="fulfillment"><option value="PICKUP">Pickup</option><option value="DELIVERY" ${state.fulfillment === "DELIVERY" ? "selected" : ""}>Delivery</option></select></label>`;
    } else if (step === "delivery_details") {
      fields.innerHTML = `<label>Delivery address<textarea name="delivery_address">${esc(state.delivery_address || "")}</textarea></label>
        <label>Date<input type="date" name="delivery_date" value="${esc(state.delivery_date || localTodayStr())}"></label>
        <label>Instructions<textarea name="delivery_instructions">${esc(state.delivery_instructions || "")}</textarea></label>`;
    } else if (step === "pricing") {
      fields.innerHTML = `<label>Subtotal<input type="number" step="0.01" name="subtotal" value="${esc(state.subtotal || "0")}"></label>
        <label>Tax rate %<input type="number" step="0.001" name="tax_rate" value="${esc(state.tax_rate ?? window.shopSettings?.tax_rate ?? 6)}"></label>
        <label>Delivery fee<input type="number" step="0.01" name="delivery_fee" value="${esc(state.delivery_fee || "0")}"></label>
        <label>Discount<input type="number" step="0.01" name="discount" value="${esc(state.discount || "0")}"></label>`;
    } else if (step === "payment") {
      fields.innerHTML = `<label>After creating this order<select name="payment_choice"><option value="PAY_NOW">Personal — open Payment Center</option><option value="PAY_LATER">Personal — pay later</option><option value="HOUSE">Business / house account — invoice later</option></select></label>
        <p class="subtle">Deposits and payments are recorded securely in Payment Center after the order is created.</p>`;
    } else {
      fields.innerHTML = `<p><strong>${esc(state.customer_name)}</strong> → ${esc(state.recipient_name)}</p>
        <p>${esc(state.arrangement_description || "Custom arrangement")}</p>
        <p>Fulfillment: ${esc(state.fulfillment || "PICKUP")}</p>`;
    }
    dlg.querySelector(".close")?.addEventListener("click", () => dlg.close());
    dlg.querySelector("#guidedBack")?.addEventListener("click", () => {
      collectFields();
      stepIndex -= 1;
      renderStep();
    });
    dlg.querySelector("#guidedNext")?.addEventListener("click", async () => {
      collectFields();
      const err = validateStep(STEPS[stepIndex]);
      if (err.length) {
        dlg.querySelector("#guidedErrors").innerHTML = err.map((e) => `<div>${esc(e)}</div>`).join("");
        return;
      }
      if (stepIndex < STEPS.length - 1) {
        stepIndex += 1;
        renderStep();
        return;
      }
      await submitOrder();
    });
  }

  function collectFields() {
    const dlg = document.getElementById("guidedOrderDialog");
    dlg.querySelectorAll("input,textarea,select").forEach((el) => {
      if (!el.name) return;
      state[el.name] = el.type === "number" ? Number(el.value) : el.value;
    });
    try {
      localStorage.setItem("bloom_guided_order_draft", JSON.stringify({ state, stepIndex }));
    } catch {}
  }

  function validateStep(step) {
    const errors = [];
    if (step === "customer" && !String(state.customer_name || "").trim()) {
      state.customer_name = "Walk-in Customer";
    }
    if (step === "arrangement" && !state.arrangement_description?.trim() && !state.product_id && !(Number(state.subtotal) > 0)) {
      errors.push("Choose a product, describe the arrangement, or enter a subtotal.");
    }
    if (step === "fulfillment" && !state.fulfillment) errors.push("Choose pickup or delivery.");
    if (step === "delivery_details") {
      if (!String(state.delivery_date || "").trim()) errors.push("Choose a due date.");
      if (state.fulfillment === "DELIVERY" && !state.delivery_address?.trim()) errors.push("Delivery address is required.");
    }
    return errors;
  }

  async function submitOrder() {
    const subtotal = Number(state.subtotal || 0);
    const discount = Number(state.discount || 0);
    const taxable = Math.max(0, subtotal - discount);
    const taxRate = Number(state.tax_rate || 0);
    const tax = Math.round(taxable * (taxRate / 100) * 100) / 100;
    const deliveryFee = Number(state.delivery_fee || 0);
    const total = taxable + tax + deliveryFee;
    const paymentChoice = String(state.payment_choice || "PAY_NOW");
    const body = {
      customer_name: state.customer_name?.trim() || "Walk-in Customer",
      customer_phone: state.customer_phone,
      customer_type: paymentChoice === "HOUSE" ? "BUSINESS" : "PERSONAL",
      payment_required: paymentChoice === "PAY_NOW" ? "YES" : "NO",
      recipient_name: state.recipient_name,
      arrangement_description: state.arrangement_description,
      card_message: state.card_message,
      fulfillment: state.fulfillment,
      delivery_address: state.delivery_address,
      delivery_date: state.delivery_date,
      delivery_instructions: state.delivery_instructions,
      subtotal,
      discount,
      tax_rate: taxRate,
      tax,
      delivery_fee: deliveryFee,
      order_source: "Guided Order",
      total_preview: total
    };
    const dlg = document.getElementById("guidedOrderDialog");
    try {
      const result = await window.api("orders", { method: "POST", body: JSON.stringify(body) });
      const order = result.item || result.order || {};
      dlg.close();
      window.toast?.("Order created");
      if (paymentChoice === "PAY_NOW" && typeof window.setPendingPaymentOrder === "function" && Number(order.balance_due ?? total) >= 0.5) {
        window.setPendingPaymentOrder(order);
        window.showPage?.("paymentsPage");
      }
      localStorage.removeItem("bloom_guided_order_draft");
      await window.loadOrders?.();
    } catch (e) {
      dlg.querySelector("#guidedErrors").textContent = e.message;
    }
  }

  function open(opts = {}) {
    ensureDialog();
    try {
      const draft = JSON.parse(localStorage.getItem("bloom_guided_order_draft") || "null");
      if (draft) {
        state = draft.state || {};
        stepIndex = draft.stepIndex || 0;
      }
    } catch {
      state = {};
      stepIndex = 0;
    }
    if (opts.customer) {
      state.customer_name = opts.customer.name;
      state.customer_phone = opts.customer.phone;
      state.recipient_name = opts.customer.name;
    }
    renderStep();
    document.getElementById("guidedOrderDialog").showModal();
  }

  function mountToggle() {
    const ordersPage = document.getElementById("ordersPage");
    if (!ordersPage || ordersPage.querySelector("#guidedOrderToggle")) return;
    const actions = ordersPage.querySelector(".actions");
    if (!actions) return;
    actions.insertAdjacentHTML(
      "beforeend",
      `<button type="button" class="secondary" id="guidedOrderToggle">Guided order</button>`
    );
    actions.querySelector("#guidedOrderToggle")?.addEventListener("click", () => open());
  }

  window.BloomGuidedOrder = { open, mountToggle };
})();
