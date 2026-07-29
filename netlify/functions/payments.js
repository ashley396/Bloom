import crypto from "node:crypto";
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail, requireRoles, admin } from "./_shared/supabase.js";
import { writeShopAudit, structuredLog } from "./_shared/production.js";
import {
  validateManualPaymentBody,
  buildPostOrderPaymentRpcArgs,
  mapManualPaymentError,
  applyOrderPaymentFromRpcResult
} from "./_shared/manual-order-payment.js";

const ALLOWED = ["owner", "manager", "cashier", "accountant"];

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  try {
    const ctx = await currentUser(event);
    requireRoles(ctx, ALLOWED);
    const { client, shopId, user } = ctx;

    if (event.httpMethod === "GET") {
      const { data, error } = await client
        .from("payments")
        .select("*")
        .eq("shop_id", shopId)
        .order("received_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return json(200, { items: data || [] });
    }

    if (event.httpMethod === "POST") {
      const body = bodyOf(event);
      const parsed = validateManualPaymentBody(body);
      if (!parsed.valid) return json(400, { error: parsed.errors[0] });

      const { data: orderRow, error: orderError } = await client
        .from("orders")
        .select("id, shop_id, order_number, customer_name, total, amount_paid, balance_due, payment_status")
        .eq("id", parsed.orderId)
        .eq("shop_id", shopId)
        .maybeSingle();
      if (orderError) throw orderError;
      if (!orderRow) {
        return json(404, { error: "That order was not found in your shop. Refresh orders and try again." });
      }

      const key = parsed.idempotencyKey || crypto.randomUUID();
      const rpcArgs = buildPostOrderPaymentRpcArgs({
        shopId,
        orderId: parsed.orderId,
        amount: parsed.amount,
        methodForRpc: parsed.methodForRpc,
        idempotencyKey: key,
        actorUserId: user.id,
        metadata: parsed.metadata
      });

      const service = admin();
      const { data, error } = await service.rpc("post_order_payment", rpcArgs);
      if (error) {
        structuredLog("error", "post_order_payment_failed", {
          shopId,
          orderId: parsed.orderId,
          amount: parsed.amount,
          method: parsed.method,
          methodForRpc: parsed.methodForRpc,
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint
        });
        const mapped = mapManualPaymentError(error);
        if (mapped) {
          const e = new Error(mapped.message);
          e.statusCode = mapped.statusCode;
          throw e;
        }
        throw error;
      }

      const result = applyOrderPaymentFromRpcResult(data);
      await writeShopAudit(client, {
        shopId,
        userId: user.id,
        eventType: "payment_recorded",
        entityType: "order",
        entityId: parsed.orderId,
        metadata: { amount: parsed.amount, method: parsed.method, duplicate: result.duplicate }
      });

      return json(201, {
        ...result,
        order: result.order || orderRow
      });
    }

    return methodNotAllowed();
  } catch (error) {
    return fail(error);
  }
}
