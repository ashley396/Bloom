import { CreditCard, LayoutGrid, Package, Truck, Users } from "lucide-react";
import { LuxuryMetric, LuxuryPageShell } from "../components/layout/LuxuryPageShell";
import { Button } from "../components/ui/button";
import { SurfaceCard } from "../components/ui/surface-card";

export function PosPage() {
  return (
    <LuxuryPageShell
      eyebrow="Point of Sale"
      title="Register"
      description="Elegant, minimal, fast — premium payment flow with large touch targets."
      actions={<Button size="lg">New sale</Button>}
    >
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <LuxuryMetric label="Today's sales" value="$1,284" />
        <LuxuryMetric label="Transactions" value="14" />
        <LuxuryMetric label="Average ticket" value="$92" />
        <LuxuryMetric label="Staff on register" value="2" />
      </div>
      <SurfaceCard padding="lg">
        <p className="text-label">Product pad</p>
        <p className="mt-4 text-charcoal-muted">
          Production POS lives in the main Florisyn app. This preview shows the luxury register layout rhythm.
        </p>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {["Sympathy", "Birthday", "Wedding", "Plants", "Roses", "Custom"].map((label) => (
            <button
              key={label}
              type="button"
              className="surface-lift flex min-h-[88px] flex-col items-center justify-center rounded-2xl bg-linen/60 p-4 ring-1 ring-florisyn-border"
            >
              <LayoutGrid className="mb-2 size-5 text-sage-muted" strokeWidth={1.5} />
              <span className="text-sm font-medium text-charcoal">{label}</span>
            </button>
          ))}
        </div>
      </SurfaceCard>
    </LuxuryPageShell>
  );
}

export function InventoryPage() {
  return (
    <LuxuryPageShell
      eyebrow="Inventory"
      title="Cooler & stock"
      description="Photo-first inventory with freshness indicators — never spreadsheet-dense."
      actions={<Button variant="secondary">Scan barcode</Button>}
    >
      <div className="grid gap-5 sm:grid-cols-3">
        <LuxuryMetric label="Low stock items" value="3" />
        <LuxuryMetric label="Cooler temp" value="38°F" />
        <LuxuryMetric label="Retail value" value="$4,820" />
      </div>
      <SurfaceCard>
        <div className="flex items-center gap-3">
          <Package className="size-5 text-sage-muted" strokeWidth={1.5} />
          <p className="font-medium text-charcoal">Inventory management runs in production Florisyn.</p>
        </div>
      </SurfaceCard>
    </LuxuryPageShell>
  );
}

export function CustomersPage() {
  return (
    <LuxuryPageShell
      eyebrow="CRM"
      title="Customer dossiers"
      description="Concierge profiles with favorites, gift history, and elegant notes."
      actions={<Button>Add customer</Button>}
    >
      <div className="grid gap-5 sm:grid-cols-3">
        <LuxuryMetric label="Active customers" value="248" />
        <LuxuryMetric label="Birthdays this week" value="6" />
        <LuxuryMetric label="VIP accounts" value="12" />
      </div>
      <SurfaceCard>
        <div className="flex items-center gap-3">
          <Users className="size-5 text-sage-muted" strokeWidth={1.5} />
          <p className="font-medium text-charcoal">CRM profiles with timeline and preferences in production.</p>
        </div>
      </SurfaceCard>
    </LuxuryPageShell>
  );
}

export function PaymentsPage() {
  return (
    <LuxuryPageShell
      eyebrow="Payment Center"
      title="Take payment"
      description="Premium payment flow — cash, card, split tender, beautiful receipt preview."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {["Cash", "Card", "Split", "Invoice"].map((mode) => (
          <button
            key={mode}
            type="button"
            className="surface-lift flex min-h-[100px] flex-col items-center justify-center rounded-2xl bg-warm-white p-6 ring-1 ring-florisyn-border"
          >
            <CreditCard className="mb-3 size-6 text-champagne-gold" strokeWidth={1.5} />
            <span className="font-medium text-charcoal">{mode}</span>
          </button>
        ))}
      </div>
    </LuxuryPageShell>
  );
}

export function DeliveriesPage() {
  return (
    <LuxuryPageShell
      eyebrow="Deliveries"
      title="Today's route"
      description="Luxury route board with manifest printing and proof-of-delivery capture."
      actions={<Button variant="secondary">Print manifest</Button>}
    >
      <div className="grid gap-5 sm:grid-cols-4">
        <LuxuryMetric label="Scheduled" value="5" />
        <LuxuryMetric label="En route" value="1" />
        <LuxuryMetric label="Delivered" value="8" />
        <LuxuryMetric label="Route miles" value="24.6" />
      </div>
      <SurfaceCard>
        <div className="flex items-center gap-3">
          <Truck className="size-5 text-sage-muted" strokeWidth={1.5} />
          <p className="font-medium text-charcoal">Delivery kanban and route optimization in production.</p>
        </div>
      </SurfaceCard>
    </LuxuryPageShell>
  );
}
