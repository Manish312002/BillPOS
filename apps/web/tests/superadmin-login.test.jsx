import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from '../src/app/store/index.js';
import { setAuthState, AUTH_STATES } from '../src/app/store/authSlice.js';
import { AppRouter } from '../src/app/router/index.jsx';
import { SuperadminLoginPage } from '../src/portals/platform/pages/SuperadminLoginPage.jsx';

function renderComponent(props = {}) {
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <SuperadminLoginPage {...props} />
      </MemoryRouter>
    </Provider>
  );
}

function renderAppAt(route = '/platform/login') {
  store.dispatch(setAuthState(AUTH_STATES.UNAUTHENTICATED));
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[route]}>
        <AppRouter />
      </MemoryRouter>
    </Provider>
  );
}

describe('Superadmin Login Page UI Component', () => {
  it('renders branding emblem, brand name, and Superadmin badge', () => {
    renderComponent();
    expect(screen.getByText('BB')).toBeInTheDocument();
    expect(screen.getByText(/Platform Superadmin/i)).toBeInTheDocument();
  });

  it('renders the required heading and supporting description text', () => {
    renderComponent();
    expect(screen.getByRole('heading', { level: 1, name: /Welcome Back/i })).toBeInTheDocument();
    expect(screen.getByText(/Sign in to your BillingBuddy control panel\./i)).toBeInTheDocument();
  });

  it('renders email and password inputs with accessible labels and attributes', () => {
    renderComponent();

    const emailInput = screen.getByLabelText(/Email Address/i);
    expect(emailInput).toBeInTheDocument();
    expect(emailInput).toHaveAttribute('type', 'email');
    expect(emailInput).toHaveAttribute('autoComplete', 'email');
    expect(emailInput).toHaveAttribute('placeholder', 'superadmin@billingbuddy.com');

    const passwordInput = screen.getByLabelText(/^Password$/i);
    expect(passwordInput).toBeInTheDocument();
    expect(passwordInput).toHaveAttribute('type', 'password');
    expect(passwordInput).toHaveAttribute('autoComplete', 'current-password');
  });

  it('toggles password visibility when the show/hide button is clicked', () => {
    renderComponent();

    const passwordInput = screen.getByLabelText(/^Password$/i);
    const toggleButton = screen.getByRole('button', { name: /Show password/i });

    expect(passwordInput).toHaveAttribute('type', 'password');
    expect(toggleButton).toHaveAttribute('aria-label', 'Show password');

    // Click to show password
    fireEvent.click(toggleButton);
    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /Hide password/i })).toBeInTheDocument();

    // Click again to hide password
    fireEvent.click(screen.getByRole('button', { name: /Hide password/i }));
    expect(passwordInput).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: /Show password/i })).toBeInTheDocument();
  });

  it('displays inline validation errors when submitting an empty form', async () => {
    renderComponent();

    const submitButton = screen.getByRole('button', { name: /Sign in to Control Panel/i });
    fireEvent.click(submitButton);

    expect(await screen.findByText(/Email address is required\./i)).toBeInTheDocument();
    expect(screen.getByText(/Password is required\./i)).toBeInTheDocument();
  });

  it('displays inline validation error for malformed email addresses', async () => {
    renderComponent();

    const emailInput = screen.getByLabelText(/Email Address/i);
    const passwordInput = screen.getByLabelText(/^Password$/i);
    const submitButton = screen.getByRole('button', { name: /Sign in to Control Panel/i });

    fireEvent.change(emailInput, { target: { value: 'invalid-email-format' } });
    fireEvent.change(passwordInput, { target: { value: 'SecretPassword123!' } });
    fireEvent.click(submitButton);

    expect(await screen.findByText(/Please enter a valid email address\./i)).toBeInTheDocument();
    expect(screen.queryByText(/Password is required\./i)).not.toBeInTheDocument();
  });

  it('clears field errors when user edits the input', async () => {
    renderComponent();

    const emailInput = screen.getByLabelText(/Email Address/i);
    const submitButton = screen.getByRole('button', { name: /Sign in to Control Panel/i });

    fireEvent.click(submitButton);
    expect(await screen.findByText(/Email address is required\./i)).toBeInTheDocument();

    fireEvent.change(emailInput, { target: { value: 'valid@example.com' } });
    expect(screen.queryByText(/Email address is required\./i)).not.toBeInTheDocument();
  });

  it('displays external error banner when error prop is supplied', () => {
    const errorText = 'Invalid Superadmin credentials provided.';
    renderComponent({ error: errorText });

    const alertBanner = screen.getByRole('alert');
    expect(alertBanner).toBeInTheDocument();
    expect(alertBanner).toHaveTextContent(errorText);
  });

  it('displays loading state with spinner and disables controls when isLoading is true', () => {
    renderComponent({ isLoading: true });

    const submitButton = screen.getByRole('button', { name: /Signing in\.\.\./i });
    expect(submitButton).toBeInTheDocument();
    expect(submitButton).toBeDisabled();

    expect(screen.getByLabelText(/Email Address/i)).toBeDisabled();
    expect(screen.getByLabelText(/^Password$/i)).toBeDisabled();
  });

  it('invokes onSubmit prop with credentials when form is valid', async () => {
    const handleSubmit = vi.fn().mockResolvedValue({});
    renderComponent({ onSubmit: handleSubmit });

    const emailInput = screen.getByLabelText(/Email Address/i);
    const passwordInput = screen.getByLabelText(/^Password$/i);
    const submitButton = screen.getByRole('button', { name: /Sign in to Control Panel/i });

    fireEvent.change(emailInput, { target: { value: 'superadmin@billingbuddy.com' } });
    fireEvent.change(passwordInput, { target: { value: 'SuperAdminPass2026!' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledTimes(1);
      expect(handleSubmit).toHaveBeenCalledWith({
        email: 'superadmin@billingbuddy.com',
        password: 'SuperAdminPass2026!',
      });
    });
  });

  it('renders correctly under AppRouter at "/platform/login"', () => {
    renderAppAt('/platform/login');

    expect(screen.getByRole('heading', { level: 1, name: /Welcome Back/i })).toBeInTheDocument();
    expect(screen.getByText(/Return to Portal Index/i)).toBeInTheDocument();
  });

  it('displays authenticator app TOTP security notice in card footer', () => {
    renderComponent();
    expect(
      screen.getByText(/Protected by authenticator app \(TOTP\) two-factor authentication/i)
    ).toBeInTheDocument();
  });
});
