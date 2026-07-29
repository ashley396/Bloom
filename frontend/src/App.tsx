import { AppShell } from "./components/layout/AppShell";
import { PhotoAsset } from "./components/media/PhotoAsset";
import { Button } from "./components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";

const navItems = [
  "Point of Sale",
  "Orders",
  "Payment Center",
  "Inventory",
  "Settings",
] as const;

export default function App() {
  return (
    <AppShell
      sidebar={
        <nav aria-label="Shop navigation">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-florisyn-muted">
            Shop
          </p>
          <ul className="flex flex-row gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
            {navItems.map((label, i) => (
              <li key={label} className="shrink-0 lg:shrink">
                <Button
                  type="button"
                  variant={i === 0 ? "default" : "ghost"}
                  size="sm"
                  className="w-full justify-start lg:w-full"
                  aria-current={i === 0 ? "page" : undefined}
                >
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
            <h1 className="text-xl font-semibold text-florisyn-ink md:text-2xl">
              React UI foundation
            </h1>
          </div>
          <Button type="button" variant="secondary" size="sm">
            Sign out
          </Button>
        </div>
      }
    >
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Card className="md:col-span-2 xl:col-span-2">
          <CardHeader>
            <CardTitle>Photography-first product surfaces</CardTitle>
            <CardDescription>
              User uploads and shop photos only — no placeholder floral art or
              AI-generated flower imagery.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <PhotoAsset
              src={null}
              alt="Fresh arrangement at the shop workspace"
              priority
              aspect="portrait"
            />
            <PhotoAsset
              src="/assets/auth/luxury-florist-workspace.jpg"
              alt="Luxury florist workspace"
              aspect="portrait"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Responsive shell</CardTitle>
            <CardDescription>
              Desktop sidebar, horizontal nav on tablet/mobile, WCAG AA focus
              and skip link.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-florisyn-muted">
            <p>Design tokens: Florisyn sage, cream, ink.</p>
            <p>Components: shadcn-style Button and Card.</p>
            <Button type="button" className="w-full">
              Primary action
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
