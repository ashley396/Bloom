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
        className="font-serif-display text-xl font-semibold text-charcoal md:text-2xl"
      >
        Business snapshot
      </h2>
      <div className="mt-6 space-y-6">
        <div>
          <div className="flex items-end justify-between gap-2">
            <p className="text-sm font-medium text-charcoal-muted">Revenue goal</p>
            <p className="text-sm font-semibold tabular-nums text-charcoal">
              {metrics.revenueGoalPercent}%
            </p>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-sage-pale"
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
          <p className="mt-2 text-xs text-charcoal-subtle">{metrics.revenueGoalLabel}</p>
        </div>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-charcoal-subtle">
              Avg order
            </dt>
            <dd className="font-serif-display mt-1 text-xl font-semibold text-charcoal">
              {metrics.averageOrderValue}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-charcoal-subtle">
              Outstanding
            </dt>
            <dd className="font-serif-display mt-1 text-xl font-semibold text-charcoal">
              {metrics.outstandingInvoices}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-charcoal-subtle">
              Delivery profit
            </dt>
            <dd className="font-serif-display mt-1 text-xl font-semibold text-charcoal">
              {metrics.deliveryProfitability}
            </dd>
          </div>
        </dl>
      </div>
    </SurfaceCard>
  );
}
