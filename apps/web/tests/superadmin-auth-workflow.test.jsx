import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from '../src/app/store/index.js';
import { setAuthState, setSessionData, AUTH_STATES } from '../src/app/store/authSlice.js';
import { AppRouter } from '../src/app/router/index.jsx';
import { apiClient } from '../src/services/api/client.js';

function renderApp(initialRoute = '/platform/login') {
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <AppRouter />
      </MemoryRouter>
    </Provider>
  );
}

describe('Superadmin Authentication & TOTP Workflow (BB-WP02)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    store.dispatch(setAuthState(AUTH_STATES.UNAUTHENTICATED));
  });

  // ============================================
  // 1. CREDENTIAL LOGIN TESTS
  // ============================================
  describe('Credential Submission & Validation', () => {
    it('submits valid credentials and transitions to TOTP verification when second factor is required', async () => {
      vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: {
          success: true,
          message: 'Second-factor verification required',
          data: {
            isSecondFactorPending: true,
            requiresTotpEnrollment: false,
            requiresSecondFactor: true,
            mustChangePassword: false,
            user: { id: 'sa-1', fullName: 'Superadmin User', email: 'admin@billingbuddy.com' },
          },
        },
      });

      renderApp('/platform/login');

      fireEvent.change(screen.getByLabelText(/Email Address/i), {
        target: { value: 'admin@billingbuddy.com' },
      });
      fireEvent.change(screen.getByLabelText(/^Password$/i), {
        target: { value: 'ValidSuperPassword123!' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Sign in to Control Panel/i }));

      // Should transition to Two-Factor Verification step
      expect(
        await screen.findByRole('heading', { level: 1, name: /Two-Factor Verification/i })
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/6-Digit Authenticator Code/i)).toBeInTheDocument();
    });

    it('displays error banner when backend rejects invalid credentials', async () => {
      vi.spyOn(apiClient, 'post').mockRejectedValueOnce({
        status: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials provided.',
      });

      renderApp('/platform/login');

      fireEvent.change(screen.getByLabelText(/Email Address/i), {
        target: { value: 'wrong@billingbuddy.com' },
      });
      fireEvent.change(screen.getByLabelText(/^Password$/i), {
        target: { value: 'WrongPassword123!' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Sign in to Control Panel/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/Invalid credentials provided\./i);
      expect(screen.getByRole('button', { name: /Sign in to Control Panel/i })).toBeInTheDocument();
    });

    it('handles backend outage or network error gracefully during credential submission', async () => {
      vi.spyOn(apiClient, 'post').mockRejectedValueOnce({
        status: null,
        code: 'NETWORK_ERROR',
        message: 'Network connection failed.',
      });

      renderApp('/platform/login');

      fireEvent.change(screen.getByLabelText(/Email Address/i), {
        target: { value: 'admin@billingbuddy.com' },
      });
      fireEvent.change(screen.getByLabelText(/^Password$/i), {
        target: { value: 'Password123!' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Sign in to Control Panel/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/Network connection failed/i);
    });
  });

  // ============================================
  // 2. TOTP ENROLLMENT WORKFLOW
  // ============================================
  describe('TOTP Enrollment & Confirmation Flow', () => {
    it('transitions to enrollment step, displays Base32 key, confirms code, and displays recovery codes', async () => {
      // 1. Initial login returns requiresTotpEnrollment: true
      vi.spyOn(apiClient, 'post')
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              isSecondFactorPending: true,
              requiresTotpEnrollment: true,
              requiresSecondFactor: false,
              mustChangePassword: false,
              user: { id: 'sa-new', fullName: 'New Superadmin', email: 'new@billingbuddy.com' },
            },
          },
        })
        // 2. enrollTotp response
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              secret: 'JBSWY3DPEHPK3PXP',
              provisioningUri:
                'otpauth://totp/BillingBuddy:new@billingbuddy.com?secret=JBSWY3DPEHPK3PXP',
            },
          },
        })
        // 3. confirmTotpEnrollment response
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              recoveryCodes: [
                'REC1-AAAA-BBBB',
                'REC2-CCCC-DDDD',
                'REC3-EEEE-FFFF',
                'REC4-GGGG-HHHH',
                'REC5-IIII-JJJJ',
                'REC6-KKKK-LLLL',
                'REC7-MMMM-NNNN',
                'REC8-OOOO-PPPP',
              ],
              mustChangePassword: false,
              user: { id: 'sa-new', fullName: 'New Superadmin' },
              isRecoveryCodeAckPending: true,
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              acknowledged: true,
            },
          },
        });

      renderApp('/platform/login');

      // Fill credentials
      fireEvent.change(screen.getByLabelText(/Email Address/i), {
        target: { value: 'new@billingbuddy.com' },
      });
      fireEvent.change(screen.getByLabelText(/^Password$/i), {
        target: { value: 'InitialPass2026!' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Sign in to Control Panel/i }));

      // Verify Enrollment step reached with Base32 key
      expect(
        await screen.findByRole('heading', { name: /Set Up Authenticator/i })
      ).toBeInTheDocument();
      expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();

      // Enter 6-digit confirmation code
      const codeInput = screen.getByLabelText(/6-Digit Confirmation Code/i);
      fireEvent.change(codeInput, { target: { value: '654321' } });
      fireEvent.click(screen.getByRole('button', { name: /Confirm & Activate 2FA/i }));

      // Verify Recovery Codes Reveal step reached
      expect(
        await screen.findByRole('heading', { name: /Emergency Recovery Codes/i })
      ).toBeInTheDocument();
      expect(screen.getByText('REC1-AAAA-BBBB')).toBeInTheDocument();
      expect(screen.getByText('REC8-OOOO-PPPP')).toBeInTheDocument();

      // Confirm checkbox and click acknowledgement button to enter platform
      const confirmCheckbox = screen.getByRole('checkbox');
      fireEvent.click(confirmCheckbox);

      const ackButton = screen.getByRole('button', {
        name: /I Have Securely Saved My Recovery Codes/i,
      });
      expect(ackButton).not.toBeDisabled();
      fireEvent.click(ackButton);

      // Verify redirected to dashboard
      expect(await screen.findByText(/Platform Administration Overview/i)).toBeInTheDocument();
    });
  });

  // ============================================
  // 3. TOTP VERIFICATION & RECOVERY WORKFLOW
  // ============================================
  describe('TOTP Verification & Recovery Code Flow', () => {
    it('successfully verifies 6-digit TOTP code and navigates to Platform Overview', async () => {
      vi.spyOn(apiClient, 'post')
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              isSecondFactorPending: true,
              requiresSecondFactor: true,
              mustChangePassword: false,
              user: { id: 'sa-1', fullName: 'Active Admin', email: 'admin@billingbuddy.com' },
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              mustChangePassword: false,
              user: { id: 'sa-1', fullName: 'Active Admin' },
            },
          },
        });

      renderApp('/platform/login');

      fireEvent.change(screen.getByLabelText(/Email Address/i), {
        target: { value: 'admin@billingbuddy.com' },
      });
      fireEvent.change(screen.getByLabelText(/^Password$/i), {
        target: { value: 'Password123!' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Sign in to Control Panel/i }));

      expect(
        await screen.findByRole('heading', { name: /Two-Factor Verification/i })
      ).toBeInTheDocument();

      const totpInput = screen.getByLabelText(/6-Digit Authenticator Code/i);
      fireEvent.change(totpInput, { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: /Verify Code & Continue/i }));

      expect(await screen.findByText(/Platform Administration Overview/i)).toBeInTheDocument();
    });

    it('displays error when invalid 6-digit TOTP code is entered', async () => {
      vi.spyOn(apiClient, 'post')
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              isSecondFactorPending: true,
              requiresSecondFactor: true,
              mustChangePassword: false,
              user: { id: 'sa-1' },
            },
          },
        })
        .mockRejectedValueOnce({
          status: 401,
          code: 'INVALID_TOTP_CODE',
          message: 'Invalid 6-digit authenticator code.',
        });

      renderApp('/platform/login');

      fireEvent.change(screen.getByLabelText(/Email Address/i), {
        target: { value: 'admin@billingbuddy.com' },
      });
      fireEvent.change(screen.getByLabelText(/^Password$/i), {
        target: { value: 'Password123!' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Sign in to Control Panel/i }));

      const totpInput = await screen.findByLabelText(/6-Digit Authenticator Code/i);
      fireEvent.change(totpInput, { target: { value: '999999' } });
      fireEvent.click(screen.getByRole('button', { name: /Verify Code & Continue/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        /Invalid 6-digit authenticator code/i
      );
    });

    it('allows fallback to emergency recovery code verification', async () => {
      vi.spyOn(apiClient, 'post')
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              isSecondFactorPending: true,
              requiresSecondFactor: true,
              mustChangePassword: false,
              user: { id: 'sa-1' },
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              remainingRecoveryCodesCount: 7,
              mustChangePassword: false,
              user: { id: 'sa-1' },
            },
          },
        });

      renderApp('/platform/login');

      fireEvent.change(screen.getByLabelText(/Email Address/i), {
        target: { value: 'admin@billingbuddy.com' },
      });
      fireEvent.change(screen.getByLabelText(/^Password$/i), {
        target: { value: 'Password123!' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Sign in to Control Panel/i }));

      // Click to toggle to recovery code input
      const toggleRecoveryButton = await screen.findByRole('button', {
        name: /Lost access\? Use emergency recovery code/i,
      });
      fireEvent.click(toggleRecoveryButton);

      expect(screen.getByRole('heading', { name: /Emergency Recovery/i })).toBeInTheDocument();

      const recoveryInput = screen.getByLabelText(/Emergency Recovery Code/i);
      fireEvent.change(recoveryInput, { target: { value: 'A1B2-C3D4-E5F6' } });
      fireEvent.click(screen.getByRole('button', { name: /Redeem Code & Authenticate/i }));

      expect(await screen.findByText(/Platform Administration Overview/i)).toBeInTheDocument();
    });
  });

  // ============================================
  // 4. MANDATORY PASSWORD CHANGE WORKFLOW
  // ============================================
  describe('Mandatory Password Change Enforcement', () => {
    it('redirects to password change screen when mustChangePassword is true after 2FA', async () => {
      vi.spyOn(apiClient, 'post')
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              isSecondFactorPending: true,
              requiresSecondFactor: true,
              mustChangePassword: true, // Requires change
              user: { id: 'sa-initial', email: 'firstlogin@billingbuddy.com' },
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              mustChangePassword: true,
              user: { id: 'sa-initial', email: 'firstlogin@billingbuddy.com' },
            },
          },
        });

      renderApp('/platform/login');

      fireEvent.change(screen.getByLabelText(/Email Address/i), {
        target: { value: 'firstlogin@billingbuddy.com' },
      });
      fireEvent.change(screen.getByLabelText(/^Password$/i), {
        target: { value: 'InitialPassword2026!' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Sign in to Control Panel/i }));

      const totpInput = await screen.findByLabelText(/6-Digit Authenticator Code/i);
      fireEvent.change(totpInput, { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: /Verify Code & Continue/i }));

      // Must be redirected to Mandatory Password Change Page
      expect(
        await screen.findByRole('heading', { level: 1, name: /Change Initial Password/i })
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/Current Provisioned Password/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/New Personalized Password/i)).toBeInTheDocument();
    });

    it('prevents direct navigation to "/platform/overview" while mustChangePassword is true', () => {
      // Set store with mustChangePassword = true
      store.dispatch(
        setSessionData({
          platformRole: 'SUPERADMIN',
          user: {
            id: 'sa-initial',
            fullName: 'Unchanged Admin',
            mustChangePassword: true,
          },
        })
      );

      renderApp('/platform/overview');

      // Guard should redirect to /platform/change-password
      expect(
        screen.getByRole('heading', { level: 1, name: /Change Initial Password/i })
      ).toBeInTheDocument();
      expect(screen.queryByText(/Platform Administration Overview/i)).not.toBeInTheDocument();
    });

    it('enforces password policy, updates password via API, and proceeds to Overview', async () => {
      store.dispatch(
        setSessionData({
          platformRole: 'SUPERADMIN',
          user: {
            id: 'sa-initial',
            fullName: 'Unchanged Admin',
            mustChangePassword: true,
          },
        })
      );

      const changePasswordSpy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: {
          success: true,
          message: 'Password updated successfully',
        },
      });

      renderApp('/platform/change-password');

      expect(screen.getByRole('heading', { name: /Change Initial Password/i })).toBeInTheDocument();

      const submitButton = screen.getByRole('button', {
        name: /Update Password & Enter Control Panel/i,
      });
      expect(submitButton).toBeDisabled(); // Disabled because policy not satisfied yet

      // Fill valid password meeting complexity policy
      fireEvent.change(screen.getByLabelText(/Current Provisioned Password/i), {
        target: { value: 'OldInitialPassword2026!' },
      });
      fireEvent.change(screen.getByLabelText(/New Personalized Password/i), {
        target: { value: 'BrandNewSecure@2026!' },
      });
      fireEvent.change(screen.getByLabelText(/Confirm New Password/i), {
        target: { value: 'BrandNewSecure@2026!' },
      });

      // Submit button should now be enabled
      expect(submitButton).not.toBeDisabled();
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(changePasswordSpy).toHaveBeenCalledWith('/auth/change-password', {
          currentPassword: 'OldInitialPassword2026!',
          newPassword: 'BrandNewSecure@2026!',
        });
      });

      // Should land on overview after password change succeeds
      expect(await screen.findByText(/Platform Administration Overview/i)).toBeInTheDocument();
    });
  });
});
