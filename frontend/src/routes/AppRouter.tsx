import { Navigate, Route, Routes } from "react-router-dom";
import { FloristShell } from "../components/layout/FloristShell";
import { OrdersPage } from "../pages/OrdersPage";
import { TodayPage } from "../pages/TodayPage";

export function AppRouter() {
  return (
    <FloristShell>
      <Routes>
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Routes>
    </FloristShell>
  );
}
