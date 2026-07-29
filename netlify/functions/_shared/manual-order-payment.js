/** Manual (cash/check) order payments — validation + RPC arg building. */

export const MANUAL_PAYMENT_METHODS = [
  "Cash",
  "Check",
  "Gift Card",
  "Store Credit",
  "House Account",
  "Purchase Order",
  "Other"
];

/** Values allowed by public.payments.method check constraint (migration v18.5). */
export const PAYMENTS_TABLE_METHODS = new Set([
  "Stripe",
  "Cash",
  "Check",
  "Gift Card",
  "Store Credit",
  "Other"
]);

export function normalizeMethodForPaymentsTable(method) {
  const label = String(method || "Other").trim();
  if (PAYMENTS_TABLE_METHODS.has(label)) return label;
  if (label === "House Account" || label === "Purchase Order") return "Other";
  return "Other";
}

export function validateManualPaymentBody(body = {}) {
  const errors = [];
  const orderId = String(body.order_id || "").trim();
  if (!orderId) errors.push("Choose an order first.");
  const amount = Math.round(Number(body.amount || 0) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) errors.push("Enter a valid payment amount.");
  const method = String(body.method || "Other").trim();
  if (!MANUAL_PAYMENT_METHODS.includes(method)) errors.push("Invalid manual payment method.");
  const idempotencyKey = String(body.idempotency_key || "").trim();
  const methodForRpc = normalizeMethodForPaymentsTable(method);
  const metadata = { source: "Florisyn payments page" };
  if (method !== methodForRpc) metadata.tender_label = method;
  return {
    valid: errors.length === 0,
    errors,
    orderId,
    amount,
    method,
    methodForRpc,
    idempotencyKey: idempotencyKey || null,
    metadata
  };
}

export function buildPostOrderPaymentRpcArgs({
  shopId,
  orderId,
  amount,
  methodForRpc,
  idempotencyKey,
  actorUserId,
  metadata = {}
}) {
  const meta = { ...metadata };
  Object.keys(meta).forEach((k) => meta[k] === undefined && delete meta[k]);
  return {
    p_shop_id: shopId,
    p_order_id: orderId,
    p_amount: amount,
    p_method: methodForRpc,
    p_idempotency_key: idempotencyKey,
    p_actor_user_id: actorUserId,
    p_processor: "manual",
    p_processor_session_id: null,
    p_processor_payment_intent_id: null,
    p_metadata: meta
  };
}

/** Map Supabase/Postgres errors to florist-safe messages (full error logged server-side). */
export function mapManualPaymentError(error) {
  const msg = String(error?.message || error || "");
  const code = String(error?.code || "");
  if (/permission denied for function post_order_payment/i.test(msg)) {
    return {
      statusCode: 503,
      message:
        "Cash and manual payments need Florisyn's secure server connection. Ask your admin to verify Netlify Supabase keys."
    };
  }
  if (/Order not found/i.test(msg)) {
    return { statusCode: 404, message: "That order was not found in your shop. Refresh orders and try again." };
  }
  if (/Payment exceeds remaining balance/i.test(msg) || /Payment amount must be greater than zero/i.test(msg)) {
    return { statusCode: 400, message: msg };
  }
  if (/payments_method_check/i.test(msg) || /violates check constraint.*method/i.test(msg)) {
    return { statusCode: 400, message: "That payment method is not supported for ledger posting yet." };
  }
  if (code === "PGRST202" || /Could not find the function.*post_order_payment/i.test(msg)) {
    return {
      statusCode: 503,
      message:
        "Payment posting is not available on this database yet. Apply migration supabase/migrations/20260729_post_order_payment_v185.sql in Supabase, then reload the API schema."
    };
  }
  if (/relation "public\.payments" does not exist/i.test(msg) || /Could not find the table 'public.payments'/i.test(msg)) {
    return {
      statusCode: 503,
      message:
        "The payments ledger table is missing in Supabase. Apply migration supabase/migrations/20260729_post_order_payment_v185.sql before recording cash payments."
    };
  }
  return null;
}

export function applyOrderPaymentFromRpcResult(data) {
  if (!data || typeof data !== "object") return { order: null, payment: null, duplicate: false };
  return {
    order: data.order || null,
    payment: data.payment || null,
    duplicate: Boolean(data.duplicate)
  };
}

export function derivePaymentTotalsFromOrder(order) {
  const total = Math.max(0, Number(order?.total || 0));
  const paid = Math.max(0, Number(order?.amount_paid || 0));
  const balance = Math.max(
    0,
    Number.isFinite(Number(order?.balance_due)) ? Number(order.balance_due) : total - paid
  );
  const status = String(order?.payment_status || "UNPAID").toUpperCase();
  return { total, paid, balance, status };
}

export const SPLIT_TENDER_LABELS = ["Cash", "Check", "Card", "Other"];

export function normalizeSplitPartMethod(method) {
  const m = String(method || "Other").trim();
  if (SPLIT_TENDER_LABELS.includes(m)) return m;
  if (m === "Stripe") return "Card";
  return "Other";
}

/** Validate split parts against current balance (allows partial; blocks overpay). */
export function validateSplitPaymentParts(order, parts = []) {
  const errors = [];
  const { total, paid, balance } = derivePaymentTotalsFromOrder(order);
  if (!Array.isArray(parts) || !parts.length) {
    errors.push("Add at least one payment part.");
    return { valid: false, errors, total, paid, balance, splitTotal: 0, remainingAfter: balance, parts: [] };
  }
  const normalized = parts.map((p, index) => {
    const method = normalizeSplitPartMethod(p.method);
    const amount = Math.round(Number(p.amount || 0) * 100) / 100;
    const note = String(p.note || p.reference || "").trim().slice(0, 200);
    const idempotencyKey = String(p.idempotency_key || p.idempotencyKey || "").trim() || null;
    return { index, method, amount, note, idempotencyKey };
  });
  for (const p of normalized) {
    if (!Number.isFinite(p.amount) || p.amount <= 0) errors.push(`Part ${p.index + 1}: enter an amount greater than zero.`);
  }
  const manualParts = normalized.filter((p) => p.method !== "Card");
  const splitTotalAll = Math.round(normalized.reduce((s, p) => s + p.amount, 0) * 100) / 100;
  const splitTotalManual = Math.round(manualParts.reduce((s, p) => s + p.amount, 0) * 100) / 100;
  if (splitTotalAll > balance + 0.005) {
    errors.push(`Split total (${splitTotalAll.toFixed(2)}) cannot exceed the remaining balance (${balance.toFixed(2)}).`);
  }
  const cardParts = normalized.filter((p) => p.method === "Card");
  const remainingAfter = Math.max(0, Math.round((balance - splitTotalManual) * 100) / 100);
  return {
    valid: errors.length === 0,
    errors,
    total,
    paid,
    balance,
    splitTotal: splitTotalAll,
    splitTotalManual,
    remainingAfter,
    parts: normalized,
    cardParts
  };
}

export function buildSplitPartMetadata(part, splitBatchId) {
  const meta = { source: "Florisyn split payment", split_batch_id: splitBatchId };
  if (part.note) meta.note = part.note;
  if (part.method === "Card") meta.deferred_checkout = true;
  return meta;
}
