import type { BusinessSnapshotMetrics } from "../../lib/today-sample";
import { SurfaceCard } from "../ui/surface-card";

export type BusinessSnapshotProps = {
  metrics: BusinessSnapshotMetrics;
  className?: string;
};

export function BusinessSnapshot({ metrics, className }: BusinessSnapshotProps) {
  return (
    <SurfaceCard as="section" className={className} aria-labelledby="business-snapshot-title">
      <h2
        id="business-snapshot-title"
        className="font-serif-display text-2xl font-medium text-charcoal md:text-[1.75rem]"
      >
        Business snapshot
      </h2>
      <div className="mt-8 space-y-8">
        <div>
          <div className="flex items-end justify-between gap-2">
            <p className="text-[15px] font-medium text-charcoal-muted">Revenue goal</p>
            <p className="font-serif-display text-xl font-medium tabular-nums text-charcoal">
              {metrics.revenueGoalPercent}%
            </p>
          </div>
          <div
            className="mt-3 h-2.5 overflow-hidden rounded-full bg-sage-pale"
            role="progressbar"
            aria-valuenow={metrics.revenueGoalPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Daily revenue goal progress"
          >
            <div
              className="h-full rounded-full bg-blush-500 motion-safe-transition"
              style={{ width: `${metrics.revenueGoalPercent}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-sage-ink">{metrics.revenueGoalLabel}</p>
        </div>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <div>
            <dt className="text-label">Avg order</dt>
            <dd className="font-serif-display mt-2 text-2xl font-medium text-charcoal">
              {metrics.averageOrderValue}
            </dd>
          </div>
          <div>
            <dt className="text-label">Outstanding</dt>
            <dd className="font-serif-display mt-2 text-2xl font-medium text-charcoal">
              {metrics.outstandingInvoices}
            </dd>
          </div>
          <div>
            <dt className="text-label">Delivery profit</dt>
            <dd className="font-serif-display mt-2 text-2xl font-medium text-charcoal">
              {metrics.deliveryProfitability}
            </dd>
          </div>
        </dl>
      </div>
    </SurfaceCard>
  );
}
