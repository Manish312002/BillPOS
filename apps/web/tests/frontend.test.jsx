import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from '../src/app/store/index.js';
import { setAuthState, setSessionData, AUTH_STATES } from '../src/app/store/authSlice.js';
import { AppRouter } from '../src/app/router/index.jsx';
import { apiClient } from '../src/services/api/client.js';

function renderWithProviders(initialRoute = '/', customAuthState = null) {
  if (customAuthState) {
    store.dispatch(setAuthState(customAuthState));
  } else if (initialRoute.startsWith('/platform')) {
    store.dispatch(
      setSessionData({
        platformRole: 'SUPERADMIN',
        user: { id: 'admin-1', fullName: 'Superadmin User', email: 'admin@billingbuddy.com' },
      })
    );
  } else if (initialRoute.startsWith('/owner')) {
    store.dispatch(
      setSessionData({
        session: { sessionType: 'TENANT' },
        activeTenant: { id: 'tenant-1', name: 'Store #101' },
        tenantMemberships: [{ role: 'STORE_OWNER', status: 'ACTIVE', tenantId: 'tenant-1' }],
        user: { id: 'owner-1', fullName: 'Store Owner', phone: '+919876543210' },
      })
    );
  } else {
    store.dispatch(setAuthState(AUTH_STATES.UNAUTHENTICATED));
  }

  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <AppRouter />
      </MemoryRouter>
    </Provider>
  );
}

describe('Frontend Foundation Architecture Tests', () => {
  it('initializes the Redux store with default system slice', () => {
    const state = store.getState();
    expect(state).toHaveProperty('system');
    expect(state.system.isReady).toBe(true);
    expect(state.system.appName).toBe('BillingBuddy');
    expect(state.system.version).toBe('0.1.0');
  });

  it('redirects from "/" to "/owner/login" and renders only Store Owner login', () => {
    renderWithProviders('/');
    expect(
      screen.getByRole('heading', { level: 1, name: /Store Owner Authentication/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(/Superadmin Portal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Retail Operations Portal Entry/i)).not.toBeInTheDocument();
  });

  it('renders Superadmin layout and overview page on "/platform/overview"', () => {
    renderWithProviders('/platform/overview');
    expect(screen.getAllByText(/Platform Superadmin/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Platform Administration Overview/i)).toBeInTheDocument();
    expect(screen.getByText(/Platform Active/i)).toBeInTheDocument();
  });

  it('renders Store Owner layout and overview page on "/owner/overview"', () => {
    renderWithProviders('/owner/overview');
    expect(screen.getAllByText(/Store Operations/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Store Operations Overview/i)).toBeInTheDocument();
    expect(screen.getByText(/Register: Ready/i)).toBeInTheDocument();
  });

  it('renders 404 fallback page on unknown routes', () => {
    renderWithProviders('/random-unmatched-path');
    expect(screen.getByText(/404/i)).toBeInTheDocument();
    expect(screen.getByText(/Page Not Found/i)).toBeInTheDocument();
    expect(
      screen.getByText(/The requested route does not exist within the Store Owner namespaces/i)
    ).toBeInTheDocument();
  });

  it('configures Axios client with correct base URL, prefix, and timeout', () => {
    expect(apiClient.defaults.timeout).toBe(10000);
    expect(apiClient.defaults.baseURL).toContain('/api');
    expect(apiClient.defaults.headers['Content-Type']).toBe('application/json');
  });
});

describe('Portal Routing & Layout Hardening Tests (BB-WP01-01.05)', () => {
  it('renders Superadmin Subscriptions page at "/platform/subscriptions"', () => {
    renderWithProviders('/platform/subscriptions');
    expect(screen.getByText(/Subscription Tier Management/i)).toBeInTheDocument();
    expect(screen.getByText(/Namespace: \/platform\/subscriptions/i)).toBeInTheDocument();
  });

  it('renders Superadmin Audit Logs page at "/platform/audit-logs"', () => {
    renderWithProviders('/platform/audit-logs');
    expect(screen.getByText(/Platform Audit Logs/i)).toBeInTheDocument();
    expect(screen.getByText(/Namespace: \/platform\/audit-logs/i)).toBeInTheDocument();
  });

  it('renders Superadmin Settings page at "/platform/settings"', () => {
    renderWithProviders('/platform/settings');
    expect(screen.getByText(/Platform Configuration/i)).toBeInTheDocument();
    expect(screen.getByText(/Namespace: \/platform\/settings/i)).toBeInTheDocument();
  });

  it('renders Store Owner POS Counter page at "/owner/pos"', () => {
    renderWithProviders('/owner/pos');
    expect(screen.getByText(/POS Counter Register/i)).toBeInTheDocument();
    expect(screen.getByText(/Namespace: \/owner\/pos/i)).toBeInTheDocument();
  });

  it('renders Store Owner Customer Ledger page at "/owner/customers"', () => {
    renderWithProviders('/owner/customers');
    expect(screen.getByText(/Customer Ledger & Accounts/i)).toBeInTheDocument();
    expect(screen.getByText(/Namespace: \/owner\/customers/i)).toBeInTheDocument();
  });

  it('renders Store Owner Settings page at "/owner/settings"', () => {
    renderWithProviders('/owner/settings');
    expect(screen.getByText(/Store Profile & Hardware Settings/i)).toBeInTheDocument();
    expect(screen.getByText(/Namespace: \/owner\/settings/i)).toBeInTheDocument();
  });

  it('provides responsive navigation controls with accessible button', () => {
    renderWithProviders('/platform/overview');
    const toggleButton = screen.getByRole('button', { name: /Toggle Navigation/i });
    expect(toggleButton).toBeInTheDocument();
    fireEvent.click(toggleButton);
  });
});
