import crypto from "node:crypto";
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail, requireRoles, admin, resolveSupabaseServerKey } from "./_shared/supabase.js";
import { writeShopAudit, structuredLog } from "./_shared/production.js";
import {
  validateManualPaymentBody,
  buildPostOrderPaymentRpcArgs,
  mapManualPaymentError,
  applyOrderPaymentFromRpcResult,
  validateSplitPaymentParts,
  buildSplitPartMetadata,
  normalizeMethodForPaymentsTable
} from "./_shared/manual-order-payment.js";
import { executePostOrderPayment } from "./_shared/post-order-payment-execute.js";

const ALLOWED = ["owner", "manager", "cashier", "accountant"];

async function loadOrderForShop(client, shopId, orderId) {
  const { data, error } = await client
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function resolveServiceClient() {
  if (!resolveSupabaseServerKey()) {
    const e = new Error(
      "Cash and manual payments require SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) on this Netlify site. Add it under Site configuration → Environment variables for Production and Deploy previews, then redeploy."
    );
    e.statusCode = 503;
    e.code = "supabase_server_key_missing";
    throw e;
  }
  return admin();
}

async function postOnePayment(service, ctx, orderRow, parsed) {
  const key = parsed.idempotencyKey || crypto.randomUUID();
  const rpcArgs = buildPostOrderPaymentRpcArgs({
    shopId: ctx.shopId,
    orderId: parsed.orderId,
    amount: parsed.amount,
    methodForRpc: parsed.methodForRpc,
    idempotencyKey: key,
    actorUserId: ctx.user.id,
    metadata: parsed.metadata
  });
  return executePostOrderPayment(service, rpcArgs);
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  try {
    const ctx = await currentUser(event);
    requireRoles(ctx, ALLOWED);
    const { client, shopId, user } = ctx;

    if (event.httpMethod === "GET") {
      const orderId = event.queryStringParameters?.order_id;
      let q = client.from("payments").select("*").eq("shop_id", shopId);
      if (orderId) {
        q = q.eq("order_id", orderId).order("received_at", { ascending: true });
      } else {
        q = q.order("received_at", { ascending: false }).limit(500);
      }
      const { data, error } = await q;
      if (error) throw error;
      return json(200, { items: data || [] });
    }

    if (event.httpMethod === "POST") {
      const body = bodyOf(event);
      const service = resolveServiceClient();

      if (body.action === "split" || Array.isArray(body.parts)) {
        const orderId = String(body.order_id || "").trim();
        if (!orderId) return json(400, { error: "Choose an order before split payment." });
        const orderRow = await loadOrderForShop(client, shopId, orderId);
        if (!orderRow) {
          return json(404, { error: "That order was not found in your shop. Refresh orders and try again." });
        }
        const plan = validateSplitPaymentParts(orderRow, body.parts || []);
        if (!plan.valid) return json(400, { error: plan.errors[0], plan });

        const batchId = String(body.split_batch_id || crypto.randomUUID());
        const completed = [];
        const deferredCard = [];
        let latestOrder = orderRow;

        for (const part of plan.parts) {
          if (part.method === "Card") {
            deferredCard.push({
              index: part.index,
              amount: part.amount,
              note: part.note,
              message: "Complete this card amount with Charge card securely (Stripe checkout)."
            });
            continue;
          }
          const methodForRpc = normalizeMethodForPaymentsTable(part.method);
          const parsed = {
            valid: true,
            orderId,
            amount: part.amount,
            method: part.method,
            methodForRpc,
            idempotencyKey: part.idempotencyKey || `${batchId}:part:${part.index}`,
            metadata: buildSplitPartMetadata(part, batchId)
          };
          try {
            const result = await postOnePayment(service, ctx, latestOrder, parsed);
            latestOrder = result.order || latestOrder;
            completed.push({
              index: part.index,
              method: part.method,
              amount: part.amount,
              duplicate: result.duplicate,
              via: result.via
            });
          } catch (partErr) {
            structuredLog("error", "split_payment_part_failed", {
              shopId,
              orderId,
              partIndex: part.index,
              method: part.method,
              amount: part.amount,
              message: partErr.message,
              code: partErr.code
            });
            const mapped = mapManualPaymentError(partErr);
            const partLabel = `Part ${part.index + 1} (${part.method} $${Number(part.amount).toFixed(2)})`;
            const detail = mapped?.message || partErr.message || "could not be posted";
            return json(409, {
              error: `Split payment stopped — ${partLabel}: ${detail}`,
              failed_part: { index: part.index, method: part.method, amount: part.amount },
              completed_parts: completed,
              order: latestOrder,
              plan
            });
          }
        }

        await writeShopAudit(client, {
          shopId,
          userId: user.id,
          eventType: "split_payment_recorded",
          entityType: "order",
          entityId: orderId,
          metadata: { batchId, completed: completed.length, deferred_card: deferredCard.length }
        });

        return json(201, {
          order: latestOrder,
          completed_parts: completed,
          deferred_card_parts: deferredCard,
          plan,
          split_batch_id: batchId
        });
      }

      const parsed = validateManualPaymentBody(body);
      if (!parsed.valid) return json(400, { error: parsed.errors[0] });

      const orderRow = await loadOrderForShop(client, shopId, parsed.orderId);
      if (!orderRow) {
        return json(404, { error: "That order was not found in your shop. Refresh orders and try again." });
      }

      try {
        const result = await postOnePayment(service, ctx, orderRow, parsed);
        await writeShopAudit(client, {
          shopId,
          userId: user.id,
          eventType: "payment_recorded",
          entityType: "order",
          entityId: parsed.orderId,
          metadata: { amount: parsed.amount, method: parsed.method, duplicate: result.duplicate, via: result.via }
        });
        return json(201, {
          ...result,
          order: result.order || orderRow
        });
      } catch (error) {
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
    }

    return methodNotAllowed();
  } catch (error) {
    return fail(error);
  }
}
