import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from '../src/app/store/index.js';
import { AppRouter } from '../src/app/router/index.jsx';
import { apiClient } from '../src/services/api/client.js';

function renderWithProviders(initialRoute = '/') {
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

  it('renders root portal selector on "/"', () => {
    renderWithProviders('/');
    expect(screen.getByText(/Retail Operations Portal Entry/i)).toBeInTheDocument();
    expect(screen.getByText(/Superadmin Portal/i)).toBeInTheDocument();
    expect(screen.getByText(/Store Owner Portal/i)).toBeInTheDocument();
  });

  it('renders Superadmin layout and overview page on "/platform/overview"', () => {
    renderWithProviders('/platform/overview');
    expect(screen.getByText(/Platform Superadmin/i)).toBeInTheDocument();
    expect(screen.getByText(/Platform Administration Overview/i)).toBeInTheDocument();
    expect(screen.getByText(/Platform Namespace \(\/platform\/\*\)/i)).toBeInTheDocument();
  });

  it('renders Store Owner layout and overview page on "/owner/overview"', () => {
    renderWithProviders('/owner/overview');
    expect(screen.getByText(/Store Operations Portal/i)).toBeInTheDocument();
    expect(screen.getByText(/Store Operations Overview/i)).toBeInTheDocument();
    expect(screen.getByText(/Tenant Namespace \(\/owner\/\*\)/i)).toBeInTheDocument();
  });

  it('renders 404 fallback page on unknown routes', () => {
    renderWithProviders('/random-unmatched-path');
    expect(screen.getByText(/404/i)).toBeInTheDocument();
    expect(screen.getByText(/Page Not Found/i)).toBeInTheDocument();
    expect(
      screen.getByText(/The requested route does not exist within the Superadmin or Store Owner namespaces/i)
    ).toBeInTheDocument();
  });

  it('configures Axios client with correct base URL, prefix, and timeout', () => {
    expect(apiClient.defaults.timeout).toBe(10000);
    expect(apiClient.defaults.baseURL).toContain('/api');
    expect(apiClient.defaults.headers['Content-Type']).toBe('application/json');
  });
});
