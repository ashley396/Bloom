import type { ActivityItem } from "../../lib/today-data";
import { SectionHeader } from "../ui/section-header";
import { SurfaceCard } from "../ui/surface-card";

type RecentActivityProps = {
  items: ActivityItem[];
  className?: string;
};

export function RecentActivity({ items, className }: RecentActivityProps) {
  return (
    <SurfaceCard className={className} as="section" aria-labelledby="activity-heading">
      <SectionHeader title="Recent activity" description="Latest moments across payments, delivery, and staff." />
      <h2 id="activity-heading" className="sr-only">
        Recent activity
      </h2>
      <ul className="divide-y divide-florisyn-border/60">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-1 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-florisyn-ink">{item.title}</p>
              <p className="text-sm text-florisyn-muted">{item.meta}</p>
            </div>
            <time className="text-xs tabular-nums text-florisyn-muted sm:text-sm">{item.time}</time>
          </li>
        ))}
      </ul>
    </SurfaceCard>
  );
}
