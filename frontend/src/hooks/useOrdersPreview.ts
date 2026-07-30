import { useEffect, useMemo, useState } from "react";
import { ordersSample } from "../lib/orders-sample";
import {
  fetchProductionOrders,
  fetchReactOrdersPreviewEnabled,
} from "../lib/orders-api";

type PreviewState = {
  enabled: boolean;
  loading: boolean;
  error: string | null;
  orders: typeof ordersSample;
  usingFallback: boolean;
};

function readSessionToken(): string | null {
  try {
    const raw = localStorage.getItem("bloom_session");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { accessToken?: string };
    return parsed.accessToken || null;
  } catch {
    return null;
  }
}

export function useOrdersPreview(): PreviewState {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState(ordersSample);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const flagOn = await fetchReactOrdersPreviewEnabled();
        if (cancelled) return;
        setEnabled(flagOn);
        if (!flagOn) {
          setOrders(ordersSample);
          setUsingFallback(true);
          return;
        }
        const token = readSessionToken();
        if (!token) {
          setUsingFallback(true);
          setOrders(ordersSample);
          setError("Sign in to the production app to preview live orders.");
          return;
        }
        const live = await fetchProductionOrders(token);
        if (cancelled) return;
        setOrders(live.length ? live : ordersSample);
        setUsingFallback(live.length === 0);
      } catch (err) {
        if (cancelled) return;
        setUsingFallback(true);
        setOrders(ordersSample);
        setError(err instanceof Error ? err.message : "Could not load orders.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(
    () => ({ enabled, loading, error, orders, usingFallback }),
    [enabled, loading, error, orders, usingFallback],
  );
}
