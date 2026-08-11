import { sanitizeText, isValidEmail, isSafeRelativePath, createRateLimiter } from "../lib/core/security.js";

describe("security", () => {
  test("sanitizeText strips control chars and caps length", () => {
    expect(sanitizeText("  hello\x00world  ")).toBe("helloworld");
    expect(sanitizeText("a".repeat(9000), 100).length).toBe(100);
  });

  test("isValidEmail accepts common addresses", () => {
    expect(isValidEmail("florist@shop.com")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
  });

  test("isSafeRelativePath rejects traversal", () => {
    expect(isSafeRelativePath("/assets/logo.png")).toBe(true);
    expect(isSafeRelativePath("../etc/passwd")).toBe(false);
  });

  test("rate limiter blocks burst traffic", () => {
    const limiter = createRateLimiter({ capacity: 2, refillPerSec: 0.01 });
    expect(limiter.take("client-a").allowed).toBe(true);
    expect(limiter.take("client-a").allowed).toBe(true);
    expect(limiter.take("client-a").allowed).toBe(false);
  });
});
