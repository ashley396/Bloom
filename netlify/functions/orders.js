import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { writeShopAudit } from "./_shared/production.js";
import { validateOrderCreateBody, clampText, validateOrderPatchBody } from "./_shared/validation.js";
import { normalizeOrderStatus, recordOrderStatusChange } from "./_shared/order-status.js";

function orderNumber() {
  return `BLM-${Date.now().toString().slice(-8)}`;
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;

  try {
    const { client, shopId, user } = await currentUser(event);

    if (event.httpMethod === "GET") {
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
      const validation = validateOrderCreateBody(body);
      if (!validation.valid) return json(400, { error: validation.errors[0] });

      const flowers = Number(body.subtotal || 0);
      const labor = Number(body.labor_charge || 0);
      const addons = Number(body.addon_total || 0);
      const discount = Number(body.discount || 0);
      const subtotal = Math.max(0, flowers + labor + addons - discount);
      const taxRate = Number(body.tax_rate || 0);
      const taxable = Math.max(0, flowers + labor + addons - discount);
      const taxFromRate = Math.round(taxable * (taxRate / 100) * 100) / 100;
      const tax = Number.isFinite(Number(body.tax)) && Number(body.tax) > 0 ? Number(body.tax) : taxFromRate;
      const deliveryFee = Number(body.delivery_fee || 0);

      const payload = {
        user_id: user.id,
        shop_id: shopId,
        order_number: orderNumber(),
        customer_name: validation.sanitized.customer_name || clampText(body.customer_name, 120),
        customer_phone: body.customer_phone || null,
        occasion: body.occasion || null,
        fulfillment:
          body.fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP",
        delivery_address: body.delivery_address || null,
        delivery_date: body.delivery_date || null,
        status: "NEW",
        subtotal,
        tax,
        delivery_fee: deliveryFee,
        total: subtotal + tax + deliveryFee,
        notes: body.notes || null,
        tax_rate: Number(body.tax_rate || 0),
        amount_paid: Number(body.amount_paid || 0),
        balance_due: Math.max(0, subtotal + tax + deliveryFee - Number(body.amount_paid || 0)),
        payment_status: body.payment_status || (Number(body.amount_paid || 0) > 0 ? "PARTIAL" : "UNPAID"),
        payment_method: body.payment_method || null,
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

      const { data, error } = await client
        .from("orders")
        .insert(payload)
        .select()
        .single();

      if (error) throw error;

      await recordOrderStatusChange(client, {
        shopId,
        orderId: data.id,
        fromStatus: null,
        toStatus: data.status,
        userId: user.id,
        note: "Order created",
      });

      await writeShopAudit(client, {
        shopId,
        userId: user.id,
        eventType: "order_created",
        entityType: "order",
        entityId: data.id,
        metadata: { order_number: data.order_number, total: data.total, payment_status: data.payment_status }
      });

      let delivery = null;
      if (data.fulfillment === "DELIVERY" && data.delivery_address) {
        const { data: deliveryData, error: deliveryError } = await client
          .from("deliveries")
          .insert({
            shop_id: shopId,
            order_id: data.id,
            address: data.delivery_address,
            driver: body.driver || null,
            status: "PENDING",
            notes: body.delivery_instructions || null,
            round_trip_miles: Number(body.delivery_miles || 0),
            drive_minutes: Number(body.drive_minutes || 0),
            delivery_date: body.delivery_date || null,
            delivery_window: body.delivery_window || null,
            recipient_name: body.recipient_name || null,
            recipient_phone: body.recipient_phone || null,
          })
          .select()
          .single();
        if (!deliveryError) delivery = deliveryData;
      }

      const inventoryAdjustments = [];
      const inventoryWarnings = [];
      if (body.product_id) {
        const { data: recipeRows, error: recipeError } = await client
          .from("product_recipes")
          .select("ingredient_name,quantity,unit")
          .eq("shop_id", shopId)
          .eq("product_id", body.product_id);
        if (!recipeError && Array.isArray(recipeRows)) {
          const { data: stockRows, error: stockError } = await client
            .from("inventory")
            .select("id,name,color,quantity,unit")
            .eq("shop_id", shopId)
            .is("deleted_at", null);
          if (!stockError && Array.isArray(stockRows)) {
            const normalize = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
            for (const recipe of recipeRows) {
              const wanted = normalize(recipe.ingredient_name);
              const stock = stockRows.find(row => {
                const full = normalize(`${row.color || ""} ${row.name || ""}`);
                const name = normalize(row.name);
                return full === wanted || name === wanted || full.includes(wanted) || wanted.includes(name);
              });
              if (!stock) {
                inventoryWarnings.push(`${recipe.ingredient_name}: not found in inventory`);
                continue;
              }
              const used = Math.max(0, Number(recipe.quantity || 0));
              const before = Number(stock.quantity || 0);
              const after = Math.max(0, before - used);
              const { error: updateError } = await client
                .from("inventory")
                .update({ quantity: after })
                .eq("id", stock.id)
                .eq("shop_id", shopId);
              if (updateError) inventoryWarnings.push(`${stock.name}: ${updateError.message}`);
              else {
                stock.quantity = after;
                inventoryAdjustments.push({ id: stock.id, name: stock.name, used, before, after, unit: stock.unit });
                if (after === 0 && used > before) inventoryWarnings.push(`${stock.name}: recipe needed ${used}, but only ${before} was available`);
              }
            }
          }
        }
      }

      return json(201, { item: data, delivery, inventoryAdjustments, inventoryWarnings });
    }

    if (event.httpMethod === "PATCH") {
      const body = bodyOf(event);
      if (!body.id) return json(400, { error: "Missing order id" });
      const patchValidation = validateOrderPatchBody(body);
      if (!patchValidation.valid) return json(400, { error: patchValidation.errors[0] });
      if (body.action === "MARK_PAID" || body.action === "MARK_UNPAID") return json(400, { error: "Payment status must be changed by recording a payment or refund in the payment ledger." });
      const payload = {};
      const textFields = ["customer_name","customer_phone","occasion","fulfillment","delivery_address","delivery_date","notes","customer_type","recipient_name","recipient_phone","delivery_window","delivery_instructions","order_source","card_message","arrangement_description","location_type","driver","designer","priority","design_style","color_palette","preferred_flowers","flower_restrictions","addons","payment_method","product_id","status"];
      const numberFields = ["subtotal","tax","delivery_fee","tax_rate","amount_paid","delivery_miles","drive_minutes","labor_charge","addon_total","discount","estimated_cost"];
      for (const field of textFields) if (field in body) payload[field] = body[field] || null;
      for (const field of numberFields) if (field in body) payload[field] = Number(body[field] || 0);
      if ("customer_name" in payload && !String(payload.customer_name || "").trim()) return json(400, { error: "Customer name is required" });
      const { data: priorOrder } = await client
        .from("orders")
        .select("status")
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .maybeSingle();
      if ("status" in payload && payload.status) payload.status = normalizeOrderStatus(payload.status);
      const flowers=Number(payload.subtotal||0),labor=Number(payload.labor_charge||0),addons=Number(payload.addon_total||0),discount=Number(payload.discount||0);
      payload.subtotal=Math.max(0,flowers+labor+addons-discount); payload.total=payload.subtotal+Number(payload.tax||0)+Number(payload.delivery_fee||0); payload.balance_due=Math.max(0,payload.total-Number(payload.amount_paid||0));
      payload.payment_status=payload.balance_due<=0&&payload.total>0?"PAID":Number(payload.amount_paid||0)>0?"PARTIAL":"UNPAID";
      const { data, error } = await client.from("orders").update(payload).eq("id",body.id).eq("shop_id",shopId).select().single();
      if (error) throw error;
      if ("status" in payload) {
        await recordOrderStatusChange(client, {
          shopId,
          orderId: data.id,
          fromStatus: priorOrder?.status,
          toStatus: data.status,
          userId: user.id,
        });
      }
      const { data: existingDelivery } = await client.from("deliveries").select("id").eq("shop_id",shopId).eq("order_id",body.id).maybeSingle();
      await writeShopAudit(client, {
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
      await writeShopAudit(client, {
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