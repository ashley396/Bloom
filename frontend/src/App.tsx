import {
  CalendarDays,
  LayoutGrid,
  Package,
  Settings,
  ShoppingBag,
  Wallet,
} from "lucide-react";
import { TodayPage } from "./pages/TodayPage";
import { ThemeToggle } from "./components/theme/ThemeToggle";
import { AppShell } from "./components/layout/AppShell";
import { Button } from "./components/ui/button";

const navItems = [
  { label: "Today", icon: CalendarDays, current: true },
  { label: "Point of Sale", icon: LayoutGrid, current: false },
  { label: "Orders", icon: ShoppingBag, current: false },
  { label: "Payment Center", icon: Wallet, current: false },
  { label: "Inventory", icon: Package, current: false },
  { label: "Settings", icon: Settings, current: false },
] as const;

export default function App() {
  return (
    <AppShell
      sidebar={
        <nav aria-label="Shop navigation">
          <p className="mb-4 font-display text-lg font-semibold tracking-tight text-florisyn-ink">
            Florisyn
          </p>
          <p className="mb-4 text-xs font-medium uppercase tracking-wide text-florisyn-muted">
            Shop
          </p>
          <ul className="flex flex-row gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
            {navItems.map(({ label, icon: Icon, current }) => (
              <li key={label} className="shrink-0 lg:shrink">
                <Button
                  type="button"
                  variant={current ? "default" : "ghost"}
                  size="sm"
                  className="w-full justify-start gap-2.5 rounded-lg px-3 lg:w-full"
                  aria-current={current ? "page" : undefined}
                >
                  <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
                  {label}
                </Button>
              </li>
            ))}
          </ul>
        </nav>
      }
      header={
        <div className="flex items-center justify-end gap-2 py-1">
          <ThemeToggle />
          <Button type="button" variant="secondary" size="sm">
            Sign out
          </Button>
        </div>
      }
    >
      <TodayPage />
    </AppShell>
  );
}
