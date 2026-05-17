import { Route, Routes, Navigate } from "react-router-dom";
import { DashboardLayout } from "../components/layout/DashboardLayout";
import Overview from "../pages/Overview";
import NotFound from "../pages/NotFound";
import PlaceholderPage from "../pages/PlaceholderPage";

export function DashboardRoutes() {
  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route path="/" element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<Overview />} />
        <Route path="settings" element={<PlaceholderPage title="Settings" description="Manage your account settings" />} />
        <Route path="billing" element={<PlaceholderPage title="Billing" description="View and manage your subscription" />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default DashboardRoutes;