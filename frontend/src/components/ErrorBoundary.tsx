import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";

type Props = { children: ReactNode; fallbackTitle?: string };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Florisyn ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-lg rounded-2xl bg-warm-white p-10 text-center shadow-card ring-1 ring-florisyn-border">
          <p className="text-label">Something went wrong</p>
          <h1 className="font-serif-display mt-3 text-2xl font-medium text-charcoal">
            {this.props.fallbackTitle ?? "Florisyn needs a moment"}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-charcoal-muted">
            Your shop data is safe. Refresh the page or return to Today.
          </p>
          <button
            type="button"
            className="mt-6 rounded-xl bg-blush-500 px-6 py-3 text-sm font-medium text-white"
            onClick={() => window.location.assign("/today")}
          >
            Go to Today
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
