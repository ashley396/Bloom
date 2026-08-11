/** Bloom Launch Polish v1 — shared UI helpers (testable, no DOM). */

export const ONBOARDING_KEYS = {
  florist: "bloom_onboarding_florist_v1",
  wholesaler: "bloom_onboarding_wholesaler_v1",
  admin: "bloom_onboarding_admin_v1"
};

export const FLORIST_CHECKLIST = [
  { id: "shop", label: "Confirm shop name and branding", page: "settingsPage" },
  { id: "inventory", label: "Add your first inventory stems", page: "inventoryPage" },
  { id: "product", label: "Create a product with a photo", page: "productsPage" },
  { id: "order", label: "Run a test order on the register", page: "dashboardPage" },
  { id: "website", label: "Preview your website studio", page: "websitePage" },
  { id: "lily", label: "Say hello to Lily", page: "dashboardPage", lily: true }
];

export const WHOLESALE_CHECKLIST = [
  { id: "verify", label: "Complete wholesale verification", page: "marketplacePage" },
  { id: "listing", label: "Publish your first listing", page: "wholesaleSellerPage" },
  { id: "photos", label: "Add product photos", page: "wholesaleSellerPage" }
];

export const ADMIN_CHECKLIST = [
  { id: "dashboard", label: "Review executive dashboard", view: "overview" },
  { id: "health", label: "Check system health", view: "systemHealth" },
  { id: "flags", label: "Review feature flags", view: "featureFlags" },
  { id: "lily", label: "Ask Lily about platform metrics", lily: true }
];

export function bloomEmptyState({ title = "Nothing here yet", message = "", actionLabel = "", actionId = "" } = {}) {
  const action = actionLabel
    ? `<button type="button" class="primary bloom-empty-action" ${actionId ? `data-empty-action="${actionId}"` : ""}>${escapeHtml(actionLabel)}</button>`
    : "";
  return `<div class="bloom-empty-state" role="status">
    <span class="bloom-empty-icon" aria-hidden="true">🌸</span>
    <strong>${escapeHtml(title)}</strong>
    ${message ? `<p>${escapeHtml(message)}</p>` : ""}
    ${action}
  </div>`;
}

export function bloomErrorState({ title = "Something went wrong", message = "", retryId = "bloom-retry" } = {}) {
  return `<div class="bloom-error-state" role="alert">
    <span class="bloom-empty-icon" aria-hidden="true">⚠</span>
    <strong>${escapeHtml(title)}</strong>
    ${message ? `<p>${escapeHtml(message)}</p>` : ""}
    <button type="button" class="secondary bloom-retry-btn" data-retry="${escapeHtml(retryId)}">Try again</button>
  </div>`;
}

export function bloomOfflineState() {
  return bloomErrorState({
    title: "You appear to be offline",
    message: "Florisyn will reconnect when your network returns. Saved work on this device is still available.",
    retryId: "bloom-offline-retry"
  });
}

export function bloomLoadingSkeleton(variant = "cards", count = 3) {
  const n = Math.max(1, Math.min(8, Number(count) || 3));
  if (variant === "table") {
    return `<div class="bloom-skeleton-table" aria-busy="true" aria-label="Loading">${Array.from({ length: n })
      .map(() => `<div class="bloom-skeleton-row"></div>`)
      .join("")}</div>`;
  }
  return `<div class="bloom-skeleton-grid" aria-busy="true" aria-label="Loading">${Array.from({ length: n })
    .map(() => `<div class="bloom-skeleton-card"></div>`)
    .join("")}</div>`;
}

export function parseProductImages(product = {}) {
  const urls = [];
  const push = (u) => {
    const s = String(u || "").trim();
    if (s && /^https?:\/\//i.test(s) && !urls.includes(s)) urls.push(s);
  };
  if (Array.isArray(product.images)) {
    product.images.forEach((x) => push(typeof x === "string" ? x : x?.url));
  }
  if (Array.isArray(product.gallery_urls)) product.gallery_urls.forEach(push);
  if (typeof product.gallery_urls === "string") product.gallery_urls.split(/[\n,]+/).forEach(push);
  const raw = String(product.image_url || "").trim();
  if (raw.includes("\n") || raw.includes(",")) raw.split(/[\n,]+/).forEach(push);
  else push(raw);
  return urls;
}

export function onboardingProgress(checklist, completedIds = []) {
  const done = new Set(completedIds || []);
  const total = checklist.length;
  const complete = checklist.filter((s) => done.has(s.id)).length;
  return {
    total,
    complete,
    percent: total ? Math.round((complete / total) * 100) : 0,
    remaining: checklist.filter((s) => !done.has(s.id))
  };
}

export function helpCopyForPage(pageId = "") {
  const map = {
    posPage: {
      title: "Point of Sale",
      body: "Tap a tool above, then ring up the sale.",
      learn: "/help/index.html"
    },
    dashboardPage: {
      title: "Point of Sale",
      body: "Ring up orders, track today’s progress, and use product pads for fast sales.",
      learn: "/help/index.html"
    },
    ordersPage: { title: "Orders", body: "Track production from new order through delivery.", learn: "/help/order-delivery/index.html" },
    deliveriesPage: { title: "Deliveries", body: "Route stops, drivers, and delivery status.", learn: "/help/order-delivery/index.html" },
    customersPage: { title: "Customers", body: "CRM for walk-ins, VIPs, and business accounts.", learn: "/help/faqs/index.html" },
    inventoryPage: { title: "Inventory", body: "Stem counts, vase life, and low-stock alerts.", learn: "/help/faqs/index.html" },
    productsPage: { title: "Products", body: "Customer-facing items plus internal recipes.", learn: "/help/faqs/index.html" },
    marketplacePage: { title: "Wholesale marketplace", body: "Browse verified suppliers and manage verification.", learn: "/help/faqs/index.html" },
    wholesaleSellerPage: { title: "Seller dashboard", body: "Draft, preview, and publish wholesale products.", learn: "/help/faqs/index.html" },
    reportsPage: { title: "Reports", body: "Revenue, expenses, and margin at a glance.", learn: "/help/faqs/index.html" },
    websitePage: { title: "Website studio", body: "Edit homepage, SEO, and online product presentation.", learn: "/help/faqs/index.html" },
    aiStudioPage: { title: "Lily AI Studio", body: "Draft marketing and website copy with Lily.", learn: "/help/chat/index.html" },
    staffPage: { title: "Staff", body: "Employees, clock-in, and payroll fields.", learn: "/help/faqs/index.html" },
    settingsPage: { title: "Settings", body: "Branding, tax, and shop profile.", learn: "/help/contact/index.html" }
  };
  return (
    map[pageId] || {
      title: "Florisyn",
      body: "Use Lily for quick actions or open Help for guides.",
      learn: "/help/index.html"
    }
  );
}

export function escapeHtml(v = "") {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Short-lived GET cache to reduce duplicate API calls during navigation. */
export function createGetCache(ttlMs = 4000) {
  const store = new Map();
  return {
    get(key) {
      const row = store.get(key);
      if (!row) return null;
      if (Date.now() - row.at > ttlMs) {
        store.delete(key);
        return null;
      }
      return row.value;
    },
    set(key, value) {
      store.set(key, { at: Date.now(), value });
    },
    clear() {
      store.clear();
    }
  };
}

export function wrapApiWithCache(apiFn, cache = createGetCache()) {
  return async function cachedApi(path, opt = {}, auth = true) {
    const method = String(opt.method || "GET").toUpperCase();
    if (method === "GET") {
      const hit = cache.get(path);
      if (hit) return hit;
      const value = await apiFn(path, opt, auth);
      cache.set(path, value);
      return value;
    }
    const result = await apiFn(path, opt, auth);
    if (path.startsWith("settings") || path.startsWith("inventory") || path.startsWith("orders")) {
      cache.clear();
    }
    return result;
  };
}
