import { SalesTrendChart } from "../charts/SalesTrendChart";
import { sampleSalesTrend } from "../../lib/sample-data";
import { SectionHeader } from "../ui/section-header";
import { SurfaceCard } from "../ui/surface-card";

type BusinessSnapshotProps = {
  className?: string;
};

export function BusinessSnapshot({ className }: BusinessSnapshotProps) {
  return (
    <SurfaceCard className={className} as="section" aria-labelledby="snapshot-heading">
      <SectionHeader
        title="Business snapshot"
        description="Lightweight pulse for the week — detail lives in Reports."
      />
      <h2 id="snapshot-heading" className="sr-only">
        Business snapshot
      </h2>
      <div className="mb-6 grid grid-cols-3 gap-4 border-b border-florisyn-border/60 pb-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-florisyn-muted">
            Week revenue
          </p>
          <p className="font-display mt-1 text-2xl font-semibold tracking-tight">$18.4k</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-florisyn-muted">
            Margin
          </p>
          <p className="font-display mt-1 text-2xl font-semibold tracking-tight">58%</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-florisyn-muted">
            Avg ticket
          </p>
          <p className="font-display mt-1 text-2xl font-semibold tracking-tight">$142</p>
        </div>
      </div>
      <SalesTrendChart data={sampleSalesTrend} />
    </SurfaceCard>
  );
}
