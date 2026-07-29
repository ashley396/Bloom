import type { LucideIcon } from "lucide-react";
import {
  CreditCard,
  PackagePlus,
  PlusCircle,
  Truck,
} from "lucide-react";
import type { quickActions } from "../../lib/today-data";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { SectionHeader } from "../ui/section-header";
import { SurfaceCard } from "../ui/surface-card";

const iconMap: Record<(typeof quickActions)[number]["id"], LucideIcon> = {
  "new-order": PlusCircle,
  "take-payment": CreditCard,
  "add-delivery": Truck,
  "scan-inventory": PackagePlus,
};

type QuickActionsProps = {
  actions: typeof quickActions;
  className?: string;
};

export function QuickActions({ actions, className }: QuickActionsProps) {
  return (
    <SurfaceCard className={className} as="section" aria-labelledby="quick-actions-heading">
      <SectionHeader title="Quick actions" description="One tap to the workflows you use every morning." />
      <h2 id="quick-actions-heading" className="sr-only">
        Quick actions
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {actions.map((action) => {
          const Icon = iconMap[action.id];
          return (
            <Button
              key={action.id}
              type="button"
              variant="secondary"
              className={cn(
                "h-auto flex-col items-start gap-3 rounded-xl border-florisyn-border/80 px-4 py-4 text-left",
                "hover:shadow-card motion-safe-transition",
              )}
            >
              <Icon className="size-5 text-florisyn-sage-700 dark:text-florisyn-sage-500" aria-hidden />
              <span>
                <span className="block text-sm font-semibold text-florisyn-ink">{action.label}</span>
                <span className="mt-0.5 block text-xs font-normal text-florisyn-muted">
                  {action.hint}
                </span>
              </span>
            </Button>
          );
        })}
      </div>
    </SurfaceCard>
  );
}
