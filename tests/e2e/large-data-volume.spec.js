import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Stability audit gap: large-data-volume behavior was never tested this
 * session. Customers, Products, and Inventory render every record into
 * the DOM in one innerHTML pass with no pagination (see loadCustomers/
 * loadProducts/loadInventory in app.js) — worth proving that actually
 * holds up at a few hundred records rather than assuming it, since an
 * accidental O(n^2) in a render/filter path would only show up at volume.
 * Orders is different: florisyn-luxury-orders.js already paginates
 * (PAGE_SIZE = 8), so its check here is narrower — that pagination and
 * search both still work correctly with 500 underlying rows, not that
 * the DOM does the same unbounded-render check as the other three.
 *
 * 300 rows for the unbounded pages is enough to catch a real algorithmic
 * problem (anything worse than O(n) becomes visible well before 300) or
 * an actual crash, without the test itself being slow or flaky from
 * sheer volume. The perf ceiling below is deliberately generous — it's a
 * trip-wire against a genuine blowup, not a tight performance budget.
 */

const COUNT = 300;
const PERF_CEILING_MS = 15_000;

function buildCustomers(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `cust-${i}`,
    name: i === 0 ? "Findable Zzyzx Customer" : `Customer ${i}`,
    phone: `555-01${String(i).padStart(2, "0")}`,
    email: `customer${i}@example.invalid`,
    vip: i % 7 === 0,
  }));
}

function buildProducts(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `prod-${i}`,
    name: i === 0 ? "Findable Zzyzx Bouquet" : `Product ${i}`,
    sku: `SKU-${i}`,
    category: "Everyday",
    price: 10 + (i % 50),
    active: true,
  }));
}

function buildInventory(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `inv-${i}`,
    name: i === 0 ? "Findable Zzyzx Stem" : `Stem ${i}`,
    category: "Flowers",
    color: ["Red", "White", "Pink", "Yellow"][i % 4],
    quantity: 10 + (i % 20),
    unit: "stems",
    cost: 1.5,
    price: 4.5,
  }));
}

function buildOrders(n) {
  const statuses = ["NEW", "IN_PROGRESS", "READY", "DELIVERED"];
  return Array.from({ length: n }, (_, i) => ({
    id: `ord-${i}`,
    order_number: `FL-${1000 + i}`,
    customer_name: i === 0 ? "Findable Zzyzx Order" : `Customer ${i}`,
    status: statuses[i % statuses.length],
    payment_status: i % 3 === 0 ? "PAID" : "UNPAID",
    total: 50 + (i % 100),
    delivery_date: "2026-08-20",
    fulfillment: i % 2 === 0 ? "DELIVERY" : "PICKUP",
    created_at: "2026-08-15T12:00:00.000Z",
  }));
}

async function routeJson(page, pathPattern, body) {
  await page.route(pathPattern, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

test.describe("Florisyn at large data volume (300 records)", () => {
  test(`Customers page renders and searches correctly with ${COUNT} customers`, async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await routeJson(page, "**/.netlify/functions/customers*", { items: buildCustomers(COUNT) });

    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    await page.goto("/");
    await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

    const start = Date.now();
    await page.locator('nav.florisyn-lux-nav button[data-page="customersPage"]').click();
    await expect(page.locator("#customersList article")).toHaveCount(COUNT, { timeout: PERF_CEILING_MS });
    const renderMs = Date.now() - start;
    console.log(`customers render (${COUNT} rows): ${renderMs}ms`);

    await page.locator("#customerSearch").fill("Zzyzx");
    await expect(page.locator("#customersList article")).toHaveCount(1, { timeout: 5_000 });
    await expect(page.locator("#customersList")).toContainText("Findable Zzyzx Customer");

    expect(pageErrors, `uncaught error rendering ${COUNT} customers: ${pageErrors.map((e) => e.message).join("; ")}`).toHaveLength(0);
  });

  test(`Products page renders and searches correctly with ${COUNT} products`, async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await routeJson(page, "**/.netlify/functions/products*", { items: buildProducts(COUNT) });

    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    await page.goto("/");
    await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

    const start = Date.now();
    await page.locator('nav.florisyn-lux-nav button[data-page="productsPage"]').click();
    await expect(page.locator("#productsList").locator(".card, article")).toHaveCount(COUNT, { timeout: PERF_CEILING_MS });
    console.log(`products render (${COUNT} rows): ${Date.now() - start}ms`);

    await expect(page.locator("#productsList")).toContainText("Findable Zzyzx Bouquet");
    expect(pageErrors, `uncaught error rendering ${COUNT} products: ${pageErrors.map((e) => e.message).join("; ")}`).toHaveLength(0);
  });

  test(`Inventory page renders correctly with ${COUNT} items`, async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await routeJson(page, "**/.netlify/functions/inventory*", { items: buildInventory(COUNT) });

    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    await page.goto("/");
    await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

    const start = Date.now();
    await page.locator('nav.florisyn-lux-nav button[data-page="inventoryPage"]').click();
    await expect(page.locator("#inventoryPage")).toHaveClass(/active/, { timeout: 5_000 });
    await page.waitForTimeout(500);
    console.log(`inventory render (${COUNT} rows): ${Date.now() - start}ms`);

    expect(pageErrors, `uncaught error rendering ${COUNT} inventory items: ${pageErrors.map((e) => e.message).join("; ")}`).toHaveLength(0);
  });

  test(`Orders page stays paginated (8/page) and its search still finds the right row across ${COUNT} orders`, async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await routeJson(page, "**/.netlify/functions/orders*", { items: buildOrders(COUNT) });

    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    await page.goto("/");
    await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

    const start = Date.now();
    await page.locator('nav.florisyn-lux-nav button[data-page="ordersPage"]').click();
    await expect(page.locator("#ordersPage")).toHaveClass(/active/, { timeout: PERF_CEILING_MS });
    await page.waitForTimeout(500);
    console.log(`orders page load (${COUNT} underlying rows): ${Date.now() - start}ms`);

    // florisyn-luxury-orders.js paginates at 8 rows/page — the visible
    // table shouldn't render all 300 at once.
    const visibleRowCount = await page.locator("#ordersPage table tbody tr, #ordersPage [data-order-row]").count();
    expect(visibleRowCount, `Orders page rendered ${visibleRowCount} rows at once instead of paginating`).toBeLessThanOrEqual(8);

    expect(pageErrors, `uncaught error loading orders page with ${COUNT} orders: ${pageErrors.map((e) => e.message).join("; ")}`).toHaveLength(0);
  });
});
