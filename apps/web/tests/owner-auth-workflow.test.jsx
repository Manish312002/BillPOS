import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { AUTH_STATES, changePassword } from '../src/app/store/authSlice.js';
import systemReducer from '../src/app/store/systemSlice.js';
import { apiClient } from '../src/services/api/client.js';
import OwnerActivationPage from '../src/portals/owner/pages/OwnerActivationPage.jsx';
import OwnerLoginPage from '../src/portals/owner/pages/OwnerLoginPage.jsx';

function renderWithStore(ui, { store, initialEntries = ['/'] } = {}) {
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
    </Provider>
  );
}

describe('Store Owner Authentication & Activation Frontend Workflow (ADR-002)', () => {
  let store;

  beforeEach(() => {
    vi.restoreAllMocks();

    store = configureStore({
      reducer: {
        auth: authReducer,
        system: systemReducer,
      },
      preloadedState: {
        auth: {
          authState: AUTH_STATES.UNAUTHENTICATED,
          user: null,
          platformRole: null,
          activeTenant: null,
          tenantMemberships: [],
          session: null,
          pendingAuth: null,
          error: null,
        },
      },
    });
  });

  describe('1. Superadmin Password Change State Transition (Issue 1)', () => {
    it('sets mustChangePassword to false in Redux store upon successful password change', () => {
      // Set initial user with mustChangePassword: true
      store = configureStore({
        reducer: { auth: authReducer, system: systemReducer },
        preloadedState: {
          auth: {
            authState: AUTH_STATES.AUTHENTICATED_SUPERADMIN,
            user: {
              id: 'sa-user-1',
              fullName: 'Super Admin',
              mustChangePassword: true,
            },
            platformRole: 'SUPERADMIN',
            error: null,
          },
        },
      });

      expect(store.getState().auth.user.mustChangePassword).toBe(true);

      // Simulate fulfilled password change
      store.dispatch(
        changePassword.fulfilled(
          {
            user: { id: 'sa-user-1', fullName: 'Super Admin', mustChangePassword: false },
            mustChangePassword: false,
          },
          'requestId',
          { currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' }
        )
      );

      expect(store.getState().auth.user.mustChangePassword).toBe(false);
      expect(store.getState().auth.error).toBeNull();
    });
  });

  describe('2. Store Owner Activation Workflow (Issue 2)', () => {
    it('extracts token from hash, cleanses address bar, validates token, and activates store', async () => {
      const mockToken = 'mock_valid_bearer_token_1234567890';
      const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

      // Set window.location.hash
      window.location.hash = `#token=${mockToken}`;

      // Mock validation API
      vi.spyOn(apiClient, 'post').mockImplementation((url, _body) => {
        if (url === '/auth/owner/invitation/validate') {
          return Promise.resolve({
            data: {
              success: true,
              data: {
                valid: true,
                tenant: {
                  id: 'tenant-123',
                  slug: 'organic-mart',
                  legalName: 'Organic Mart Retail Ltd',
                  tradeName: 'Organic Mart',
                },
                invitedPhone: '+919876543210',
                invitedEmail: 'owner@organicmart.com',
              },
            },
          });
        }
        if (url === '/auth/owner/activate') {
          return Promise.resolve({
            data: {
              success: true,
              data: {
                user: {
                  id: 'owner-user-1',
                  fullName: 'Organic Mart',
                  phone: '+919876543210',
                  email: 'owner@organicmart.com',
                  mustChangePassword: false,
                },
                activeTenant: {
                  id: 'tenant-123',
                  slug: 'organic-mart',
                  tradeName: 'Organic Mart',
                  status: 'ACTIVE',
                },
                membership: {
                  id: 'mem-123',
                  role: 'STORE_OWNER',
                  status: 'ACTIVE',
                },
              },
            },
          });
        }
        return Promise.reject(new Error('Not found'));
      });

      renderWithStore(<OwnerActivationPage />, { store });

      // Verify URL fragment was cleansed
      expect(replaceStateSpy).toHaveBeenCalledWith(null, '', window.location.pathname);

      // Wait for validation to resolve
      expect(await screen.findByText(/Organic Mart/i)).toBeInTheDocument();
      expect(screen.getByText(/\+919876543210/i)).toBeInTheDocument();
      expect(screen.getByText(/owner@organicmart.com/i)).toBeInTheDocument();

      // Submit button should initially be disabled until valid password
      const submitBtn = screen.getByRole('button', { name: /Activate Store/i });
      expect(submitBtn).toBeDisabled();

      // Fill valid password
      const pwdInput = screen.getByLabelText(/^Create Password/i);
      const confirmInput = screen.getByLabelText(/^Confirm Password/i);

      fireEvent.change(pwdInput, { target: { value: 'NewOwnerPass2026!' } });
      fireEvent.change(confirmInput, { target: { value: 'NewOwnerPass2026!' } });

      // Button should now be enabled
      expect(submitBtn).not.toBeDisabled();

      // Submit activation
      fireEvent.click(submitBtn);

      await waitFor(() => {
        const state = store.getState().auth;
        expect(state.authState).toBe(AUTH_STATES.AUTHENTICATED_OWNER);
        expect(state.user.phone).toBe('+919876543210');
        expect(state.activeTenant.slug).toBe('organic-mart');
      });
    });

    it('displays error notice when invitation token is invalid or expired', async () => {
      window.location.hash = '#token=expired_token_12345';

      vi.spyOn(apiClient, 'post').mockRejectedValueOnce({
        status: 410,
        code: 'INVITATION_EXPIRED',
        message: 'This invitation has expired. Please request a new invitation link.',
      });

      renderWithStore(<OwnerActivationPage />, { store });

      expect(await screen.findByText(/Invitation Unavailable/i)).toBeInTheDocument();
      expect(
        screen.getByText(/This invitation has expired. Please request a new invitation link./i)
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Go to Store Owner Login/i })).toBeInTheDocument();
    });

    it('extracts token from query string fallback and preserves it across address bar sanitization', async () => {
      // Set query param ?token=
      delete window.location;
      window.location = new URL(
        'http://localhost:5173/owner/activate?token=query_bearer_token_9999'
      );

      const validateSpy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            valid: true,
            tenant: {
              id: 'tenant-999',
              slug: 'super-store',
              tradeName: 'Super Store',
            },
            invitedPhone: '+919999988888',
            invitedEmail: 'super@store.com',
          },
        },
      });

      renderWithStore(<OwnerActivationPage />, { store });

      expect(await screen.findByText(/Super Store/i)).toBeInTheDocument();
      expect(validateSpy).toHaveBeenCalledWith('/auth/owner/invitation/validate', {
        token: 'query_bearer_token_9999',
      });
    });
  });

  describe('3. Store Owner Login Workflow (Issue 3)', () => {
    it('submits owner credentials and transitions Redux authState to AUTHENTICATED_OWNER', async () => {
      const loginSpy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            user: {
              id: 'owner-user-1',
              phone: '+919876543210',
              email: 'owner@store.com',
            },
            activeTenant: {
              id: 'tenant-123',
              slug: 'metro-mart',
            },
            tenantMemberships: [
              {
                id: 'mem-1',
                role: 'STORE_OWNER',
                status: 'ACTIVE',
              },
            ],
          },
        },
      });

      renderWithStore(<OwnerLoginPage />, { store });

      const identifierInput = screen.getByLabelText(/Phone or Email/i);
      const passwordInput = screen.getByLabelText(/Password/i);
      const slugInput = screen.getByLabelText(/Store Slug/i);
      const submitBtn = screen.getByRole('button', { name: /Sign In to Store/i });

      fireEvent.change(identifierInput, { target: { value: '+919876543210' } });
      fireEvent.change(passwordInput, { target: { value: 'SecretPass123!' } });
      fireEvent.change(slugInput, { target: { value: 'metro-mart' } });

      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(loginSpy).toHaveBeenCalledWith('/auth/owner/login', {
          identifier: '+919876543210',
          password: 'SecretPass123!',
          tenantSlug: 'metro-mart',
        });

        const state = store.getState().auth;
        expect(state.authState).toBe(AUTH_STATES.AUTHENTICATED_OWNER);
        expect(state.activeTenant.slug).toBe('metro-mart');
      });
    });

    it('displays error notice when login fails', async () => {
      vi.spyOn(apiClient, 'post').mockRejectedValueOnce({
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Invalid credentials or you do not have store owner access.',
      });

      renderWithStore(<OwnerLoginPage />, { store });

      const identifierInput = screen.getByLabelText(/Phone or Email/i);
      const passwordInput = screen.getByLabelText(/Password/i);
      const submitBtn = screen.getByRole('button', { name: /Sign In to Store/i });

      fireEvent.change(identifierInput, { target: { value: 'wrong@store.com' } });
      fireEvent.change(passwordInput, { target: { value: 'WrongPass!' } });

      fireEvent.click(submitBtn);

      expect(
        await screen.findByText(/Invalid credentials or you do not have store owner access./i)
      ).toBeInTheDocument();
    });
  });
});
