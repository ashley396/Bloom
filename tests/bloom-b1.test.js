import test from "node:test";
import assert from "node:assert/strict";
import {
  validateOrderCreateBody,
  validateOrderPatchBody
} from "../netlify/functions/_shared/validation.js";
import {
  resolvePublicSiteUrl,
  authRedirectPath
} from "../netlify/functions/_shared/site-url.js";

test("validateOrderCreateBody requires delivery address for DELIVERY", () => {
  const bad = validateOrderCreateBody({
    customer_name: "Sam",
    subtotal: 40,
    fulfillment: "DELIVERY",
    delivery_date: "2026-07-30"
  });
  assert.equal(bad.valid, false);
  assert.match(bad.errors.join(" "), /Delivery address/i);

  const good = validateOrderCreateBody({
    customer_name: "Sam",
    subtotal: 40,
    fulfillment: "DELIVERY",
    delivery_address: "12 Main St, Springfield IL 62701",
    delivery_date: "2026-07-30"
  });
  assert.equal(good.valid, true);
});

test("validateOrderPatchBody requires delivery address when fulfillment is DELIVERY", () => {
  const bad = validateOrderPatchBody({ fulfillment: "DELIVERY", delivery_address: "  " });
  assert.equal(bad.valid, false);
  const good = validateOrderPatchBody({
    fulfillment: "DELIVERY",
    delivery_address: "12 Main St"
  });
  assert.equal(good.valid, true);
});

test("resolvePublicSiteUrl skips localhost fallbacks", () => {
  const url = resolvePublicSiteUrl(
    { URL: "http://localhost:8888", SITE_URL: "https://shop.example.com" },
    "http://127.0.0.1:8888"
  );
  assert.equal(url, "https://shop.example.com");
});

test("authRedirectPath builds verify-email redirect without localhost", () => {
  const redirect = authRedirectPath(
    { SITE_URL: "https://bloom-technologies.netlify.app" },
    "http://localhost:8888",
    "/verify-email?confirmed=1"
  );
  assert.equal(redirect, "https://bloom-technologies.netlify.app/verify-email?confirmed=1");
  assert.doesNotMatch(redirect, /localhost/);
});
