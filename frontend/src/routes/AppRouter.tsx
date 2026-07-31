import { Navigate, Route, Routes } from "react-router-dom";
import { FloristShell } from "../components/layout/FloristShell";
import { DesignSystemPage } from "../pages/DesignSystemPage";
import { OrdersPage } from "../pages/OrdersPage";
import { TodayPage } from "../pages/TodayPage";

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="font-serif-display text-2xl font-semibold text-charcoal">{title}</h1>
      <p className="mt-2 text-charcoal-muted">Route reserved for a future release.</p>
    </div>
  );
}

export function AppRouter() {
  return (
    <FloristShell>
      <Routes>
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/design-system" element={<DesignSystemPage />} />
        <Route path="/pos" element={<PlaceholderPage title="Point of Sale" />} />
        <Route path="/inventory" element={<PlaceholderPage title="Inventory" />} />
        <Route path="/customers" element={<PlaceholderPage title="Customers" />} />
        <Route path="/payments" element={<PlaceholderPage title="Payments" />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Routes>
    </FloristShell>
  );
}
