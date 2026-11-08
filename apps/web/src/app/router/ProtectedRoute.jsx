import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { AUTH_STATES } from '../store/authSlice.js';
import SessionLoadingScreen from '../../components/shared/SessionLoadingScreen.jsx';
import SessionErrorScreen from '../../components/shared/SessionErrorScreen.jsx';
import AccessDeniedPage from '../../components/shared/AccessDeniedPage.jsx';

/**
 * Validates that an internal path is safe for redirection.
 * Rejects external URLs, protocol-relative URLs, schemes, and login loop targets.
 */
export function isValidInternalPath(path) {
  if (typeof path !== 'string' || !path) return false;
  // Must start with single slash, not double slash or backslash
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) {
    return false;
  }
  // Must not contain URI scheme
  if (path.includes('://')) {
    return false;
  }
  // Prevent redirect loops back to login routes
  if (path.startsWith('/platform/login') || path.startsWith('/owner/login')) {
    return false;
  }
  return true;
}

/**
 * Reusable route guard enforcing server-side authenticated sessions and portal isolation.
 *
 * @param {Object} props
 * @param {'PLATFORM'|'OWNER'} props.allowedPortal - The required portal authorization tier
 */
export function ProtectedRoute({ allowedPortal }) {
  const location = useLocation();
  const { authState, user, platformRole, activeTenant, tenantMemberships, session } = useSelector(
    (state) => state.auth
  );

  // 1. Never render protected content while session initialization is in-flight
  if (authState === AUTH_STATES.INITIALIZING) {
    return <SessionLoadingScreen />;
  }

  // 2. Network or backend outage state
  if (authState === AUTH_STATES.AUTHENTICATION_ERROR) {
    return <SessionErrorScreen />;
  }

  // 3. Platform Superadmin Route Guard
  if (allowedPortal === 'PLATFORM') {
    if (authState === AUTH_STATES.UNAUTHENTICATED) {
      return <Navigate to="/platform/login" state={{ from: location.pathname }} replace />;
    }

    // Portal isolation: Store Owners cannot access Platform governance
    if (authState === AUTH_STATES.AUTHENTICATED_OWNER || platformRole !== 'SUPERADMIN') {
      return (
        <AccessDeniedPage
          title="403 — Platform Access Denied"
          message="Store Owners and non-administrative accounts are not authorized to access Platform Superadmin governance."
          returnPath="/owner/overview"
          returnLabel="Go to Store Owner Portal"
        />
      );
    }

    // Enforce server-authoritative recovery code acknowledgment before granting dashboard access
    if (session?.isRecoveryCodeAckPending) {
      return <Navigate to="/platform/recovery-codes" replace />;
    }

    // SEC-AUTH-08: Enforce mandatory password change before granting dashboard access
    if (user?.mustChangePassword) {
      return <Navigate to="/platform/change-password" replace />;
    }

    return <Outlet />;
  }

  // 4. Store Owner Route Guard
  if (allowedPortal === 'OWNER') {
    if (authState === AUTH_STATES.UNAUTHENTICATED) {
      return <Navigate to="/owner/login" state={{ from: location.pathname }} replace />;
    }

    // Portal isolation: Superadmins cannot access Store Owner operations directly
    if (authState === AUTH_STATES.AUTHENTICATED_SUPERADMIN) {
      return (
        <AccessDeniedPage
          title="403 — Owner Operations Isolation"
          message="Superadmins cannot access Store Owner operations directly. Cross-portal access is prohibited to maintain tenant boundary isolation."
          returnPath="/platform/overview"
          returnLabel="Go to Platform Superadmin Portal"
        />
      );
    }

    // Resolve tenant membership
    const memberships = tenantMemberships || [];
    const activeMembership = activeTenant?.id
      ? memberships.find((m) => m.tenantId === activeTenant.id)
      : memberships.find((m) => m.role === 'STORE_OWNER');

    if (!activeMembership || activeMembership.role !== 'STORE_OWNER') {
      return (
        <AccessDeniedPage
          title="403 — Membership Required"
          message="An active Store Owner membership is required to access store operations."
          returnPath="/"
          returnLabel="Return to Portal Index"
        />
      );
    }

    // Suspended or inactive membership
    if (activeMembership.status !== 'ACTIVE') {
      return (
        <AccessDeniedPage
          title="403 — Membership Inactive"
          message="Your store membership is currently inactive or suspended. Please contact platform administration."
          returnPath="/"
          returnLabel="Return to Portal Index"
        />
      );
    }

    // Suspended tenant organization
    if (activeMembership.tenant?.status === 'SUSPENDED') {
      return (
        <AccessDeniedPage
          title="403 — Store Suspended"
          message="This store organization is currently suspended. Access to billing and POS features is disabled."
          returnPath="/"
          returnLabel="Return to Portal Index"
        />
      );
    }

    return <Outlet />;
  }

  return <Navigate to="/" replace />;
}

export default ProtectedRoute;
