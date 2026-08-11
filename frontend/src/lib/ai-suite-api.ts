/**
 * AI Suite API client for React frontend (mirrors public/ai-suite-hub.js).
 */
const API_BASE = import.meta.env.VITE_FLORISYN_API || "";

export type AiSuiteAction =
  | "suite_status"
  | "marketing_segment"
  | "marketing_strategy"
  | "photo_analyze"
  | "pos_realtime_kpis";

export async function callAiSuite<T>(
  action: AiSuiteAction,
  payload: Record<string, unknown> = {},
  token?: string | null
): Promise<T> {
  const res = await fetch(`${API_BASE}/.netlify/functions/ai-suite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `AI Suite error (${res.status})`);
  return data;
}
