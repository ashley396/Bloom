import test from "node:test";
import assert from "node:assert/strict";
import {
  PRICING_TIERS,
  ANNUAL_MONTHS_FREE,
  annualTotal,
  annualMonthlyDisplay,
  planQuote,
  validSubscriptionPrices,
  tierBySignupCode
} from "../lib/pricing/florisyn-pricing.js";
import { PRICING_TIERS as PUBLIC_TIERS, ANNUAL_MONTHS_FREE as PUBLIC_FREE, formatPlanPriceHeadline, planQuote as publicPlanQuote } from "../public/pricing-catalog.js";

test("annual billing charges ten months (two months free)", () => {
  assert.equal(ANNUAL_MONTHS_FREE, 2);
  assert.equal(annualTotal(59), 590);
  assert.equal(annualTotal(99), 990);
  assert.equal(annualTotal(149), 1490);
});

test("annual display uses rounded monthly equivalent", () => {
  assert.equal(annualMonthlyDisplay(59), 49);
  assert.equal(annualMonthlyDisplay(99), 83);
  assert.equal(annualMonthlyDisplay(149), 124);
});

test("plan quotes include savings on annual interval", () => {
  const pro = planQuote("professional", "annual");
  assert.equal(pro.billed, 990);
  assert.equal(pro.display, 83);
  assert.equal(pro.savings, 198);
});

test("valid subscription prices include monthly and annual totals", () => {
  const prices = validSubscriptionPrices();
  assert.ok(prices.includes(59));
  assert.ok(prices.includes(590));
  assert.ok(prices.includes(99));
  assert.ok(prices.includes(990));
});

test("signup codes map to billing tiers", () => {
  assert.equal(tierBySignupCode("pro")?.code, "professional");
  assert.equal(tierBySignupCode("starter")?.monthly, 59);
});

test("annual UI headline shows yearly charge (not amortized monthly only)", () => {
  const quote = publicPlanQuote(99, "annual");
  const headline = formatPlanPriceHeadline(quote, "annual");
  assert.equal(headline.amount, "$990");
  assert.equal(headline.suffix, "/yr");
  assert.match(headline.note, /\$83\/mo equivalent/);
});

test("public pricing catalog stays aligned with server catalog", () => {
  assert.equal(PUBLIC_FREE, ANNUAL_MONTHS_FREE);
  assert.equal(PUBLIC_TIERS.length, PRICING_TIERS.length);
  for (let i = 0; i < PRICING_TIERS.length; i += 1) {
    assert.equal(PUBLIC_TIERS[i].code, PRICING_TIERS[i].code);
    assert.equal(PUBLIC_TIERS[i].monthly, PRICING_TIERS[i].monthly);
    assert.equal(PUBLIC_TIERS[i].signupCode, PRICING_TIERS[i].signupCode);
  }
});
