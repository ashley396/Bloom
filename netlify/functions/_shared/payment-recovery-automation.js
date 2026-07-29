/** Payment recovery automation — stops when paid or canceled. */

import { planRecoveryAttempt } from "./payment-hub-experience.js";
import { sendPaymentReminderEmail, sendPaymentFailedEmail } from "./notification-email.js";
import { sendPaymentReminderSms, sendPaymentFailedSms } from "./notification-sms.js";
import { assertSmsConsent } from "./notification-sms.js";

export function shouldStopRecovery({ order, subscription, link }) {
  if (order?.payment_status === "PAID") return { stop: true, reason: "order_paid" };
  if (subscription?.status === "cancelled") return { stop: true, reason: "subscription_canceled" };
  if (link?.status === "paid") return { stop: true, reason: "link_paid" };
  const balance = Math.max(0, Number(order?.total || 0) - Number(order?.amount_paid || 0));
  if (balance <= 0.01) return { stop: true, reason: "zero_balance" };
  return { stop: false };
}

export async function runPaymentRecovery(ctx) {
  const { client, config, order, customer, shop, attemptNumber, payUrl, env } = ctx;
  const stop = shouldStopRecovery({ order, subscription: ctx.subscription, link: ctx.link });
  if (stop.stop) return { stopped: true, reason: stop.reason };

  const plan = planRecoveryAttempt(attemptNumber, config);
  if (!plan.should_retry) return { exhausted: true, plan };

  const results = { attempt: plan.attempt, channels: [] };

  if (plan.send_email && customer?.email) {
    const r = await sendPaymentReminderEmail(
      {
        to: customer.email,
        shopName: shop?.name,
        customerName: customer.name,
        amountDue: Math.max(0, Number(order.total) - Number(order.amount_paid || 0)),
        payUrl
      },
      env
    );
    results.channels.push({ channel: "email", ...r });
  }

  if (plan.send_sms && customer?.phone) {
    const consent = assertSmsConsent(customer);
    if (consent.allowed) {
      const r = await sendPaymentReminderSms(
        {
          to: customer.phone,
          shopName: shop?.name,
          amountDue: Math.max(0, Number(order.total) - Number(order.amount_paid || 0)),
          payUrl
        },
        env
      );
      results.channels.push({ channel: "sms", ...r });
    } else {
      results.channels.push({ channel: "sms", ok: false, code: "no_consent" });
    }
  }

  if (plan.notify_florist) results.notify_florist = true;
  if (plan.send_payment_link && payUrl) results.payment_link = payUrl;

  return { plan, results, next_retry_at: plan.next_retry_at };
}

export async function notifyPaymentFailed(ctx) {
  const { customer, shop, payUrl, env } = ctx;
  const out = {};
  if (customer?.email) {
    out.email = await sendPaymentFailedEmail({ to: customer.email, shopName: shop?.name, customerName: customer.name, amountDue: ctx.amountDue, payUrl }, env);
  }
  if (customer?.phone && assertSmsConsent(customer).allowed) {
    out.sms = await sendPaymentFailedSms({ to: customer.phone, shopName: shop?.name, payUrl }, env);
  }
  return out;
}
