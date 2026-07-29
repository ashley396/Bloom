import {
  FileText,
  PackagePlus,
  ShoppingBag,
  Store,
  UserPlus,
} from "lucide-react";
import type { QuickActionId } from "../../lib/today-sample";
import { Button } from "../ui/button";
import { SurfaceCard } from "../ui/surface-card";

const icons: Record<QuickActionId, typeof ShoppingBag> = {
  "new-order": ShoppingBag,
  "open-pos": Store,
  "add-customer": UserPlus,
  "receive-inventory": PackagePlus,
  "create-invoice": FileText,
};

type Action = { id: QuickActionId; label: string };

export type QuickActionsProps = {
  actions: Action[];
  className?: string;
};

export function QuickActions({ actions, className }: QuickActionsProps) {
  return (
    <SurfaceCard as="section" className={className} aria-labelledby="quick-actions-title">
      <h2
        id="quick-actions-title"
        className="font-serif-display text-xl font-semibold text-charcoal md:text-2xl"
      >
        Quick actions
      </h2>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        {actions.map((action) => {
          const Icon = icons[action.id];
          return (
            <Button
              key={action.id}
              type="button"
              variant="secondary"
              className="h-auto min-h-[44px] flex-col gap-2 py-4 text-center"
            >
              <Icon className="size-5 text-blush-600" aria-hidden />
              <span className="text-xs font-semibold leading-tight sm:text-sm">{action.label}</span>
            </Button>
          );
        })}
      </div>
    </SurfaceCard>
  );
}
