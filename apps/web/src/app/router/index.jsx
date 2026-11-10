import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { AUTH_STATES } from '../store/authSlice.js';
import { ProtectedRoute, isValidInternalPath } from './ProtectedRoute.jsx';
import SessionLoadingScreen from '../../components/shared/SessionLoadingScreen.jsx';

import PlatformLayout from '../../layouts/PlatformLayout.jsx';
import OwnerLayout from '../../layouts/OwnerLayout.jsx';

// Superadmin Portal Pages
import SuperadminLoginPage from '../../portals/platform/pages/SuperadminLoginPage.jsx';
import RecoveryCodesPage from '../../portals/platform/pages/RecoveryCodesPage.jsx';
import MandatoryPasswordChangePage from '../../portals/platform/pages/MandatoryPasswordChangePage.jsx';
import PlatformOverviewPage from '../../portals/platform/pages/PlatformOverviewPage.jsx';
import PlatformTenantsPage from '../../portals/platform/pages/PlatformTenantsPage.jsx';
import PlatformSubscriptionsPage from '../../portals/platform/pages/PlatformSubscriptionsPage.jsx';
import PlatformAuditLogsPage from '../../portals/platform/pages/PlatformAuditLogsPage.jsx';
import PlatformSettingsPage from '../../portals/platform/pages/PlatformSettingsPage.jsx';

// Store Owner Portal Pages
import OwnerLoginPage from '../../portals/owner/pages/OwnerLoginPage.jsx';
import OwnerActivationPage from '../../portals/owner/pages/OwnerActivationPage.jsx';
import OwnerOverviewPage from '../../portals/owner/pages/OwnerOverviewPage.jsx';
import OwnerBillingPage from '../../portals/owner/pages/OwnerBillingPage.jsx';
import OwnerPosPage from '../../portals/owner/pages/OwnerPosPage.jsx';
import OwnerCustomersPage from '../../portals/owner/pages/OwnerCustomersPage.jsx';
import OwnerSettingsPage from '../../portals/owner/pages/OwnerSettingsPage.jsx';

// Shared Global Pages
import NotFoundPage from '../../components/shared/NotFoundPage.jsx';

/**
 * Public route wrapper for Superadmin Login.
 * If already authenticated as Superadmin, immediately redirects to /platform/overview or safe internal destination.
 */
export function PublicSuperadminLoginRoute() {
  const { authState, user, session } = useSelector((state) => state.auth);
  const location = useLocation();

  if (authState === AUTH_STATES.INITIALIZING) {
    return <SessionLoadingScreen />;
  }

  if (authState === AUTH_STATES.AUTHENTICATED_SUPERADMIN) {
    if (session?.isRecoveryCodeAckPending) {
      return <Navigate to="/platform/recovery-codes" replace />;
    }
    if (user?.mustChangePassword) {
      return <Navigate to="/platform/change-password" replace />;
    }
    const from = location.state?.from;
    const destination = isValidInternalPath(from) ? from : '/platform/overview';
    return <Navigate to={destination} replace />;
  }

  return <SuperadminLoginPage />;
}

/**
 * Route wrapper for mandatory first-login password change.
 */
export function MandatoryPasswordChangeRoute() {
  const { authState, user } = useSelector((state) => state.auth);

  if (authState === AUTH_STATES.INITIALIZING) {
    return <SessionLoadingScreen />;
  }

  if (authState !== AUTH_STATES.AUTHENTICATED_SUPERADMIN) {
    return <Navigate to="/platform/login" replace />;
  }

  if (!user?.mustChangePassword) {
    return <Navigate to="/platform/overview" replace />;
  }

  return <MandatoryPasswordChangePage />;
}

/**
 * Route wrapper for emergency recovery codes acknowledgment.
 */
export function RecoveryCodesRoute() {
  const { authState, session } = useSelector((state) => state.auth);

  if (authState === AUTH_STATES.INITIALIZING) {
    return <SessionLoadingScreen />;
  }

  if (authState !== AUTH_STATES.AUTHENTICATED_SUPERADMIN) {
    return <Navigate to="/platform/login" replace />;
  }

  if (!session?.isRecoveryCodeAckPending) {
    return <Navigate to="/platform/overview" replace />;
  }

  return <RecoveryCodesPage />;
}

/**
 * Public route wrapper for Store Owner Login.
 * If already authenticated as Store Owner, immediately redirects to /owner/overview.
 */
export function PublicOwnerLoginRoute() {
  const { authState } = useSelector((state) => state.auth);
  const location = useLocation();

  if (authState === AUTH_STATES.INITIALIZING) {
    return <SessionLoadingScreen />;
  }

  if (authState === AUTH_STATES.AUTHENTICATED_OWNER) {
    const from = location.state?.from;
    const destination = isValidInternalPath(from) ? from : '/owner/overview';
    return <Navigate to={destination} replace />;
  }

  return <OwnerLoginPage />;
}

export function AppRouter() {
  return (
    <Routes>
      {/* Public Login & Activation Routes with Authenticated Redirection */}
      <Route path="/" element={<Navigate to="/owner/login" replace />} />
      <Route path="/platform/login" element={<PublicSuperadminLoginRoute />} />
      <Route path="/owner/login" element={<PublicOwnerLoginRoute />} />
      <Route path="/owner/activate" element={<OwnerActivationPage />} />

      {/* Emergency Recovery Codes Acknowledgment View */}
      <Route path="/platform/recovery-codes" element={<RecoveryCodesRoute />} />

      {/* Mandatory Password Change View */}
      <Route path="/platform/change-password" element={<MandatoryPasswordChangeRoute />} />

      {/* Superadmin Portal Protected Namespace */}
      <Route path="/platform" element={<ProtectedRoute allowedPortal="PLATFORM" />}>
        <Route element={<PlatformLayout />}>
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
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>

      {/* Store Owner Portal Protected Namespace */}
      <Route path="/owner" element={<ProtectedRoute allowedPortal="OWNER" />}>
        <Route element={<OwnerLayout />}>
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
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>

      {/* Fallback 404 Route */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default AppRouter;
