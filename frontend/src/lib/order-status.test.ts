import { describe, expect, it } from "vitest";
import { normalizeOrderStatus, orderStatusLabel, toPreviewStatus } from "./order-status";

describe("normalizeOrderStatus", () => {
  it("maps the legacy NEW status onto PENDING (matches boardColumnForStatus in production)", () => {
    expect(normalizeOrderStatus("NEW")).toBe("PENDING");
  });

  it("defaults a missing/empty status to PENDING", () => {
    expect(normalizeOrderStatus(null)).toBe("PENDING");
    expect(normalizeOrderStatus(undefined)).toBe("PENDING");
    expect(normalizeOrderStatus("")).toBe("PENDING");
  });

  it("uppercases and passes through known statuses", () => {
    expect(normalizeOrderStatus("designing")).toBe("DESIGNING");
    expect(normalizeOrderStatus("Out_For_Delivery")).toBe("OUT_FOR_DELIVERY");
  });
});

describe("orderStatusLabel", () => {
  it("returns a human label for every mapped status", () => {
    expect(orderStatusLabel("PENDING")).toBe("Pending");
    expect(orderStatusLabel("OUT_FOR_DELIVERY")).toBe("Out for Delivery");
    expect(orderStatusLabel("new")).toBe("Pending"); // routed through normalizeOrderStatus first
  });
});

describe("toPreviewStatus", () => {
  it("collapses the full production vocabulary onto the smaller preview set", () => {
    expect(toPreviewStatus("CONFIRMED")).toBe("pending");
    expect(toPreviewStatus("PICKUP_READY")).toBe("ready");
    expect(toPreviewStatus("COMPLETED")).toBe("delivered");
    expect(toPreviewStatus("CANCELLED")).toBe("cancelled");
  });

  it("falls back to pending for anything unrecognized instead of throwing", () => {
    expect(toPreviewStatus("SOMETHING_NEW_FROM_THE_BACKEND")).toBe("pending");
  });
});
