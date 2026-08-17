// Tiny server-rendered HTML views — no template engine, just template
// literals. Keeps this sample to one dependency-free layer so the Stripe
// integration code (in server.js) stays the thing you're reading, not
// the templating.

const nav = `
  <nav class="nav">
    <a href="/">Storefront</a>
    <a href="/onboard">Onboard sellers</a>
    <a href="/admin/products">Create products</a>
  </nav>
`;

export function layout(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Stripe Connect sample</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/">Stripe Connect Sample</a>
    ${nav}
  </header>
  <main class="page">
    ${bodyHtml}
  </main>
</body>
</html>`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatMoney(amountInCents, currency = "usd") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format((amountInCents || 0) / 100);
}

export function flashBanner(message, kind = "info") {
  if (!message) return "";
  return `<div class="banner banner-${kind}">${escapeHtml(message)}</div>`;
}

// ---------------------------------------------------------------------
// Storefront: every product, from every connected (onboarded) seller.
// ---------------------------------------------------------------------
export function renderStorefront({ products, flash }) {
  const cards = products.length
    ? products
        .map(
          (p) => `
      <article class="card">
        <h3>${escapeHtml(p.name)}</h3>
        <p class="muted">${escapeHtml(p.description || "")}</p>
        <p class="price">${formatMoney(p.priceAmount, p.priceCurrency)}</p>
        <p class="muted small">Sold by ${escapeHtml(p.sellerLabel)}</p>
        <form method="POST" action="/checkout/${encodeURIComponent(p.id)}">
          <button type="submit" class="btn btn-primary">Buy now</button>
        </form>
      </article>`
        )
        .join("")
    : `<p class="muted">No products yet. <a href="/admin/products">Create one</a> once a seller has finished onboarding.</p>`;

  return layout(
    "Storefront",
    `
    ${flashBanner(flash)}
    <h1>Storefront</h1>
    <p class="muted">Every product here is created at the platform level and sold via a <strong>destination charge</strong> — the customer pays this platform, which takes an application fee and transfers the rest to the seller's connected account.</p>
    <div class="grid">${cards}</div>
  `
  );
}

// ---------------------------------------------------------------------
// Onboarding index: pick a demo user, start or resume Connect onboarding.
// ---------------------------------------------------------------------
export function renderOnboardIndex({ users, flash }) {
  const rows = users
    .map((u) => {
      const action = u.accountId
        ? `<a class="btn btn-secondary" href="/onboard/status/${encodeURIComponent(u.accountId)}">Check onboarding status</a>`
        : `<form method="POST" action="/onboard/start">
             <input type="hidden" name="userId" value="${escapeHtml(u.id)}">
             <button type="submit" class="btn btn-primary">Onboard to collect payments</button>
           </form>`;
      return `
      <article class="card">
        <h3>${escapeHtml(u.name)}</h3>
        <p class="muted small">${escapeHtml(u.email)}</p>
        <p class="muted small">Connected account: ${u.accountId ? `<code>${escapeHtml(u.accountId)}</code>` : "not started"}</p>
        ${action}
      </article>`;
    })
    .join("");

  return layout(
    "Onboard sellers",
    `
    ${flashBanner(flash)}
    <h1>Onboard sellers</h1>
    <p class="muted">Each of these demo "users" becomes its own Stripe connected account. Onboarding status is always read live from Stripe — nothing about *whether onboarding is complete* is cached locally, only the account ID itself.</p>
    <div class="grid">${rows}</div>
  `
  );
}

// ---------------------------------------------------------------------
// Live onboarding status for one connected account.
// ---------------------------------------------------------------------
export function renderOnboardStatus({ accountId, displayName, onboardingComplete, readyToReceivePayments, currentlyDue, pastDue, flash }) {
  const dueList = (items) =>
    items.length ? `<ul>${items.map((i) => `<li><code>${escapeHtml(i)}</code></li>`).join("")}</ul>` : `<p class="muted small">None.</p>`;

  const cta = onboardingComplete
    ? `<p class="status-ok">✅ Onboarding complete. This account can go on to <a href="/admin/products">list products</a>.</p>`
    : `<form method="POST" action="/onboard/continue/${encodeURIComponent(accountId)}">
         <button type="submit" class="btn btn-primary">Continue onboarding</button>
       </form>`;

  return layout(
    "Onboarding status",
    `
    ${flashBanner(flash)}
    <h1>Onboarding status</h1>
    <p class="muted">Account <code>${escapeHtml(accountId)}</code>${displayName ? ` — ${escapeHtml(displayName)}` : ""}</p>

    <section class="card">
      <h2>Ready to receive payments</h2>
      <p>${readyToReceivePayments ? "✅ Yes — the recipient's stripe_transfers capability is active." : "⏳ Not yet — capability is still pending."}</p>
    </section>

    <section class="card">
      <h2>Requirements currently due</h2>
      ${dueList(currentlyDue)}
    </section>

    <section class="card">
      <h2>Requirements past due</h2>
      ${dueList(pastDue)}
    </section>

    ${cta}
    <p><a href="/onboard">&larr; Back to sellers</a></p>
  `
  );
}

// ---------------------------------------------------------------------
// Admin: create a product for a ready connected account.
// ---------------------------------------------------------------------
export function renderAdminProducts({ readyAccounts, products, flash }) {
  const options = readyAccounts
    .map((a) => `<option value="${escapeHtml(a.accountId)}">${escapeHtml(a.name)} (${escapeHtml(a.accountId)})</option>`)
    .join("");

  const form = readyAccounts.length
    ? `
    <form method="POST" action="/admin/products" class="stack">
      <label>Seller
        <select name="accountId" required>${options}</select>
      </label>
      <label>Product name
        <input type="text" name="name" required placeholder="Hand-thrown ceramic mug">
      </label>
      <label>Description
        <input type="text" name="description" placeholder="One-of-a-kind, food safe">
      </label>
      <label>Price (USD)
        <input type="number" name="price" min="0.50" step="0.01" required placeholder="24.00">
      </label>
      <button type="submit" class="btn btn-primary">Create product</button>
    </form>`
    : `<p class="muted">No sellers have finished onboarding yet. <a href="/onboard">Onboard one</a> first.</p>`;

  const list = products.length
    ? `<ul class="plain-list">${products
        .map((p) => `<li><strong>${escapeHtml(p.name)}</strong> — ${formatMoney(p.priceAmount, p.priceCurrency)} — seller <code>${escapeHtml(p.connectedAccountId)}</code></li>`)
        .join("")}</ul>`
    : `<p class="muted small">No products created yet.</p>`;

  return layout(
    "Create products",
    `
    ${flashBanner(flash)}
    <h1>Create a product</h1>
    <p class="muted">Products live at the <strong>platform</strong> level (not on the connected account) — the seller who fulfills each sale is tracked in <code>product.metadata.connected_account_id</code>.</p>
    ${form}
    <h2>Existing products</h2>
    ${list}
  `
  );
}

// ---------------------------------------------------------------------
// Checkout success.
// ---------------------------------------------------------------------
export function renderSuccess({ amountTotal, currency, sellerAccountId, applicationFeeAmount }) {
  return layout(
    "Payment successful",
    `
    <h1>✅ Payment successful</h1>
    <p>You paid <strong>${formatMoney(amountTotal, currency)}</strong>.</p>
    <p class="muted">This platform kept ${formatMoney(applicationFeeAmount, currency)} as its application fee; the rest was transferred straight to the seller's connected account <code>${escapeHtml(sellerAccountId)}</code>.</p>
    <p><a href="/">&larr; Back to the storefront</a></p>
  `
  );
}

export function renderError(status, message) {
  return layout(
    "Error",
    `
    <h1>Something went wrong</h1>
    <p class="banner banner-error">${escapeHtml(message)}</p>
    <p><a href="/">&larr; Back to the storefront</a></p>
  `
  );
}
