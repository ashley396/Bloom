/** Payment Hub Pro v1.1 — provider registry and universal adapter interface. */

export const PROVIDER_IDS = ["stripe", "square", "clover", "paypal", "authorize_net"];

export const PROVIDER_CATALOG = {
  stripe: { label: "Stripe", integrated: true, supports: ["card", "apple_pay", "google_pay", "afterpay", "klarna"] },
  square: { label: "Square", integrated: false, supports: ["card"] },
  clover: { label: "Clover", integrated: false, supports: ["card"] },
  paypal: { label: "PayPal", integrated: false, supports: ["card"] },
  authorize_net: { label: "Authorize.net", integrated: false, supports: ["card", "ach"] }
};

function baseAdapter(providerId) {
  return {
    id: providerId,
    async connect() {
      return { ok: false, error: "Not implemented" };
    },
    async disconnect() {
      return { ok: true };
    },
    async reconnect() {
      return this.connect();
    },
    async health() {
      const s = await this.status();
      return { healthy: Boolean(s.connected && !s.error), ...s };
    },
    async authorize() {
      return { ok: false, error: "Not implemented" };
    },
    async capture() {
      return { ok: false, error: "Not implemented" };
    },
    async refund() {
      return { ok: false, error: "Not implemented" };
    },
    async void() {
      return { ok: false, error: "Not implemented" };
    },
    async tokenize() {
      return { ok: false, error: "Never store PAN/CVV — use provider tokenization when integrated." };
    },
    async listTransactions() {
      return { ok: true, items: [] };
    },
    async sync() {
      return { ok: true, synced_at: new Date().toISOString(), items: 0 };
    },
    async status() {
      return { connected: false, mode: "test", last_sync: null };
    }
  };
}

export function createProviderAdapter(providerId, { stripeClient, shop = {}, env = process.env } = {}) {
  const base = baseAdapter(providerId);

  if (providerId === "stripe") {
    return {
      ...base,
      async connect() {
        if (!env.STRIPE_SECRET_KEY) {
          return { ok: false, error: "Stripe is not configured on the server." };
        }
        if (shop.stripe_connect_account_id) {
          return { ok: true, provider_ref: shop.stripe_connect_account_id, message: "Already connected." };
        }
        return { ok: true, needs_onboarding: true, message: "Use Connect onboarding via stripe-connect function." };
      },
      async disconnect() {
        return { ok: true, message: "Disconnect clears Bloom reference only; revoke in Stripe Dashboard." };
      },
      async reconnect() {
        return this.connect();
      },
      async status() {
        const live = Boolean(env.STRIPE_SECRET_KEY?.startsWith("sk_live"));
        if (!env.STRIPE_SECRET_KEY) {
          return {
            connected: false,
            mode: "unconfigured",
            last_sync: new Date().toISOString(),
            detail: "Missing STRIPE_SECRET_KEY",
            webhook_status: "unknown",
            permissions_ok: false
          };
        }
        if (!shop.stripe_connect_account_id) {
          return {
            connected: false,
            mode: live ? "live" : "test",
            last_sync: new Date().toISOString(),
            detail: "Platform Stripe available; Connect account not linked",
            webhook_status: "configured_platform",
            permissions_ok: true
          };
        }
        if (!stripeClient) {
          return {
            connected: true,
            mode: live ? "live" : "test",
            provider_ref: shop.stripe_connect_account_id,
            last_sync: new Date().toISOString(),
            webhook_status: "assumed_ok",
            permissions_ok: true
          };
        }
        try {
          const account = await stripeClient.accounts.retrieve(shop.stripe_connect_account_id);
          return {
            connected: true,
            mode: account.livemode ? "live" : "test",
            charges_enabled: account.charges_enabled,
            payouts_enabled: account.payouts_enabled,
            provider_ref: account.id,
            last_sync: new Date().toISOString(),
            webhook_status: account.charges_enabled ? "active" : "pending",
            permissions_ok: Boolean(account.charges_enabled)
          };
        } catch (error) {
          return {
            connected: false,
            mode: live ? "live" : "test",
            error: error.message,
            last_sync: new Date().toISOString(),
            webhook_status: "error",
            permissions_ok: false
          };
        }
      },
      async health() {
        const s = await this.status();
        return {
          healthy: Boolean(s.connected && !s.error && s.permissions_ok !== false),
          degraded: Boolean(s.error),
          ...s
        };
      },
      async authorize({ amount, currency = "usd", metadata = {} }) {
        if (!stripeClient) return { ok: false, error: "Stripe client unavailable" };
        return { ok: true, processor: "stripe", intent: "checkout_session", amount, currency, metadata };
      },
      async capture({ sessionId }) {
        return { ok: true, processor: "stripe", captured: Boolean(sessionId), message: "Capture handled by Stripe Checkout webhook." };
      },
      async refund({ paymentIntentId, amount, reason }) {
        if (!stripeClient || !paymentIntentId) return { ok: false, error: "Payment reference required" };
        const refund = await stripeClient.refunds.create({
          payment_intent: paymentIntentId,
          amount: amount ? Math.round(Number(amount) * 100) : undefined,
          metadata: reason ? { bloom_reason: String(reason).slice(0, 64) } : undefined
        });
        return { ok: true, processor: "stripe", refund_id: refund.id, status: refund.status };
      },
      async void() {
        return { ok: false, error: "Use refund for Stripe Checkout payments." };
      },
      async tokenize() {
        return { ok: true, processor: "stripe", message: "Use Stripe Checkout or Elements — Bloom stores provider refs only." };
      },
      async listTransactions({ limit = 25 } = {}) {
        if (!stripeClient) return { ok: false, error: "Stripe client unavailable" };
        const params = { limit: Math.min(100, limit) };
        if (shop.stripe_connect_account_id) {
          params.transfer_data = undefined;
        }
        const intents = await stripeClient.paymentIntents.list(params);
        return {
          ok: true,
          items: (intents.data || []).map((pi) => ({
            id: pi.id,
            amount: pi.amount / 100,
            status: pi.status,
            created: pi.created
          }))
        };
      },
      async sync() {
        const s = await this.status();
        let pending_payouts = 0;
        if (stripeClient && shop.stripe_connect_account_id) {
          try {
            const balance = await stripeClient.balance.retrieve({ stripeAccount: shop.stripe_connect_account_id });
            pending_payouts = (balance.pending || []).reduce((sum, b) => sum + Number(b.amount || 0), 0) / 100;
          } catch {
            pending_payouts = 0;
          }
        }
        return {
          ok: true,
          synced_at: new Date().toISOString(),
          status: s,
          pending_payouts
        };
      }
    };
  }

  const catalog = PROVIDER_CATALOG[providerId];
  if (!catalog) return base;

  return {
    ...base,
    async status() {
      return {
        connected: false,
        mode: "coming_soon",
        coming_soon: true,
        last_sync: null,
        webhook_status: "n/a",
        permissions_ok: false,
        detail: `${catalog.label} adapter ready; connect flow ships in a future release.`
      };
    },
    async health() {
      const s = await this.status();
      return { healthy: false, coming_soon: true, ...s };
    },
    async connect() {
      return { ok: false, coming_soon: true, error: `${catalog.label} connection is coming soon.` };
    },
    async sync() {
      return { ok: false, coming_soon: true, synced_at: null };
    }
  };
}

export function resolveDefaultProvider(connections = [], explicitDefault = null) {
  if (explicitDefault && PROVIDER_IDS.includes(explicitDefault)) {
    const row = connections.find((c) => c.provider_id === explicitDefault && c.status === "connected");
    if (row) return explicitDefault;
  }
  const connected = connections.find((c) => c.status === "connected" && PROVIDER_CATALOG[c.provider_id]?.integrated);
  if (connected) return connected.provider_id;
  if (process.env.STRIPE_SECRET_KEY) return "stripe";
  return null;
}

export function sanitizeProviderRow(row = {}) {
  return {
    provider_id: row.provider_id,
    status: row.status,
    mode: row.mode,
    is_default: Boolean(row.is_default),
    provider_ref: row.provider_ref ? String(row.provider_ref).slice(0, 64) : null,
    last_sync_at: row.last_sync_at,
    coming_soon: Boolean(row.coming_soon),
    health_status: row.health_status || null,
    webhook_status: row.webhook_status || null,
    permissions_ok: row.permissions_ok !== false
  };
}

export const REQUIRED_PROVIDER_METHODS = [
  "connect",
  "disconnect",
  "health",
  "authorize",
  "capture",
  "refund",
  "void",
  "tokenize",
  "listTransactions",
  "sync",
  "status"
];

export function adapterImplementsInterface(adapter) {
  return REQUIRED_PROVIDER_METHODS.every((m) => typeof adapter[m] === "function");
}
