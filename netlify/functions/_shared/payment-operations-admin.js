/** Admin Payment Operations metrics — separate Bloom SaaS vs florist customer payments. */

export function buildPaymentOperationsMetrics({
  shopSubscriptions = [],
  subscriptionEvents = [],
  floristPayments = [],
  flowerSubs = [],
  paymentLinks = [],
  recoveryAttempts = [],
  recurringRuns = [],
  providerEvents = [],
  webhookFailures = 0
} = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7);

  const bloomActive = shopSubscriptions.filter((s) => s.status === "active" || s.status === "trialing").length;
  const bloomFailed = subscriptionEvents.filter((e) => e.event_type === "payment_failed").length;

  let bloomMrrToday = 0;
  let bloomMrrMonth = 0;
  for (const s of shopSubscriptions) {
    if (s.status !== "active") continue;
    const amt = Number(s.metadata?.mrr ?? (s.plan_code === "professional" ? 79 : 0));
    bloomMrrMonth += amt;
    if ((s.updated_at || s.created_at || "").slice(0, 10) === today) bloomMrrToday += amt;
  }

  const floristVolumeToday = floristPayments
    .filter((p) => (p.received_at || p.created_at || "").slice(0, 10) === today)
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  const floristVolumeMonth = floristPayments
    .filter((p) => (p.received_at || p.created_at || "").slice(0, 7) === monthStart)
    .reduce((s, p) => s + Number(p.amount || 0), 0);

  const flowerRecurring = flowerSubs.filter((s) => s.status === "active").reduce((s, x) => s + Number(x.amount || 0), 0);

  const linksViewed = paymentLinks.filter((l) => l.viewed_at).length;
  const linksPaid = paymentLinks.filter((l) => l.status === "paid").length;
  const linkConversion = linksViewed > 0 ? Math.round((linksPaid / linksViewed) * 1000) / 10 : null;

  const recoverySent = recoveryAttempts.length;
  const recoverySuccess = recoveryAttempts.filter((a) => a.status === "succeeded").length;
  const recoveryRate = recoverySent > 0 ? Math.round((recoverySuccess / recoverySent) * 1000) / 10 : null;

  const attentionRuns = recurringRuns.filter(
    (r) => r.status === "failed" || r.error_message?.includes("attention")
  ).length;

  const emailHealth =
    process.env.BLOOM_EMAIL_PROVIDER ||
    process.env.BLOOM_EMAIL_WEBHOOK_URL ||
    process.env.RESEND_API_KEY
      ? "configured"
      : "not_configured";
  const smsHealth =
    process.env.BLOOM_SMS_PROVIDER || process.env.BLOOM_SMS_WEBHOOK_URL || process.env.TWILIO_AUTH_TOKEN
      ? "configured"
      : "not_configured";

  return {
    bloom_technologies_saas: {
      label: "Revenue paid to Florisyn Technologies (software subscriptions)",
      subscription_revenue_today: bloomMrrToday,
      subscription_revenue_month: bloomMrrMonth,
      active_bloom_subscribers: bloomActive,
      failed_bloom_subscription_payments: bloomFailed
    },
    florist_customer_payments: {
      label: "Revenue processed by individual flower shops for their customers",
      volume_today: Math.round(floristVolumeToday * 100) / 100,
      volume_month: Math.round(floristVolumeMonth * 100) / 100,
      customer_recurring_flower_revenue: Math.round(flowerRecurring * 100) / 100,
      payment_link_conversion_rate: linkConversion,
      recovery_success_rate: recoveryRate
    },
    operations: {
      webhook_failures: webhookFailures,
      notification_email: emailHealth,
      notification_sms: smsHealth,
      recurring_runs_needing_attention: attentionRuns,
      provider_events_recent: providerEvents.length
    }
  };
}
