import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { AUTH_STATES } from '../src/app/store/authSlice.js';
import { apiClient } from '../src/services/api/client.js';
import { AppRouter } from '../src/app/router/index.jsx';

function createTestStore(preloadedState = {}) {
  return configureStore({
    reducer: {
      auth: authReducer,
    },
    preloadedState: {
      auth: {
        authState: AUTH_STATES.AUTHENTICATED_SUPERADMIN,
        user: { id: 'sa-1', fullName: 'Superadmin User', mustChangePassword: false },
        platformRole: 'SUPERADMIN',
        activeTenant: null,
        tenantMemberships: [],
        session: {
          id: 'sess-1',
          sessionType: 'PLATFORM',
          isSecondFactorPending: false,
          isRecoveryCodeAckPending: true,
        },
        error: null,
        pendingAuth: null,
        ...preloadedState,
      },
    },
  });
}

function renderWithProviders(initialEntry = '/platform/recovery-codes', preloadedState = {}) {
  const store = createTestStore(preloadedState);
  return {
    store,
    ...render(
      <Provider store={store}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <AppRouter />
        </MemoryRouter>
      </Provider>
    ),
  };
}

describe('Frontend Recovery-Code Acknowledgment & Guarding (BB-WP02)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Renders recovery screen after enrollment with codes, warning, and disabled button', async () => {
    renderWithProviders(
      '/platform/recovery-codes',
      {},
      {
        // recovery codes in location state
      }
    );

    // Heading and alert present
    expect(screen.getByRole('heading', { name: /Emergency Recovery Codes/i })).toBeInTheDocument();
    expect(screen.getByText(/Each recovery code can only be used once/i)).toBeInTheDocument();

    // Checkbox is unchecked
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();

    // Acknowledge button is disabled
    const submitBtn = screen.getByRole('button', { name: /Acknowledge & Continue/i });
    expect(submitBtn).toBeDisabled();
  });

  it('2. Refresh while acknowledgment is pending redirects directly to /platform/recovery-codes without dashboard flash', async () => {
    // Mock /api/auth/me to return superadmin with isRecoveryCodeAckPending: true
    vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          user: { id: 'sa-1', fullName: 'Superadmin', mustChangePassword: false },
          platformRole: 'SUPERADMIN',
          session: {
            id: 'sess-ack-1',
            sessionType: 'PLATFORM',
            isSecondFactorPending: false,
            isRecoveryCodeAckPending: true,
          },
        },
      },
    });

    // Attempt direct navigation to overview
    renderWithProviders('/platform/overview', {
      authState: AUTH_STATES.AUTHENTICATED_SUPERADMIN,
      session: {
        isRecoveryCodeAckPending: true,
      },
    });

    // Should redirect to /platform/recovery-codes and NOT show Overview
    expect(screen.queryByText(/Platform Administration Overview/i)).not.toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: /Emergency Recovery Codes/i })
    ).toBeInTheDocument();
  });

  it('3. Protected-route redirection: all /platform routes redirect to /platform/recovery-codes while ack is pending', async () => {
    renderWithProviders('/platform/tenants', {
      authState: AUTH_STATES.AUTHENTICATED_SUPERADMIN,
      session: {
        isRecoveryCodeAckPending: true,
      },
    });

    expect(screen.queryByText(/Tenant Directory/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Emergency Recovery Codes/i })).toBeInTheDocument();
  });

  it('4. Handles recovery code regeneration when codes were lost on refresh', async () => {
    const mockRegenCodes = [
      'NEW1-1111-2222',
      'NEW2-3333-4444',
      'NEW3-5555-6666',
      'NEW4-7777-8888',
      'NEW5-9999-0000',
      'NEW6-AAAA-BBBB',
      'NEW7-CCCC-DDDD',
      'NEW8-EEEE-FFFF',
    ];

    vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          recoveryCodes: mockRegenCodes,
        },
      },
    });

    renderWithProviders('/platform/recovery-codes', {
      session: { isRecoveryCodeAckPending: true },
    });

    // Initial state after refresh has prompt to generate new codes
    const regenBtn = screen.getByRole('button', { name: /Generate New Recovery Codes/i });
    fireEvent.click(regenBtn);

    // After regeneration, fresh codes are displayed
    expect(await screen.findByText('NEW1-1111-2222')).toBeInTheDocument();
    expect(screen.getByText('NEW8-EEEE-FFFF')).toBeInTheDocument();

    // Checkbox is now ready
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
    expect(checkbox).not.toBeDisabled();
  });

  it('5. Acknowledgment success transitions to Platform Overview', async () => {
    const mockCodes = [
      'CODE-1',
      'CODE-2',
      'CODE-3',
      'CODE-4',
      'CODE-5',
      'CODE-6',
      'CODE-7',
      'CODE-8',
    ];

    vi.spyOn(apiClient, 'post').mockImplementation((url) => {
      if (url === '/auth/superadmin/recovery-codes/regenerate') {
        return Promise.resolve({
          data: { success: true, data: { recoveryCodes: mockCodes } },
        });
      }
      if (url === '/auth/superadmin/recovery-codes/acknowledge') {
        return Promise.resolve({
          data: { success: true, data: { acknowledged: true } },
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    renderWithProviders('/platform/recovery-codes', {
      session: { isRecoveryCodeAckPending: true },
    });

    // Generate codes
    fireEvent.click(screen.getByRole('button', { name: /Generate New Recovery Codes/i }));
    expect(await screen.findByText('CODE-1')).toBeInTheDocument();

    // Check confirmation checkbox
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    // Submit acknowledgment
    const submitBtn = screen.getByRole('button', { name: /Acknowledge & Continue/i });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    // Dashboard content should now be rendered
    expect(await screen.findByText(/Platform Administration Overview/i)).toBeInTheDocument();
  });

  it('6. Acknowledgment failure shows error message and does NOT advance to dashboard', async () => {
    const mockCodes = [
      'CODE-1',
      'CODE-2',
      'CODE-3',
      'CODE-4',
      'CODE-5',
      'CODE-6',
      'CODE-7',
      'CODE-8',
    ];

    vi.spyOn(apiClient, 'post').mockImplementation((url) => {
      if (url === '/auth/superadmin/recovery-codes/regenerate') {
        return Promise.resolve({
          data: { success: true, data: { recoveryCodes: mockCodes } },
        });
      }
      if (url === '/auth/superadmin/recovery-codes/acknowledge') {
        return Promise.reject({
          status: 400,
          code: 'ACK_NOT_PENDING',
          message: 'Recovery-code acknowledgment is not pending',
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    renderWithProviders('/platform/recovery-codes', {
      session: { isRecoveryCodeAckPending: true },
    });

    // Generate codes
    fireEvent.click(screen.getByRole('button', { name: /Generate New Recovery Codes/i }));
    expect(await screen.findByText('CODE-1')).toBeInTheDocument();

    // Check confirmation checkbox
    fireEvent.click(screen.getByRole('checkbox'));

    // Submit acknowledgment
    fireEvent.click(screen.getByRole('button', { name: /Acknowledge & Continue/i }));

    // Verify error is displayed and overview is NOT rendered
    expect(
      await screen.findByText(/Recovery-code acknowledgment is not pending/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Platform Administration Overview/i)).not.toBeInTheDocument();
  });

  it('7. Acknowledgment redirects to /platform/change-password when mustChangePassword is true', async () => {
    const mockCodes = [
      'CODE-1',
      'CODE-2',
      'CODE-3',
      'CODE-4',
      'CODE-5',
      'CODE-6',
      'CODE-7',
      'CODE-8',
    ];

    vi.spyOn(apiClient, 'post').mockImplementation((url) => {
      if (url === '/auth/superadmin/recovery-codes/regenerate') {
        return Promise.resolve({
          data: { success: true, data: { recoveryCodes: mockCodes } },
        });
      }
      if (url === '/auth/superadmin/recovery-codes/acknowledge') {
        return Promise.resolve({
          data: { success: true, data: { acknowledged: true } },
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    renderWithProviders('/platform/recovery-codes', {
      user: { id: 'sa-1', fullName: 'Superadmin', mustChangePassword: true },
      session: { isRecoveryCodeAckPending: true },
    });

    fireEvent.click(screen.getByRole('button', { name: /Generate New Recovery Codes/i }));
    expect(await screen.findByText('CODE-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Acknowledge & Continue/i }));

    // Should redirect to change password page
    expect(
      await screen.findByRole('heading', { name: /Change Initial Password/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(/Platform Administration Overview/i)).not.toBeInTheDocument();
  });

  it('8. Recovery-code login with pending acknowledgment redirects user to /platform/recovery-codes', async () => {
    // Initial state is UNAUTHENTICATED on /platform/login
    renderWithProviders('/platform/login', {
      authState: AUTH_STATES.UNAUTHENTICATED,
      session: null,
      user: null,
      platformRole: null,
    });

    // Mock login response
    vi.spyOn(apiClient, 'post')
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            isSecondFactorPending: true,
            requiresSecondFactor: true,
            requiresTotpEnrollment: false,
          },
        },
      })
      // Recovery verification response
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            remainingRecoveryCodesCount: 3,
            mustChangePassword: false,
            user: { id: 'sa-rec', fullName: 'Recovery Superadmin' },
            isRecoveryCodeAckPending: true,
          },
        },
      });

    // Submit valid credentials
    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: 'recovery_admin@billingbuddy.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password$/i), {
      target: { value: 'ValidPass2026!' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Sign in to Control Panel/i }));

    // Switch to recovery code tab
    const useRecoveryBtn = await screen.findByRole('button', {
      name: /Use Emergency Recovery Code/i,
    });
    fireEvent.click(useRecoveryBtn);

    // Enter recovery code
    const recoveryInput = screen.getByLabelText(/^Emergency Recovery Code$/i);
    fireEvent.change(recoveryInput, { target: { value: 'REC1-AAAA-BBBB' } });
    fireEvent.click(screen.getByRole('button', { name: /Redeem Code & Authenticate/i }));

    // User must be redirected to /platform/recovery-codes and NOT /platform/overview
    expect(
      await screen.findByRole('heading', { name: /Emergency Recovery Codes/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(/Platform Administration Overview/i)).not.toBeInTheDocument();
  });
});
