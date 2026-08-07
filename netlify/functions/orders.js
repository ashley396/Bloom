import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { writeShopAudit } from "./_shared/production.js";
import { validateOrderCreateBody, clampText, validateOrderPatchBody } from "./_shared/validation.js";
import { normalizeOrderStatus, recordOrderStatusChange } from "./_shared/order-status.js";

export const ORDER_PAYMENT_LEDGER_FIELDS = Object.freeze([
  "amount_paid",
  "balance_due",
  "payment_status",
  "payment_method",
  "paid_at",
]);

export function submittedPaymentLedgerFields(body = {}) {
  return ORDER_PAYMENT_LEDGER_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function paymentStateForTotal(total, amountPaid, priorStatus) {
  const normalizedPriorStatus = String(priorStatus || "UNPAID").trim().toUpperCase();
  const paid = Math.max(0, roundMoney(amountPaid));
  const balanceDue = Math.max(0, roundMoney(total - paid));
  if (normalizedPriorStatus === "REFUNDED") {
    return { amountPaid: paid, balanceDue, paymentStatus: "REFUNDED" };
  }
  const paymentStatus = balanceDue <= 0.005 && total > 0 && paid >= total - 0.005
    ? "PAID"
    : paid > 0
      ? "PARTIAL"
      : "UNPAID";
  return { amountPaid: paid, balanceDue, paymentStatus };
}

function paymentFieldError(body) {
  const fields = submittedPaymentLedgerFields(body);
  if (!fields.length) return null;
  return `Payment fields (${fields.join(", ")}) can only be changed by recording a payment or refund in the payment ledger.`;
}

export async function handleOrders(event, dependencies = {}) {
  const authenticate = dependencies.currentUser || currentUser;
  const audit = dependencies.writeShopAudit || writeShopAudit;
  const recordStatusChange = dependencies.recordOrderStatusChange || recordOrderStatusChange;
  const ready = preflight(event);
  if (ready) return ready;

  try {
    const { client, shopId, user } = await authenticate(event);

    if (event.httpMethod === "GET") {
      const qs = event.queryStringParameters || {};
      if (qs.order_id && qs.view === "history") {
        const orderId = String(qs.order_id || "").trim();
        if (!orderId) return json(400, { error: "Missing order id." });
        const { data: orderRow, error: orderError } = await client
          .from("orders")
          .select("id")
          .eq("id", orderId)
          .eq("shop_id", shopId)
          .maybeSingle();
        if (orderError) throw orderError;
        if (!orderRow) return json(404, { error: "Order not found." });
        const { data, error } = await client
          .from("order_status_history")
          .select("id,from_status,to_status,changed_by,note,created_at")
          .eq("shop_id", shopId)
          .eq("order_id", orderId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return json(200, { items: data || [] });
      }

      const { data, error } = await client
        .from("orders")
        .select("*")
        .eq("shop_id", shopId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return json(200, { items: data || [] });
    }

    if (event.httpMethod === "POST") {
      const body = bodyOf(event);
      const forbiddenPaymentFieldError = paymentFieldError(body);
      if (forbiddenPaymentFieldError) return json(400, { error: forbiddenPaymentFieldError });
      const validation = validateOrderCreateBody(body);
      if (!validation.valid) return json(400, { error: validation.errors[0] });

      const clientRequestId = String(body.client_request_id || body.idempotency_key || "")
        .trim()
        .slice(0, 80)
        .replace(/[^A-Za-z0-9:_-]/g, "");
      if (clientRequestId) {
        const { data: existingOrder, error: existingError } = await client
          .from("orders")
          .select("*")
          .eq("shop_id", shopId)
          .ilike("notes", `%[req:${clientRequestId}]%`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existingError) throw existingError;
        if (existingOrder) return json(200, { item: existingOrder, idempotent: true });
      }

      const flowers = Number(body.subtotal || 0);
      const labor = Number(body.labor_charge || 0);
      const addons = Number(body.addon_total || 0);
      const discount = Number(body.discount || 0);
      const taxRate = Number(body.tax_rate || 0);
      const deliveryFee = Number(body.delivery_fee || 0);

      const baseNotes = body.notes || null;
      const notesWithRequest = clientRequestId
        ? [baseNotes, `[req:${clientRequestId}]`].filter(Boolean).join(" ").slice(0, 2000)
        : baseNotes;

      const payload = {
        customer_name: validation.sanitized.customer_name || clampText(body.customer_name, 120),
        customer_id: body.customer_id || null,
        customer_phone: body.customer_phone || null,
        occasion: body.occasion || null,
        fulfillment:
          body.fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP",
        delivery_address: body.delivery_address || null,
        delivery_date: body.delivery_date || null,
        subtotal: flowers,
        delivery_fee: deliveryFee,
        notes: notesWithRequest,
        tax_rate: taxRate,
        customer_type: body.customer_type || "PERSONAL",
        recipient_name: body.recipient_name || null,
        recipient_phone: body.recipient_phone || null,
        delivery_window: body.delivery_window || null,
        delivery_instructions: body.delivery_instructions || null,
        delivery_miles: Number(body.delivery_miles || 0),
        drive_minutes: Number(body.drive_minutes || 0),
        order_source: body.order_source || null,
        card_message: body.card_message || null,
        arrangement_description: body.arrangement_description || null,
        location_type: body.location_type || null,
        driver: body.driver || null,
        designer: body.designer || null,
        priority: body.priority || "NORMAL",
        design_style: body.design_style || null,
        color_palette: body.color_palette || null,
        preferred_flowers: body.preferred_flowers || null,
        flower_restrictions: body.flower_restrictions || null,
        addons: body.addons || null,
        labor_charge: Number(body.labor_charge || 0),
        addon_total: Number(body.addon_total || 0),
        discount: Number(body.discount || 0),
        estimated_cost: Number(body.estimated_cost || 0),
        product_id: body.product_id || null,
      };

      const { data, error } = await client.rpc("create_order_atomic", {
        p_shop_id: shopId,
        p_order: payload,
      });
      if (error) throw error;
      if (!data?.item) throw new Error("Atomic order creation returned no order.");
      return json(201, data);
    }

    if (event.httpMethod === "PATCH") {
      const body = bodyOf(event);
      if (!body.id) return json(400, { error: "Missing order id" });
      const forbiddenPaymentFieldError = paymentFieldError(body);
      if (forbiddenPaymentFieldError) return json(400, { error: forbiddenPaymentFieldError });
      const patchValidation = validateOrderPatchBody(body);
      if (!patchValidation.valid) return json(400, { error: patchValidation.errors[0] });
      if (body.action === "MARK_PAID" || body.action === "MARK_UNPAID") return json(400, { error: "Payment status must be changed by recording a payment or refund in the payment ledger." });
      const payload = {};
      const textFields = ["customer_name","customer_phone","occasion","fulfillment","delivery_address","delivery_date","notes","customer_type","recipient_name","recipient_phone","delivery_window","delivery_instructions","order_source","card_message","arrangement_description","location_type","driver","designer","priority","design_style","color_palette","preferred_flowers","flower_restrictions","addons","product_id","status"];
      const numberFields = ["subtotal","tax","delivery_fee","tax_rate","delivery_miles","drive_minutes","labor_charge","addon_total","discount","estimated_cost"];
      for (const field of textFields) if (field in body) payload[field] = body[field] || null;
      for (const field of numberFields) {
        if (!(field in body)) continue;
        const value = Number(body[field] || 0);
        if (!Number.isFinite(value)) return json(400, { error: `${field} must be a number.` });
        payload[field] = value;
      }
      if ("customer_name" in payload && !String(payload.customer_name || "").trim()) return json(400, { error: "Customer name is required" });
      const { data: priorOrder, error: priorOrderError } = await client
        .from("orders")
        .select("id,status,subtotal,tax,delivery_fee,total,tax_rate,amount_paid,balance_due,payment_status,labor_charge,addon_total,discount")
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .maybeSingle();
      if (priorOrderError) throw priorOrderError;
      if (!priorOrder) return json(404, { error: "Order not found." });
      if ("status" in payload && payload.status) payload.status = normalizeOrderStatus(payload.status);
      const pricingFields = ["subtotal","tax","delivery_fee","tax_rate","labor_charge","addon_total","discount"];
      if (pricingFields.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
        const priorLabor = Number(priorOrder.labor_charge || 0);
        const priorAddons = Number(priorOrder.addon_total || 0);
        const priorDiscount = Number(priorOrder.discount || 0);
        const priorProductAmount = Math.max(0, Number(priorOrder.subtotal || 0) - priorLabor - priorAddons + priorDiscount);
        const productAmount = "subtotal" in body ? Number(body.subtotal || 0) : priorProductAmount;
        const labor = "labor_charge" in body ? Number(body.labor_charge || 0) : priorLabor;
        const addons = "addon_total" in body ? Number(body.addon_total || 0) : priorAddons;
        const discount = "discount" in body ? Number(body.discount || 0) : priorDiscount;
        const subtotal = Math.max(0, roundMoney(productAmount + labor + addons - discount));
        const taxRate = "tax_rate" in body ? Number(body.tax_rate || 0) : Number(priorOrder.tax_rate || 0);
        const tax = Math.max(0, roundMoney(subtotal * (taxRate / 100)));
        const deliveryFee = "delivery_fee" in body ? Number(body.delivery_fee || 0) : Number(priorOrder.delivery_fee || 0);
        const total = Math.max(0, roundMoney(subtotal + tax + deliveryFee));
        if (total + 0.005 < Number(priorOrder.amount_paid || 0)) {
          return json(400, { error: "The revised order total cannot be less than payments already recorded. Record a refund or payment adjustment first." });
        }
        const payment = paymentStateForTotal(total, priorOrder.amount_paid, priorOrder.payment_status);
        Object.assign(payload, {
          subtotal,
          tax,
          tax_rate: taxRate,
          delivery_fee: deliveryFee,
          total,
          balance_due: payment.balanceDue,
          payment_status: payment.paymentStatus,
        });
      }
      const { data, error } = await client.from("orders").update(payload).eq("id",body.id).eq("shop_id",shopId).select().single();
      if (error) throw error;
      if ("status" in payload) {
        await recordStatusChange(client, {
          shopId,
          orderId: data.id,
          fromStatus: priorOrder?.status,
          toStatus: data.status,
          userId: user.id,
        });
      }
      const { data: existingDelivery } = await client.from("deliveries").select("id").eq("shop_id",shopId).eq("order_id",body.id).maybeSingle();
      await audit(client, {
        shopId,
        userId: user.id,
        eventType: "order_updated",
        entityType: "order",
        entityId: data.id,
        metadata: { status: data.status, payment_status: data.payment_status }
      });
      if(data.fulfillment==="DELIVERY"&&data.delivery_address){const deliveryPayload={address:data.delivery_address,driver:data.driver||null,notes:data.delivery_instructions||null,round_trip_miles:Number(data.delivery_miles||0),drive_minutes:Number(data.drive_minutes||0),delivery_date:data.delivery_date||null,delivery_window:data.delivery_window||null,recipient_name:data.recipient_name||null,recipient_phone:data.recipient_phone||null};if(existingDelivery?.id)await client.from("deliveries").update(deliveryPayload).eq("id",existingDelivery.id).eq("shop_id",shopId);else await client.from("deliveries").insert({shop_id:shopId,order_id:data.id,status:"PENDING",...deliveryPayload})}else if(existingDelivery?.id)await client.from("deliveries").delete().eq("id",existingDelivery.id).eq("shop_id",shopId);
      return json(200,{item:data});
    }

    if (event.httpMethod === "DELETE") {
      const body = bodyOf(event);
      if (!body.id) return json(400, { error: "Missing order id" });
      const { data: order, error: orderError } = await client
        .from("orders")
        .select("id,order_number")
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .maybeSingle();
      if (orderError) throw orderError;
      if (!order) return json(404, { error: "Order not found." });
      const { count, error: payError } = await client
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId)
        .eq("order_id", body.id);
      if (payError) throw payError;
      if (count > 0) {
        return json(400, {
          error: "This order has payment history. Refund or adjust payments before deleting the order."
        });
      }
      await client.from("deliveries").delete().eq("shop_id", shopId).eq("order_id", body.id);
      const { error: deleteError } = await client.from("orders").delete().eq("id", body.id).eq("shop_id", shopId);
      if (deleteError) throw deleteError;
      await audit(client, {
        shopId,
        userId: user.id,
        eventType: "order_deleted",
        entityType: "order",
        entityId: body.id,
        metadata: { order_number: order.order_number }
      });
      return json(200, { ok: true });
    }

    return methodNotAllowed();
  } catch (error) {
    return fail(error);
  }
}

export async function handler(event) {
  return handleOrders(event);
}
