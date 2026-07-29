import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  CalendarDays,
  CreditCard,
  LayoutGrid,
  Package,
  ShoppingBag,
  Users,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { buttonVariants } from "../ui/button";

const navItems = [
  { to: "/today", label: "Today", icon: CalendarDays, end: true },
  { to: "/orders", label: "Orders", icon: ShoppingBag, end: false },
  { to: "/pos", label: "POS", icon: LayoutGrid, end: false },
  { to: "/inventory", label: "Inventory", icon: Package, end: false },
  { to: "/customers", label: "Customers", icon: Users, end: false },
  { to: "/payments", label: "Payments", icon: CreditCard, end: false },
] as const;

type FloristShellProps = {
  children: ReactNode;
};

export function FloristShell({ children }: FloristShellProps) {
  return (
    <div className="min-h-svh bg-warm-cream">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-warm-white focus:px-4 focus:py-2 focus:shadow-card"
      >
        Skip to main content
      </a>
      <div className="mx-auto flex min-h-svh max-w-[1680px] flex-col lg:flex-row">
        <aside
          className="shrink-0 border-b border-florisyn-border bg-warm-white px-4 py-5 lg:w-56 lg:border-b-0 lg:border-r xl:w-60"
          aria-label="Primary"
        >
          <p className="font-serif-display text-xl font-semibold text-charcoal">Florisyn</p>
          <p className="mt-1 text-xs text-sage-ink">Lilies in Bloom</p>
          <nav className="mt-6" aria-label="Shop">
            <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              {navItems.map(({ to, label, icon: Icon, end }) => (
                <li key={to} className="shrink-0 lg:shrink">
                  <NavLink to={to} end={end} className="block">
                    {({ isActive }) => (
                      <span
                        className={cn(
                          buttonVariants({
                            variant: isActive ? "default" : "ghost",
                            size: "sm",
                          }),
                          "w-full justify-start gap-2.5 rounded-xl px-3 lg:w-full",
                          !isActive && "font-normal",
                        )}
                        aria-current={isActive ? "page" : undefined}
                      >
                        <Icon className="size-4 text-sage-muted" strokeWidth={1.75} aria-hidden />
                        {label}
                      </span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col pb-20 lg:pb-0">
          <main
            id="main-content"
            className="min-w-0 flex-1 px-5 py-8 md:px-10 md:py-10 lg:px-12 lg:py-12"
            tabIndex={-1}
          >
            {children}
          </main>
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-florisyn-border bg-warm-white/95 p-3 backdrop-blur-sm lg:hidden">
        <NavLink to="/pos" className="block">
          <span className={cn(buttonVariants({ size: "lg" }), "w-full")}>New Order</span>
        </NavLink>
      </div>
    </div>
  );
}
