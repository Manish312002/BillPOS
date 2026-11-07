import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import PlatformLayout from '../../layouts/PlatformLayout.jsx';
import OwnerLayout from '../../layouts/OwnerLayout.jsx';
import PlatformOverviewPage from '../../portals/platform/pages/PlatformOverviewPage.jsx';
import PlatformTenantsPage from '../../portals/platform/pages/PlatformTenantsPage.jsx';
import OwnerOverviewPage from '../../portals/owner/pages/OwnerOverviewPage.jsx';
import OwnerBillingPage from '../../portals/owner/pages/OwnerBillingPage.jsx';
import PortalIndexPage from '../../components/shared/PortalIndexPage.jsx';
import NotFoundPage from '../../components/shared/NotFoundPage.jsx';

export function AppRouter() {
  return (
    <Routes>
      {/* Root Portal Selector */}
      <Route path="/" element={<PortalIndexPage />} />

      {/* Superadmin Portal Namespace */}
      <Route path="/platform" element={<PlatformLayout />}>
        <Route index element={<Navigate to="/platform/overview" replace />} />
        <Route path="overview" element={<PlatformOverviewPage />} />
        <Route path="tenants" element={<PlatformTenantsPage />} />
        <Route
          path="logs"
          element={
            <div className="text-sm text-slate-400">
              Platform Logs placeholder view under <code>/platform/logs</code>.
            </div>
          }
        />
      </Route>

      {/* Store Owner Portal Namespace */}
      <Route path="/owner" element={<OwnerLayout />}>
        <Route index element={<Navigate to="/owner/overview" replace />} />
        <Route path="overview" element={<OwnerOverviewPage />} />
        <Route path="billing" element={<OwnerBillingPage />} />
        <Route
          path="inventory"
          element={
            <div className="text-sm text-slate-500">
              Inventory Catalog placeholder view under <code>/owner/inventory</code>.
            </div>
          }
        />
      </Route>

      {/* Fallback 404 Route */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default AppRouter;
