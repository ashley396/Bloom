import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";

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

      if (!body.customer_name) {
        return json(400, { error: "Customer name is required" });
      }

      const flowers = Number(body.subtotal || 0);
      const labor = Number(body.labor_charge || 0);
      const addons = Number(body.addon_total || 0);
      const discount = Number(body.discount || 0);
      const subtotal = Math.max(0, flowers + labor + addons - discount);
      const tax = Number(body.tax || 0);
      const deliveryFee = Number(body.delivery_fee || 0);

      const payload = {
        user_id: user.id,
        shop_id: shopId,
        order_number: orderNumber(),
        customer_name: body.customer_name.trim(),
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
      if (!body.id) return json(400,{error:"Missing order id."});
      if(body.action === "MARK_PAID" || body.action === "MARK_UNPAID"){
        return json(400,{error:"Payment status must be changed by recording a payment or refund in the payment ledger."});
      }
      const editable=["customer_name","customer_phone","occasion","fulfillment","delivery_address","delivery_date","notes","tax_rate","recipient_name","recipient_phone","delivery_window","delivery_instructions","delivery_miles","drive_minutes","order_source","card_message","arrangement_description","location_type","driver","designer","priority","design_style","color_palette","preferred_flowers","flower_restrictions","addons","labor_charge","addon_total","discount","estimated_cost","product_id","customer_type","payment_required"];
      const payload={};for(const field of editable)if(field in body)payload[field]=body[field]===""?null:body[field];
      if("status" in body)payload.status=String(body.status||"NEW").toUpperCase();
      if(["subtotal","labor_charge","addon_total","discount","tax_rate","delivery_fee","tax"].some(k=>k in body)){
        const {data:existing,error:readError}=await client.from("orders").select("subtotal,labor_charge,addon_total,discount,tax_rate,delivery_fee,amount_paid").eq("id",body.id).eq("shop_id",shopId).single();if(readError)throw readError;
        const flowers=Number(body.subtotal??existing.subtotal??0),labor=Number(body.labor_charge??existing.labor_charge??0),addons=Number(body.addon_total??existing.addon_total??0),discount=Number(body.discount??existing.discount??0),deliveryFee=Number(body.delivery_fee??existing.delivery_fee??0),rate=Number(body.tax_rate??existing.tax_rate??0),subtotal=Math.max(0,flowers+labor+addons-discount),tax="tax" in body?Number(body.tax||0):Math.round(subtotal*(rate/100)*100)/100,total=subtotal+tax+deliveryFee,paid=Number(existing.amount_paid||0);
        Object.assign(payload,{subtotal,tax,tax_rate:rate,delivery_fee:deliveryFee,total,balance_due:Math.max(0,total-paid),payment_status:paid<=0?"UNPAID":paid>=total?"PAID":"PARTIAL"});
      }
      const { data, error } = await client.from("orders").update(payload).eq("id",body.id).eq("shop_id",shopId).select().single();
      if (error) throw error;
      return json(200, { item: data });
    }

    if (event.httpMethod === "DELETE") {
      const body=bodyOf(event);if(!body.id)return json(400,{error:"Missing order id."});
      const {data:payments,error:paymentError}=await client.from("payment_transactions").select("id").eq("shop_id",shopId).eq("order_id",body.id).limit(1);if(paymentError)throw paymentError;
      if(payments?.length)return json(409,{error:"This order has recorded payments and cannot be deleted. Keep it for the payment audit trail."});
      await client.from("deliveries").delete().eq("shop_id",shopId).eq("order_id",body.id);
      const {error}=await client.from("orders").delete().eq("id",body.id).eq("shop_id",shopId);if(error)throw error;
      return json(200,{ok:true});
    }

    return methodNotAllowed();
  } catch (error) {
    return fail(error);
  }
}