/**
 * Stripe Terminal (card-present, in-person payments) — Switching Barrier
 * Register Wave 6. Wired the same way every other cross-module piece of
 * app.js integrates (BloomLilyPlatform, BloomLaunchPolish, …): app.js
 * calls window.BloomPaymentTerminal.init({...}) with the few things this
 * needs (api, toast, money, the pending order, and the same success/
 * processing-state functions the Cash/Check flows already call), since
 * app.js's own Payment Center state (pendingPaymentOrder, etc.) is
 * private to its own closure, not something a second script can reach
 * directly.
 *
 * Testable without physical hardware via Stripe's own officially-
 * supported simulated-reader discovery mode (discoverReaders({simulated:
 * true})) — not a mock this file invented, a real mode Stripe's SDK
 * ships specifically so an integration can be built and verified before
 * a florist has bought a physical reader.
 */
(function () {
  let deps = null;
  let terminal = null;
  let connectedReader = null;
  let sdkLoadPromise = null;

  function panelEls() {
    return {
      panel: document.getElementById("terminalPanel"),
      status: document.getElementById("terminalStatus"),
      connectBtn: document.getElementById("terminalConnect"),
      collectBtn: document.getElementById("terminalCollect"),
      simulatedToggle: document.getElementById("terminalSimulated")
    };
  }

  function setStatus(text) {
    const { status } = panelEls();
    if (status) status.textContent = text;
  }

  function loadSdk() {
    if (window.StripeTerminal) return Promise.resolve(window.StripeTerminal);
    if (sdkLoadPromise) return sdkLoadPromise;
    sdkLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://js.stripe.com/terminal/v1/";
      s.onload = () => (window.StripeTerminal ? resolve(window.StripeTerminal) : reject(new Error("Stripe Terminal script loaded but StripeTerminal is unavailable.")));
      s.onerror = () => reject(new Error("Could not load Stripe's card reader library. Check your connection and try again."));
      document.head.appendChild(s);
    });
    return sdkLoadPromise;
  }

  async function fetchConnectionToken() {
    const d = await deps.api("payment-terminal", { method: "POST", body: JSON.stringify({ action: "connection_token" }) });
    return d.secret;
  }

  function ensureTerminalInstance() {
    if (terminal) return terminal;
    terminal = window.StripeTerminal.create({
      onFetchConnectionToken: fetchConnectionToken,
      onUnexpectedReaderDisconnect: () => {
        connectedReader = null;
        const { collectBtn } = panelEls();
        if (collectBtn) collectBtn.disabled = true;
        setStatus("Reader disconnected — connect again before charging a card.");
      }
    });
    return terminal;
  }

  async function connectReader() {
    const { simulatedToggle, collectBtn } = panelEls();
    const simulated = simulatedToggle ? simulatedToggle.checked : true;
    setStatus("Loading card reader library…");
    await loadSdk();
    const t = ensureTerminalInstance();
    setStatus(simulated ? "Connecting a test reader…" : "Looking for your card reader on this network…");
    const discovered = await t.discoverReaders({ simulated });
    if (discovered.error) throw new Error(discovered.error.message || "Could not search for a reader.");
    const readers = discovered.discoveredReaders || [];
    if (!readers.length) {
      throw new Error(
        simulated
          ? "No test reader found — this shouldn't happen; try again."
          : "No reader found. Make sure it's powered on, on the same network, and paired under Settings → Payments."
      );
    }
    const connected = await t.connectReader(readers[0]);
    if (connected.error) throw new Error(connected.error.message || "Could not connect to the reader.");
    connectedReader = connected.reader;
    if (collectBtn) collectBtn.disabled = false;
    setStatus(`Connected: ${connectedReader.label || connectedReader.device_type || connectedReader.id}${simulated ? " (test reader — no real card will be charged)" : ""}`);
  }

  async function collectPayment(amount) {
    const order = deps.getPendingOrder();
    if (!order?.id) throw new Error("Choose an order first.");
    if (!connectedReader) throw new Error("Connect a card reader first.");
    const t = ensureTerminalInstance();

    setStatus("Starting the charge…");
    const created = await deps.api("payment-terminal", {
      method: "POST",
      body: JSON.stringify({ action: "create_intent", order_id: order.id, amount })
    });

    setStatus("Follow the prompts on the reader — tap, insert, or swipe the card now.");
    const collected = await t.collectPaymentMethod(created.client_secret);
    if (collected.error) throw new Error(collected.error.message || "The card wasn't read. Try again.");

    setStatus("Processing…");
    const processed = await t.processPayment(collected.paymentIntent);
    if (processed.error) throw new Error(processed.error.message || "The card was not approved.");

    setStatus("Confirming…");
    const confirmed = await deps.api("payment-terminal", {
      method: "POST",
      body: JSON.stringify({ action: "confirm", payment_intent_id: processed.paymentIntent.id })
    });
    return confirmed;
  }

  function wire() {
    const { panel, connectBtn, collectBtn } = panelEls();
    const openBtn = document.getElementById("terminalChargeBtn");
    if (!panel || !openBtn) return; // Payment Center markup not on this page.

    openBtn.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden && !connectedReader) setStatus("Not connected — tap Connect reader.");
    });

    connectBtn?.addEventListener("click", async () => {
      connectBtn.disabled = true;
      try {
        await connectReader();
      } catch (err) {
        setStatus(err.message);
        deps.toast?.(err.message);
      } finally {
        connectBtn.disabled = false;
      }
    });

    collectBtn?.addEventListener("click", async () => {
      const amountInput = document.getElementById("cardPaymentAmount");
      const amount = Number(amountInput?.value || 0);
      if (amount < 0.5) {
        setStatus("Enter a charge amount of at least $0.50.");
        return;
      }
      deps.setPaymentProcessing?.(true);
      collectBtn.disabled = true;
      try {
        const result = await collectPayment(amount);
        await deps.refreshAfterPayment?.();
        deps.showPaymentSuccessPanel?.({
          detail: `Card payment received: ${deps.money(amount)}<br>Remaining balance: ${deps.money(result.order?.balance_due ?? 0)}`,
          order: result.order
        });
        deps.toast?.("Card payment recorded");
        panel.hidden = true;
      } catch (err) {
        setStatus(err.message);
        deps.toast?.(err.message);
      } finally {
        deps.setPaymentProcessing?.(false);
        collectBtn.disabled = false;
      }
    });
  }

  function init(dependencies) {
    deps = dependencies;
    wire();
  }

  window.BloomPaymentTerminal = { init };
})();
