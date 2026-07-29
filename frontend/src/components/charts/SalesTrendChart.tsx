import { lazy, Suspense } from "react";
import type { SalesTrendPoint } from "../../lib/sample-data";

const ChartInner = lazy(() =>
  import("./SalesTrendChartInner").then((m) => ({ default: m.SalesTrendChartInner })),
);

type SalesTrendChartProps = {
  data: SalesTrendPoint[];
  className?: string;
};

export function SalesTrendChart({ data, className }: SalesTrendChartProps) {
  return (
    <div className={className} role="img" aria-label="Weekly sales trend chart">
      <Suspense
        fallback={
          <div
            className="flex h-[220px] items-center justify-center rounded-lg bg-florisyn-sage-50 text-sm text-florisyn-muted dark:bg-florisyn-sage-900/40"
            aria-busy="true"
          >
            Loading chart…
          </div>
        }
      >
        <ChartInner data={data} />
      </Suspense>
    </div>
  );
}
