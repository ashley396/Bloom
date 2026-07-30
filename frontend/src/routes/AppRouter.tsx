import { Navigate, Route, Routes } from "react-router-dom";
import { FloristShell } from "../components/layout/FloristShell";
import {
  CustomersPage,
  DeliveriesPage,
  InventoryPage,
  PaymentsPage,
  PosPage,
} from "../pages/LuxuryModulePages";
import { OrdersPage } from "../pages/OrdersPage";
import { TodayPage } from "../pages/TodayPage";

export function AppRouter() {
  return (
    <FloristShell>
      <Routes>
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/pos" element={<PosPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/deliveries" element={<DeliveriesPage />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Routes>
    </FloristShell>
  );
}
