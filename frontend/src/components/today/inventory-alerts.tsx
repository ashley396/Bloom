import { AlertTriangle, Leaf } from "lucide-react";
import type { InventoryAlert } from "../../lib/today-data";
import { cn } from "../../lib/utils";
import { SectionHeader } from "../ui/section-header";
import { SurfaceCard } from "../ui/surface-card";

type InventoryAlertsProps = {
  alerts: InventoryAlert[];
  className?: string;
};

export function InventoryAlerts({ alerts, className }: InventoryAlertsProps) {
  return (
    <SurfaceCard className={className} as="section" aria-labelledby="inventory-alerts-heading">
      <SectionHeader
        title="Inventory alerts"
        description="Cooler and hard goods that need attention before noon."
      />
      <h2 id="inventory-alerts-heading" className="sr-only">
        Inventory alerts
      </h2>
      <ul className="space-y-2">
        {alerts.map((alert) => (
          <li key={alert.id}>
            <div
              className={cn(
                "flex gap-3 rounded-xl border border-florisyn-border/50 px-4 py-3",
                alert.severity === "critical"
                  ? "bg-red-50/80 dark:bg-red-950/20"
                  : "bg-florisyn-cream/60 dark:bg-florisyn-sage-50/20",
              )}
            >
              {alert.severity === "critical" ? (
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-red-700 dark:text-red-300"
                  aria-hidden
                />
              ) : (
                <Leaf
                  className="mt-0.5 size-4 shrink-0 text-florisyn-sage-700 dark:text-florisyn-sage-500"
                  aria-hidden
                />
              )}
              <div>
                <p className="text-sm font-medium text-florisyn-ink">{alert.item}</p>
                <p className="text-sm text-florisyn-muted">{alert.detail}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </SurfaceCard>
  );
}
