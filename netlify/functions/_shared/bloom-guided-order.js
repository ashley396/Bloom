/** Guided order stepper (RC1.1) — validation only; uses existing order API shape. */

export const GUIDED_STEPS = [
  "customer",
  "recipient",
  "arrangement",
  "card_message",
  "fulfillment",
  "delivery_details",
  "pricing",
  "payment",
  "review"
];

export function validateGuidedStep(step, data = {}) {
  const errors = [];
  switch (step) {
    case "customer":
      if (!data.customer_name?.trim()) errors.push("Customer name is required.");
      break;
    case "recipient":
      if (!data.recipient_name?.trim()) errors.push("Recipient name is required.");
      break;
    case "arrangement":
      if (!data.arrangement_description?.trim() && !data.product_id) errors.push("Choose a product or describe the arrangement.");
      break;
    case "fulfillment":
      if (!["PICKUP", "DELIVERY"].includes(data.fulfillment)) errors.push("Choose pickup or delivery.");
      break;
    case "delivery_details":
      if (data.fulfillment === "DELIVERY" && !data.delivery_address?.trim()) errors.push("Delivery address is required.");
      break;
    case "pricing":
      if (Number(data.subtotal || 0) < 0) errors.push("Subtotal cannot be negative.");
      break;
    case "payment":
      if (data.payment_choice && !["PAY_NOW", "PAY_LATER", "HOUSE"].includes(data.payment_choice)) {
        errors.push("Choose what happens after the order is created.");
      }
      break;
    case "review":
      break;
    default:
      break;
  }
  return { valid: errors.length === 0, errors };
}

export function guidedProgress(stepsCompleted = []) {
  const total = GUIDED_STEPS.length;
  const done = stepsCompleted.filter((s) => GUIDED_STEPS.includes(s)).length;
  return { total, done, percent: Math.round((done / total) * 100) };
}

export function buildOrderBodyFromGuided(state = {}) {
  const flowers = Number(state.subtotal || 0);
  const labor = Number(state.labor_charge || 0);
  const discount = Number(state.discount || 0);
  const taxableSubtotal = Math.max(0, flowers + labor - discount);
  const taxRate = Number(state.tax_rate || 0);
  const tax = Math.round(taxableSubtotal * (taxRate / 100) * 100) / 100;
  const deliveryFee = Number(state.delivery_fee || 0);
  const total = taxableSubtotal + tax + deliveryFee;
  const paymentChoice = String(state.payment_choice || (state.is_business ? "HOUSE" : "PAY_NOW"));
  return {
    customer_name: state.customer_name,
    customer_phone: state.customer_phone || null,
    customer_type: paymentChoice === "HOUSE" ? "BUSINESS" : "PERSONAL",
    payment_required: paymentChoice === "PAY_NOW" ? "YES" : "NO",
    recipient_name: state.recipient_name,
    recipient_phone: state.recipient_phone || null,
    occasion: state.occasion || null,
    order_source: state.order_source || "Guided Order",
    arrangement_description: state.arrangement_description,
    card_message: state.card_message || null,
    notes: state.internal_notes || state.notes || null,
    fulfillment: state.fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP",
    delivery_address: state.delivery_address || null,
    delivery_date: state.delivery_date || new Date().toISOString().slice(0, 10),
    delivery_window: state.delivery_window || null,
    delivery_instructions: state.delivery_instructions || null,
    subtotal: flowers,
    labor_charge: labor,
    discount,
    tax_rate: taxRate,
    tax,
    delivery_fee: deliveryFee,
    estimated_cost: Number(state.estimated_cost || 0),
    total_preview: total
  };
}

export function paymentHandoffAfterCreate(order) {
  const balance = Math.max(0, Number(order.balance_due ?? (Number(order.total || 0) - Number(order.amount_paid || 0))));
  return {
    route: "existing_payment_center",
    order_id: order.id,
    balance,
    use_create_checkout: balance >= 0.5
  };
}
