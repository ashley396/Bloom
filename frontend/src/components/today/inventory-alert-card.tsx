import { cn } from "../../lib/utils";
import {
  inventoryLevelTone,
  type InventoryAlertRow,
} from "../../lib/today-sample";
import { SurfaceCard } from "../ui/surface-card";

const toneStyles = {
  critical: "bg-blush-50 text-charcoal ring-blush-100",
  good: "bg-sage-pale text-charcoal ring-sage-soft/80",
  warn: "bg-warm-cream-deep text-charcoal ring-florisyn-border",
};

export type InventoryAlertCardProps = {
  alert: InventoryAlertRow;
};

export function InventoryAlertCard({ alert }: InventoryAlertCardProps) {
  const tone = inventoryLevelTone[alert.level];
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl px-4 py-3 ring-1",
        toneStyles[tone],
      )}
    >
      <div>
        <p className="font-medium text-charcoal">{alert.item}</p>
        <p className="text-sm text-charcoal-muted">{alert.quantity}</p>
      </div>
      <span className="text-xs font-semibold uppercase tracking-wide text-charcoal-subtle">
        {alert.level}
      </span>
    </div>
  );
}

export type InventoryAlertsSectionProps = {
  alerts: InventoryAlertRow[];
  className?: string;
};

export function InventoryAlertsSection({ alerts, className }: InventoryAlertsSectionProps) {
  return (
    <SurfaceCard as="section" className={className} aria-labelledby="inventory-alerts-title">
      <h2
        id="inventory-alerts-title"
        className="font-serif-display text-xl font-semibold text-charcoal md:text-2xl"
      >
        Inventory alerts
      </h2>
      <ul className="mt-6 space-y-2">
        {alerts.map((alert) => (
          <li key={alert.id}>
            <InventoryAlertCard alert={alert} />
          </li>
        ))}
      </ul>
    </SurfaceCard>
  );
}
