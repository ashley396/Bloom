import { cn } from "../../lib/utils";
import {
  inventoryLevelTone,
  type InventoryAlertRow,
} from "../../lib/today-sample";
import { PhotoAsset } from "../../lib/floral-asset-library";
import { SurfaceCard } from "../ui/surface-card";

const toneStyles = {
  critical: "bg-blush-50 text-charcoal ring-blush-100/90",
  good: "bg-sage-pale/80 text-charcoal ring-sage-soft/70",
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
        "flex items-center gap-4 rounded-2xl px-5 py-4 ring-1",
        toneStyles[tone],
      )}
    >
      <PhotoAsset
        photoId={alert.photoId}
        pageSlot={alert.photoSlot}
        alt={`${alert.item} stock`}
        aspect="square"
        className="size-14 shrink-0 rounded-xl"
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-charcoal">{alert.item}</p>
        <p className="mt-0.5 text-sm text-charcoal-muted">{alert.quantity}</p>
      </div>
      <span className="text-label text-sage-ink">{alert.level}</span>
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
        className="font-serif-display text-2xl font-medium text-charcoal md:text-[1.75rem]"
      >
        Inventory alerts
      </h2>
      <ul className="mt-8 space-y-3">
        {alerts.map((alert) => (
          <li key={alert.id}>
            <InventoryAlertCard alert={alert} />
          </li>
        ))}
      </ul>
    </SurfaceCard>
  );
}
