import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Bomb(): never {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  it("renders children normally when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>Today's orders</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Today's orders")).toBeInTheDocument();
  });

  it("catches a render error and shows the calm fallback instead of a blank/crashed screen", () => {
    // React logs the caught error to the console by default; keep the test
    // output clean without hiding a real assertion failure.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>,
      );
      expect(screen.getByText("Florisyn needs a moment")).toBeInTheDocument();
      expect(screen.getByText(/Your shop data is safe/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Go to Today" })).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("shows a custom fallback title when one is provided", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <ErrorBoundary fallbackTitle="Orders board needs a moment">
          <Bomb />
        </ErrorBoundary>,
      );
      expect(screen.getByText("Orders board needs a moment")).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});
