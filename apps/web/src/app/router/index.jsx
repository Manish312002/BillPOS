import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import PlatformLayout from '../../layouts/PlatformLayout.jsx';
import OwnerLayout from '../../layouts/OwnerLayout.jsx';

// Superadmin Portal Pages
import PlatformOverviewPage from '../../portals/platform/pages/PlatformOverviewPage.jsx';
import PlatformTenantsPage from '../../portals/platform/pages/PlatformTenantsPage.jsx';
import PlatformSubscriptionsPage from '../../portals/platform/pages/PlatformSubscriptionsPage.jsx';
import PlatformAuditLogsPage from '../../portals/platform/pages/PlatformAuditLogsPage.jsx';
import PlatformSettingsPage from '../../portals/platform/pages/PlatformSettingsPage.jsx';

// Store Owner Portal Pages
import OwnerOverviewPage from '../../portals/owner/pages/OwnerOverviewPage.jsx';
import OwnerBillingPage from '../../portals/owner/pages/OwnerBillingPage.jsx';
import OwnerPosPage from '../../portals/owner/pages/OwnerPosPage.jsx';
import OwnerCustomersPage from '../../portals/owner/pages/OwnerCustomersPage.jsx';
import OwnerSettingsPage from '../../portals/owner/pages/OwnerSettingsPage.jsx';

// Shared Global Pages
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
        <Route path="subscriptions" element={<PlatformSubscriptionsPage />} />
        <Route path="audit-logs" element={<PlatformAuditLogsPage />} />
        <Route path="settings" element={<PlatformSettingsPage />} />
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
        <Route path="pos" element={<OwnerPosPage />} />
        <Route path="customers" element={<OwnerCustomersPage />} />
        <Route path="settings" element={<OwnerSettingsPage />} />
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
