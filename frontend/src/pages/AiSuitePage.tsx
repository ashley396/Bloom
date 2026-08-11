import { useState } from "react";
import { callAiSuite } from "../lib/ai-suite-api";

type Tab = "marketing" | "photo" | "pos";

export function AiSuitePage() {
  const [tab, setTab] = useState<Tab>("marketing");
  const [output, setOutput] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function run(action: Parameters<typeof callAiSuite>[0], payload: Record<string, unknown> = {}) {
    setLoading(true);
    setOutput("Working…");
    try {
      const data = await callAiSuite(action, payload);
      setOutput(JSON.stringify(data, null, 2));
    } catch (e) {
      setOutput(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Florisyn AI Suite</p>
      <h1 className="font-serif-display mt-1 text-3xl font-semibold text-charcoal">Marketing · Photo · POS</h1>
      <p className="mt-2 text-charcoal-muted">
        Modular AI microservices on Netlify — segmentation, photo analysis, and realtime POS KPIs.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {(["marketing", "photo", "pos"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`min-h-11 rounded-full px-4 py-2 text-sm font-medium ${
              tab === t ? "bg-primary text-white" : "border border-border bg-white text-charcoal"
            }`}
          >
            {t === "marketing" ? "Marketing AI" : t === "photo" ? "Photo AI" : "POS Intelligence"}
          </button>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-white p-6 shadow-sm">
        {tab === "marketing" && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="min-h-11 rounded-lg bg-primary px-4 text-white" disabled={loading} onClick={() => run("marketing_segment", { customers: [], orders: [] })}>
              Demo segment
            </button>
            <button type="button" className="min-h-11 rounded-lg border px-4" disabled={loading} onClick={() => run("marketing_strategy", { shop: { name: "Demo Florist" }, segments: {} })}>
              Demo strategy
            </button>
          </div>
        )}
        {tab === "photo" && (
          <button type="button" className="min-h-11 rounded-lg bg-primary px-4 text-white" disabled={loading} onClick={() => run("photo_analyze", { meta: { width: 1080, height: 1080, brightness: 110, notes: "wedding roses" } })}>
            Analyze sample photo
          </button>
        )}
        {tab === "pos" && (
          <button type="button" className="min-h-11 rounded-lg bg-primary px-4 text-white" disabled={loading} onClick={() => run("pos_realtime_kpis", { orders: [{ total: 85, created_at: new Date().toISOString() }] })}>
            Demo 24h KPIs
          </button>
        )}
        <pre className="mt-4 max-h-80 overflow-auto rounded-lg bg-accent-soft p-4 text-xs text-charcoal">{output}</pre>
      </div>
    </div>
  );
}
