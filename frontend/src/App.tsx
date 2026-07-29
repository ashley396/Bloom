import { LayoutDashboard, Package, Settings, ShoppingBag, Wallet } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { AppShell } from "./components/layout/AppShell";
import { SalesTrendChart } from "./components/charts/SalesTrendChart";
import { FadeIn } from "./components/motion/FadeIn";
import { PhotoAsset } from "./components/media/PhotoAsset";
import { ThemeToggle } from "./components/theme/ThemeToggle";
import { Button } from "./components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { staggerContainer } from "./lib/motion";
import { sampleSalesTrend } from "./lib/sample-data";

const navItems = [
  { label: "Point of Sale", icon: LayoutDashboard },
  { label: "Orders", icon: ShoppingBag },
  { label: "Payment Center", icon: Wallet },
  { label: "Inventory", icon: Package },
  { label: "Settings", icon: Settings },
] as const;

export default function App() {
  const reduceMotion = useReducedMotion();
  const Grid = reduceMotion ? "div" : motion.div;

  return (
    <AppShell
      sidebar={
        <nav aria-label="Shop navigation">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-florisyn-muted">
            Shop
          </p>
          <ul className="flex flex-row gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
            {navItems.map(({ label, icon: Icon }, i) => (
              <li key={label} className="shrink-0 lg:shrink">
                <Button
                  type="button"
                  variant={i === 0 ? "default" : "ghost"}
                  size="sm"
                  className="w-full justify-start gap-2 lg:w-full"
                  aria-current={i === 0 ? "page" : undefined}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {label}
                </Button>
              </li>
            ))}
          </ul>
        </nav>
      }
      header={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-florisyn-muted">
              Florisyn
            </p>
            <h1 className="text-xl font-semibold text-florisyn-ink md:text-2xl lg:text-3xl">
              The operating system for modern florists
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button type="button" variant="secondary" size="sm">
              Sign out
            </Button>
          </div>
        </div>
      }
    >
      <Grid
        className="grid gap-6 md:grid-cols-2 xl:grid-cols-12"
        {...(!reduceMotion
          ? {
              variants: staggerContainer,
              initial: "hidden",
              animate: "visible",
            }
          : {})}
      >
        <FadeIn className="md:col-span-2 xl:col-span-8">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Licensed photography, your library first</CardTitle>
              <CardDescription>
                Never AI-generated floral imagery. Florists replace defaults with
                their own library; graceful fallbacks keep every surface polished.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <PhotoAsset
                src={null}
                floristLibrarySrc={null}
                alt="Shop workspace — default licensed photography"
                priority
                aspect="portrait"
              />
              <PhotoAsset
                floristLibrarySrc="/assets/auth/luxury-florist-workspace.jpg"
                alt="Entry from the shop floral library"
                aspect="portrait"
              />
              <PhotoAsset
                src="/assets/auth/luxury-florist-workspace.jpg"
                alt="Custom upload overrides library and defaults"
                aspect="portrait"
                className="sm:col-span-2 lg:col-span-1"
              />
            </CardContent>
          </Card>
        </FadeIn>

        <FadeIn className="xl:col-span-4">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Weekly sales</CardTitle>
              <CardDescription>Desktop-first dashboard; Recharts with lazy load.</CardDescription>
            </CardHeader>
            <CardContent>
              <SalesTrendChart data={sampleSalesTrend} />
            </CardContent>
          </Card>
        </FadeIn>
      </Grid>
    </AppShell>
  );
}
