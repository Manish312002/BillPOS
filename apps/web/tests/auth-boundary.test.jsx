import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from '../src/app/store/index.js';
import {
  setAuthState,
  setSessionData,
  restoreSession,
  AUTH_STATES,
} from '../src/app/store/authSlice.js';
import { AppRouter } from '../src/app/router/index.jsx';
import { apiClient } from '../src/services/api/client.js';

function renderApp(initialRoute = '/') {
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <AppRouter />
      </MemoryRouter>
    </Provider>
  );
}

describe('Frontend Authentication Boundary & Protected Routing (BB-WP02)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    store.dispatch(setAuthState(AUTH_STATES.UNAUTHENTICATED));
  });

  // 1. Unauthenticated Platform access
  it('redirects unauthenticated user accessing "/platform/overview" to "/platform/login"', () => {
    store.dispatch(setAuthState(AUTH_STATES.UNAUTHENTICATED));
    renderApp('/platform/overview');

    // Should redirect to Superadmin login page
    expect(screen.getByRole('heading', { level: 1, name: /Welcome Back/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign in to Control Panel/i })).toBeInTheDocument();
    expect(screen.queryByText(/Platform Administration Overview/i)).not.toBeInTheDocument();
  });

  // 2. Authenticated Superadmin access
  it('allows authenticated Superadmin to access "/platform/overview"', () => {
    store.dispatch(
      setSessionData({
        platformRole: 'SUPERADMIN',
        user: { fullName: 'Root Superadmin', email: 'superadmin@billingbuddy.com' },
      })
    );

    renderApp('/platform/overview');

    expect(screen.getByText(/Platform Administration Overview/i)).toBeInTheDocument();
    expect(screen.getByText(/Platform Active/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Welcome Back/i })).not.toBeInTheDocument();
  });

  // 3. Store Owner cannot access Platform routes
  it('denies access to Platform routes when authenticated as Store Owner (403)', () => {
    store.dispatch(
      setSessionData({
        session: { sessionType: 'TENANT' },
        activeTenant: { id: 'tenant-101', name: 'Downtown Store' },
        tenantMemberships: [{ role: 'STORE_OWNER', status: 'ACTIVE', tenantId: 'tenant-101' }],
        user: { fullName: 'Owner Alice', phone: '+919876543210' },
      })
    );

    renderApp('/platform/overview');

    expect(screen.getByText(/403 — Platform Access Denied/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Store Owners and non-administrative accounts are not authorized/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Platform Administration Overview/i)).not.toBeInTheDocument();
  });

  // 4. Unauthenticated Owner access
  it('redirects unauthenticated user accessing "/owner/overview" to "/owner/login"', () => {
    store.dispatch(setAuthState(AUTH_STATES.UNAUTHENTICATED));
    renderApp('/owner/overview');

    // Should redirect to deliberate Owner login entry point
    expect(
      screen.getByRole('heading', { level: 1, name: /Store Owner Authentication/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Store Owners access BillingBuddy via a secure, single-use activation link/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Store Operations Overview/i)).not.toBeInTheDocument();
  });

  // 5. Superadmin cannot access Owner routes
  it('denies access to Owner routes when authenticated as Superadmin (403 portal isolation)', () => {
    store.dispatch(
      setSessionData({
        platformRole: 'SUPERADMIN',
        user: { fullName: 'Root Superadmin', email: 'superadmin@billingbuddy.com' },
      })
    );

    renderApp('/owner/overview');

    expect(screen.getByText(/403 — Owner Operations Isolation/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Superadmins cannot access Store Owner operations directly/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Store Operations Overview/i)).not.toBeInTheDocument();
  });

  // 6. Suspended Store Owner membership is rejected
  it('denies access to Store Owner portal when membership is suspended (403)', () => {
    store.dispatch(
      setSessionData({
        session: { sessionType: 'TENANT' },
        activeTenant: { id: 'tenant-101' },
        tenantMemberships: [
          {
            role: 'STORE_OWNER',
            status: 'INACTIVE',
            tenantId: 'tenant-101',
          },
        ],
        user: { fullName: 'Suspended Owner' },
      })
    );

    renderApp('/owner/overview');

    expect(screen.getByText(/403 — Membership Inactive/i)).toBeInTheDocument();
    expect(screen.queryByText(/Store Operations Overview/i)).not.toBeInTheDocument();
  });

  // 7. Suspended Tenant organization is rejected
  it('denies access to Store Owner portal when tenant organization is suspended (403)', () => {
    store.dispatch(
      setSessionData({
        session: { sessionType: 'TENANT' },
        activeTenant: { id: 'tenant-101', status: 'SUSPENDED' },
        tenantMemberships: [
          {
            role: 'STORE_OWNER',
            status: 'ACTIVE',
            tenantId: 'tenant-101',
            tenant: { status: 'SUSPENDED' },
          },
        ],
        user: { fullName: 'Owner' },
      })
    );

    renderApp('/owner/overview');

    expect(screen.getByText(/403 — Store Suspended/i)).toBeInTheDocument();
    expect(screen.queryByText(/Store Operations Overview/i)).not.toBeInTheDocument();
  });

  // 8. Protected content is not rendered during session initialization
  it('renders neutral loading screen and prevents dashboard flashing during INITIALIZING state', () => {
    store.dispatch(setAuthState(AUTH_STATES.INITIALIZING));

    renderApp('/platform/overview');

    expect(screen.getByText(/Verifying security session\.\.\./i)).toBeInTheDocument();
    expect(
      screen.getByText(/BillingBuddy Centralized Authentication Subsystem/i)
    ).toBeInTheDocument();
    // Confirms NO protected layout or dashboard content is leaked into DOM
    expect(screen.queryByText(/Platform Administration Overview/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Platform Governance/i)).not.toBeInTheDocument();
  });

  // 9. Backend/network failure displays clear error screen with retry
  it('renders error screen with retry action when session validation encounters network failure', () => {
    store.dispatch(setAuthState(AUTH_STATES.AUTHENTICATION_ERROR));

    renderApp('/platform/overview');

    expect(
      screen.getByRole('heading', { level: 1, name: /Authentication Service Unavailable/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry Connection/i })).toBeInTheDocument();
    expect(screen.queryByText(/Platform Administration Overview/i)).not.toBeInTheDocument();
  });

  // 10. Session restoration succeeds via restoreSession thunk
  it('successfully restores Superadmin session from server response', async () => {
    const mockUserData = {
      user: { id: 'sa-123', fullName: 'Restored Superadmin', email: 'restored@billingbuddy.com' },
      platformRole: 'SUPERADMIN',
      session: { id: 'sess-123', sessionType: 'PLATFORM' },
      tenantMemberships: [],
    };

    vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
      data: { success: true, data: mockUserData },
    });

    await store.dispatch(restoreSession());

    const state = store.getState().auth;
    expect(state.authState).toBe(AUTH_STATES.AUTHENTICATED_SUPERADMIN);
    expect(state.user.fullName).toBe('Restored Superadmin');
    expect(state.platformRole).toBe('SUPERADMIN');
  });

  // 11. Expired session (401) transitions to UNAUTHENTICATED
  it('transitions to UNAUTHENTICATED on 401 session expiration', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValueOnce({
      status: 401,
      code: 'SESSION_EXPIRED',
      message: 'Session has expired',
    });

    await store.dispatch(restoreSession());

    const state = store.getState().auth;
    expect(state.authState).toBe(AUTH_STATES.UNAUTHENTICATED);
    expect(state.user).toBeNull();
    expect(state.error).toBeNull();
  });

  // 12. Logout revokes session, clears state, and redirects
  it('clears frontend authentication state and navigates to login upon logout', async () => {
    store.dispatch(
      setSessionData({
        platformRole: 'SUPERADMIN',
        user: { fullName: 'Logging Out Superadmin', email: 'logout@billingbuddy.com' },
      })
    );

    const logoutSpy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
      data: { success: true, message: 'Logged out successfully' },
    });

    renderApp('/platform/overview');

    const signOutButton = screen.getByRole('button', { name: /Sign Out/i });
    expect(signOutButton).toBeInTheDocument();

    fireEvent.click(signOutButton);

    await waitFor(() => {
      expect(logoutSpy).toHaveBeenCalledWith('/auth/logout');
      const state = store.getState().auth;
      expect(state.authState).toBe(AUTH_STATES.UNAUTHENTICATED);
      expect(state.user).toBeNull();
    });

    // Should redirect to login page
    expect(await screen.findByRole('heading', { name: /Welcome Back/i })).toBeInTheDocument();
  });

  // 13. Unknown routes cannot bypass authorization
  it('prevents unknown sub-routes under "/platform/*" from bypassing authorization', () => {
    store.dispatch(setAuthState(AUTH_STATES.UNAUTHENTICATED));

    renderApp('/platform/unknown-confidential-subpage');

    // Unauthenticated user is still redirected to login
    expect(screen.getByRole('heading', { level: 1, name: /Welcome Back/i })).toBeInTheDocument();
  });

  // 14. Authenticated Superadmin visiting "/platform/login" is redirected to "/platform/overview"
  it('redirects already authenticated Superadmin away from "/platform/login" to "/platform/overview"', () => {
    store.dispatch(
      setSessionData({
        platformRole: 'SUPERADMIN',
        user: { fullName: 'Already Logged In', email: 'admin@billingbuddy.com' },
      })
    );

    renderApp('/platform/login');

    expect(screen.getByText(/Platform Administration Overview/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Welcome Back/i })).not.toBeInTheDocument();
  });
});
