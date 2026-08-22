import { test, expect } from "@playwright/test";
import { buildSiteFromShopProfile } from "../../netlify/functions/_shared/bloom-instant-website.js";
import { resolvePublishedSite } from "../../netlify/functions/_shared/bloom-storefront-core.js";

/**
 * Launch-repair Area 6: the real customer-facing journey from a published
 * storefront through to a Florisyn order — browse, add to cart, checkout,
 * and land on either a pay-later confirmation or a real Stripe handoff.
 * Website Studio's editor -> publish path already has coverage
 * (website-studio-full-publish-journey.spec.js); this picks up where that
 * leaves off, on the live storefront a customer actually shops.
 */

const SHOP = {
  id: "shop-1",
  name: "Rose & Co Florist",
  slug: "rose-and-co",
  phone: "(555) 123-4567",
  email: "hello@roseandco.test",
  address: "123 Main St, Austin, TX",
  hours: "Mon-Sat 9am-6pm",
  tax_rate: 8,
};

const PRODUCT = { id: "prod-1", name: "Dozen Roses", retail_price: 65, description: "A classic dozen.", available_online: true };

function buildFixture({ payNow = false } = {}) {
  const site = buildSiteFromShopProfile(SHOP, { status: "published" });
  const resolved = resolvePublishedSite({ ...site.project, status: "published" }, site.pages, SHOP, { preview: false });
  return {
    preview: false,
    site: resolved,
    products: [PRODUCT],
    commerce: {
      online_ordering_enabled: true,
      stripe_checkout_enabled: payNow,
      pay_later_enabled: true,
      stripe_available: payNow,
      payment_modes: payNow ? ["pay_now", "pay_later"] : ["pay_later"],
    },
    domain: { host: resolved.base_url.replace(/^https?:\/\//i, ""), base_url: resolved.base_url, purchased: false, connected: false, status: "bloom_subdomain" },
  };
}

test.describe("Storefront: browse -> cart -> checkout -> real Florisyn order", () => {
  test("pay-later checkout creates a real order and shows the florist-facing confirmation", async ({ page }) => {
    let orderBody = null;
    await page.route("**/.netlify/functions/storefront-public**", async (route) => {
      if (route.request().method() === "POST") {
        orderBody = JSON.parse(route.request().postData() || "{}");
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ order: { id: "order-web-1", order_number: "F-6001" }, handoff: { message: "Order F-6001 submitted. The shop will confirm shortly." } }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(buildFixture()) });
    });

    await page.goto("/store/rose-and-co/shop");
    await expect(page.locator(".product-card", { hasText: "Dozen Roses" })).toBeVisible({ timeout: 10_000 });

    await page.locator(".add-cart").first().click();
    await expect(page.locator("#cartCount")).toHaveText("1");

    await page.locator("#cartBtn").click();
    await expect(page.locator("#cartDrawer")).toBeVisible();
    await expect(page.locator("#cartLines")).toContainText("Dozen Roses");

    await page.fill('#checkoutForm input[name="name"]', "Jamie Rivera");
    await page.fill('#checkoutForm input[name="phone"]', "555-010-1234");
    await page.fill('#checkoutForm input[name="email"]', "jamie@example.invalid");
    await page.selectOption('#checkoutForm select[name="fulfillment"]', "PICKUP");
    await page.fill('#checkoutForm input[name="delivery_date"]', "2026-09-01");
    // pay_later is already checked by default — the honest, always-available path.
    await page.locator("#checkoutSubmit").click();

    await expect.poll(() => orderBody).not.toBeNull();
    expect(orderBody.action).toBe("create_web_order");
    expect(orderBody.shop_slug).toBe("rose-and-co");
    expect(orderBody.payment_mode).toBe("pay_later");
    expect(orderBody.cart.lines).toEqual([{ id: "prod-1", name: "Dozen Roses", price: 65, qty: 1 }]);
    expect(orderBody.customer.name).toBe("Jamie Rivera");
    expect(orderBody.options.fulfillment).toBe("PICKUP");

    await expect(page.locator("#liveRegion")).toContainText("F-6001 submitted");
    // Cart clears after a successful order — no risk of re-submitting it.
    await expect(page.locator("#cartCount")).toHaveText("0");
  });

  test("pay-now checkout hands off to the real Stripe checkout URL the backend returns", async ({ page }) => {
    let checkoutBody = null;
    await page.route("**/.netlify/functions/storefront-public**", async (route) => {
      if (route.request().method() === "POST") {
        checkoutBody = JSON.parse(route.request().postData() || "{}");
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ order: { id: "order-web-2", order_number: "F-6002" }, handoff: { checkout_url: "https://checkout.stripe.com/c/pay/fake-session" } }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(buildFixture({ payNow: true })) });
    });
    // Let the cross-origin navigation "succeed" against a harmless stub
    // instead of aborting it — an abort turns into a chrome-error:// page,
    // which would make the URL assertion below meaningless.
    await page.route("https://checkout.stripe.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>stub</title>" }),
    );

    await page.goto("/store/rose-and-co/shop");
    await expect(page.locator(".product-card", { hasText: "Dozen Roses" })).toBeVisible({ timeout: 10_000 });
    await page.locator(".add-cart").first().click();
    await page.locator("#cartBtn").click();

    await page.fill('#checkoutForm input[name="name"]', "Jamie Rivera");
    await page.fill('#checkoutForm input[name="phone"]', "555-010-1234");
    await page.selectOption('#checkoutForm select[name="fulfillment"]', "PICKUP");
    await page.fill('#checkoutForm input[name="delivery_date"]', "2026-09-01");
    await page.check('#checkoutForm input[name="payment_mode"][value="pay_now"]');
    await page.locator("#checkoutSubmit").click();

    await expect.poll(() => checkoutBody).not.toBeNull();
    expect(checkoutBody.action).toBe("create_web_checkout");
    expect(checkoutBody.payment_mode).toBe("pay_now");
    await expect.poll(() => page.url()).toContain("checkout.stripe.com");
  });

  test("website checkout settings never claim pay-now is available when Stripe isn't configured for this shop", async ({ page }) => {
    await page.route("**/.netlify/functions/storefront-public**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(buildFixture({ payNow: false })) }),
    );

    await page.goto("/store/rose-and-co/shop");
    await expect(page.locator(".product-card", { hasText: "Dozen Roses" })).toBeVisible({ timeout: 10_000 });
    await page.locator(".add-cart").first().click();
    await page.locator("#cartBtn").click();

    // The "pay now" radio's label is hidden entirely when this shop's
    // commerce settings say Stripe isn't available — never a visible
    // button that looks like it takes a card and silently doesn't.
    const payNowLabel = page.locator('#checkoutForm input[name="payment_mode"][value="pay_now"]').locator("..");
    await expect(payNowLabel).toBeHidden();
    await expect(page.locator('#checkoutForm input[name="payment_mode"][value="pay_later"]')).toBeChecked();
    await expect(page.locator("#checkoutPaymentNote")).toContainText("Your florist will confirm the order");
  });
});
