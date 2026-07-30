/**
 * Stripe key mode detection — never auto-switch test ↔ live.
 */

export function stripeKeyMode(secretKey) {
  const key = String(secretKey || "").trim();
  if (!key) return "unconfigured";
  if (key.startsWith("sk_live")) return "live";
  if (key.startsWith("sk_test")) return "test";
  return "unknown";
}

/** Reject webhook events whose livemode flag disagrees with the configured secret key. */
export function assertStripeLivemodeMatchesKey(secretKey, livemode) {
  const mode = stripeKeyMode(secretKey);
  if (mode === "unconfigured") {
    return { ok: false, reason: "Stripe is not configured." };
  }
  if (mode === "unknown") {
    return { ok: false, reason: "Stripe secret key format is unrecognized." };
  }
  const eventMode = livemode ? "live" : "test";
  if (mode !== eventMode) {
    return {
      ok: false,
      reason: `Stripe webhook livemode (${eventMode}) does not match configured key mode (${mode}).`,
    };
  }
  return { ok: true, mode };
}
