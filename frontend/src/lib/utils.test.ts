import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("joins plain class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    const disabled = false;
    expect(cn("a", disabled && "b", undefined, null, "c")).toBe("a c");
  });

  it("lets a later conflicting Tailwind class win instead of stacking both", () => {
    // tailwind-merge should resolve conflicting utilities, not just concatenate
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
