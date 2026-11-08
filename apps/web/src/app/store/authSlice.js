import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { apiClient } from '../../services/api/client.js';

export const AUTH_STATES = Object.freeze({
  INITIALIZING: 'INITIALIZING',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  AUTHENTICATED_SUPERADMIN: 'AUTHENTICATED_SUPERADMIN',
  AUTHENTICATED_OWNER: 'AUTHENTICATED_OWNER',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
});

/**
 * Validates the current session against the server source of truth (GET /api/auth/me)
 * Using HttpOnly cookie credentials.
 */
export const restoreSession = createAsyncThunk(
  'auth/restoreSession',
  async (_, { rejectWithValue }) => {
    try {
      const response = await apiClient.get('/auth/me');
      return response.data?.data || response.data;
    } catch (err) {
      return rejectWithValue({
        status: err.status || null,
        code: err.code || 'UNKNOWN_ERROR',
        message: err.message || 'Session verification failed',
      });
    }
  }
);

/**
 * Superadmin credential login (POST /api/auth/superadmin/login)
 */
export const loginSuperadmin = createAsyncThunk(
  'auth/loginSuperadmin',
  async ({ identifier, password }, { rejectWithValue }) => {
    try {
      const response = await apiClient.post('/auth/superadmin/login', {
        identifier,
        password,
      });
      return response.data?.data || response.data;
    } catch (err) {
      return rejectWithValue({
        status: err.status || null,
        code: err.code || 'LOGIN_ERROR',
        message: err.message || 'Authentication failed',
      });
    }
  }
);

/**
 * Initiates TOTP Enrollment (POST /api/auth/superadmin/totp/enroll)
 */
export const enrollTotp = createAsyncThunk('auth/enrollTotp', async (_, { rejectWithValue }) => {
  try {
    const response = await apiClient.post('/auth/superadmin/totp/enroll');
    return response.data?.data || response.data;
  } catch (err) {
    return rejectWithValue({
      status: err.status || null,
      code: err.code || 'TOTP_ENROLL_ERROR',
      message: err.message || 'Failed to initiate TOTP enrollment',
    });
  }
});

/**
 * Confirms TOTP Enrollment (POST /api/auth/superadmin/totp/confirm)
 */
export const confirmTotpEnrollment = createAsyncThunk(
  'auth/confirmTotpEnrollment',
  async ({ code, secret }, { rejectWithValue }) => {
    try {
      const response = await apiClient.post('/auth/superadmin/totp/confirm', { code, secret });
      return response.data?.data || response.data;
    } catch (err) {
      return rejectWithValue({
        status: err.status || null,
        code: err.code || 'TOTP_CONFIRM_ERROR',
        message: err.message || 'TOTP enrollment confirmation failed',
      });
    }
  }
);

/**
 * Verifies standard 6-digit TOTP code (POST /api/auth/superadmin/totp/verify)
 */
export const verifyTotp = createAsyncThunk(
  'auth/verifyTotp',
  async ({ code }, { rejectWithValue }) => {
    try {
      const response = await apiClient.post('/auth/superadmin/totp/verify', { code });
      return response.data?.data || response.data;
    } catch (err) {
      return rejectWithValue({
        status: err.status || null,
        code: err.code || 'TOTP_VERIFY_ERROR',
        message: err.message || 'Second-factor verification failed',
      });
    }
  }
);

/**
 * Verifies single-use emergency recovery code (POST /api/auth/superadmin/totp/recovery)
 */
export const verifyRecoveryCode = createAsyncThunk(
  'auth/verifyRecoveryCode',
  async ({ recoveryCode }, { rejectWithValue }) => {
    try {
      const response = await apiClient.post('/auth/superadmin/totp/recovery', { recoveryCode });
      return response.data?.data || response.data;
    } catch (err) {
      return rejectWithValue({
        status: err.status || null,
        code: err.code || 'RECOVERY_VERIFY_ERROR',
        message: err.message || 'Recovery code verification failed',
      });
    }
  }
);

/**
 * Mandatory first-login and self-service password change (POST /api/auth/change-password)
 */
export const changePassword = createAsyncThunk(
  'auth/changePassword',
  async ({ currentPassword, newPassword }, { rejectWithValue }) => {
    try {
      const response = await apiClient.post('/auth/change-password', {
        currentPassword,
        newPassword,
      });
      return response.data?.data || response.data;
    } catch (err) {
      return rejectWithValue({
        status: err.status || null,
        code: err.code || 'PASSWORD_CHANGE_ERROR',
        message: err.message || 'Password update failed',
      });
    }
  }
);

/**
 * Server-enforced recovery code acknowledgment (POST /api/auth/superadmin/recovery-codes/acknowledge)
 */
export const acknowledgeRecoveryCodes = createAsyncThunk(
  'auth/acknowledgeRecoveryCodes',
  async (_, { rejectWithValue }) => {
    try {
      const response = await apiClient.post('/auth/superadmin/recovery-codes/acknowledge');
      return response.data?.data || response.data;
    } catch (err) {
      return rejectWithValue({
        status: err.status || null,
        code: err.code || 'ACKNOWLEDGE_RECOVERY_ERROR',
        message: err.message || 'Failed to acknowledge recovery codes',
      });
    }
  }
);

/**
 * Regenerates emergency recovery codes while acknowledgment is pending (POST /api/auth/superadmin/recovery-codes/regenerate)
 */
export const regenerateRecoveryCodes = createAsyncThunk(
  'auth/regenerateRecoveryCodes',
  async (_, { rejectWithValue }) => {
    try {
      const response = await apiClient.post('/auth/superadmin/recovery-codes/regenerate');
      return response.data?.data || response.data;
    } catch (err) {
      return rejectWithValue({
        status: err.status || null,
        code: err.code || 'REGENERATE_RECOVERY_ERROR',
        message: err.message || 'Failed to regenerate recovery codes',
      });
    }
  }
);

/**
 * Server-side logout (POST /api/auth/logout)
 * Revokes session on the server and clears HttpOnly session cookie.
 */
export const logoutUser = createAsyncThunk('auth/logoutUser', async () => {
  try {
    await apiClient.post('/auth/logout');
  } catch {
    // Continue local cleanup even if server returns error or session already expired
  }
  return null;
});

const initialState = {
  authState: AUTH_STATES.INITIALIZING,
  user: null,
  platformRole: null,
  activeTenant: null,
  tenantMemberships: [],
  session: null,
  pendingAuth: null, // Tracks intermediate 2FA state: { requiresTotpEnrollment, requiresSecondFactor, mustChangePassword }
  error: null,
};

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setAuthState: (state, action) => {
      state.authState = action.payload;
    },
    clearAuthError: (state) => {
      state.error = null;
    },
    setPendingAuth: (state, action) => {
      state.pendingAuth = action.payload;
    },
    clearPendingAuth: (state) => {
      state.pendingAuth = null;
    },
    setSessionData: (state, action) => {
      const payload = action.payload || {};
      state.user = payload.user || null;
      state.platformRole = payload.platformRole || null;
      state.activeTenant = payload.activeTenant || null;
      state.tenantMemberships = payload.tenantMemberships || [];
      state.session = payload.session || null;
      state.error = null;
      state.pendingAuth = null;

      if (payload.platformRole === 'SUPERADMIN') {
        state.authState = AUTH_STATES.AUTHENTICATED_SUPERADMIN;
      } else if (
        payload.session?.sessionType === 'TENANT' ||
        payload.tenantMemberships?.some((m) => m.role === 'STORE_OWNER')
      ) {
        state.authState = AUTH_STATES.AUTHENTICATED_OWNER;
      } else {
        state.authState = AUTH_STATES.UNAUTHENTICATED;
      }
    },
  },
  extraReducers: (builder) => {
    // restoreSession
    builder
      .addCase(restoreSession.pending, (state) => {
        state.authState = AUTH_STATES.INITIALIZING;
        state.error = null;
      })
      .addCase(restoreSession.fulfilled, (state, action) => {
        const payload = action.payload || {};
        state.user = payload.user || null;
        state.platformRole = payload.platformRole || null;
        state.activeTenant = payload.activeTenant || null;
        state.tenantMemberships = payload.tenantMemberships || [];
        state.session = payload.session || null;
        state.error = null;

        if (payload.platformRole === 'SUPERADMIN') {
          // If session is still pending second-factor verification, not fully authenticated
          if (payload.session?.isSecondFactorPending) {
            state.authState = AUTH_STATES.UNAUTHENTICATED;
          } else {
            state.authState = AUTH_STATES.AUTHENTICATED_SUPERADMIN;
          }
        } else if (
          payload.session?.sessionType === 'TENANT' ||
          payload.tenantMemberships?.some((m) => m.role === 'STORE_OWNER')
        ) {
          state.authState = AUTH_STATES.AUTHENTICATED_OWNER;
        } else {
          state.authState = AUTH_STATES.UNAUTHENTICATED;
        }
      })
      .addCase(restoreSession.rejected, (state, action) => {
        const errorPayload = action.payload || {};
        state.user = null;
        state.platformRole = null;
        state.activeTenant = null;
        state.tenantMemberships = [];
        state.session = null;
        state.pendingAuth = null;

        // Distinguish unauthenticated 401 from network/server failures
        if (errorPayload.status === 401) {
          state.authState = AUTH_STATES.UNAUTHENTICATED;
          state.error = null;
        } else {
          state.authState = AUTH_STATES.AUTHENTICATION_ERROR;
          state.error = errorPayload.message || 'Unable to connect to authentication server';
        }
      });

    // loginSuperadmin
    builder
      .addCase(loginSuperadmin.fulfilled, (state, action) => {
        const payload = action.payload || {};
        state.user = payload.user || null;
        state.pendingAuth = {
          isSecondFactorPending: payload.isSecondFactorPending,
          requiresTotpEnrollment: payload.requiresTotpEnrollment,
          requiresSecondFactor: payload.requiresSecondFactor,
          mustChangePassword: payload.mustChangePassword,
        };
        state.error = null;
      })
      .addCase(loginSuperadmin.rejected, (state, action) => {
        state.error = action.payload?.message || 'Login failed';
      });

    // confirmTotpEnrollment: Mark session as pending recovery code acknowledgment
    builder.addCase(confirmTotpEnrollment.fulfilled, (state, action) => {
      const payload = action.payload || {};
      state.platformRole = 'SUPERADMIN';
      state.session = {
        ...(state.session || {}),
        isRecoveryCodeAckPending: true,
      };
      if (payload.user) {
        state.user = {
          ...payload.user,
          mustChangePassword: payload.mustChangePassword ?? false,
        };
      } else if (state.user) {
        state.user.mustChangePassword = payload.mustChangePassword ?? false;
      }
      state.pendingAuth = null;
      state.error = null;
    });

    // acknowledgeRecoveryCodes: Clears pending acknowledgment restriction
    builder.addCase(acknowledgeRecoveryCodes.fulfilled, (state) => {
      if (state.session) {
        state.session.isRecoveryCodeAckPending = false;
      }
      state.authState = AUTH_STATES.AUTHENTICATED_SUPERADMIN;
      state.error = null;
    });
    builder.addCase(acknowledgeRecoveryCodes.rejected, (state, action) => {
      state.error = action.payload?.message || 'Failed to acknowledge recovery codes';
    });

    // regenerateRecoveryCodes
    builder.addCase(regenerateRecoveryCodes.rejected, (state, action) => {
      state.error = action.payload?.message || 'Failed to regenerate recovery codes';
    });

    // verifyTotp / verifyRecoveryCode: Flip authState immediately
    const handle2faSuccess = (state, action) => {
      const payload = action.payload || {};
      state.platformRole = 'SUPERADMIN';
      if (payload.user) {
        state.user = {
          ...payload.user,
          mustChangePassword: payload.mustChangePassword ?? false,
        };
      } else if (state.user) {
        state.user.mustChangePassword = payload.mustChangePassword ?? false;
      }
      if (payload.isRecoveryCodeAckPending) {
        state.session = {
          ...(state.session || {}),
          isRecoveryCodeAckPending: true,
        };
      }
      state.authState = AUTH_STATES.AUTHENTICATED_SUPERADMIN;
      state.pendingAuth = null;
      state.error = null;
    };

    builder
      .addCase(verifyTotp.fulfilled, handle2faSuccess)
      .addCase(verifyRecoveryCode.fulfilled, handle2faSuccess);

    // changePassword
    builder.addCase(changePassword.fulfilled, (state) => {
      if (state.user) {
        state.user.mustChangePassword = false;
      }
      state.error = null;
    });

    // logoutUser
    builder.addCase(logoutUser.fulfilled, (state) => {
      state.authState = AUTH_STATES.UNAUTHENTICATED;
      state.user = null;
      state.platformRole = null;
      state.activeTenant = null;
      state.tenantMemberships = [];
      state.session = null;
      state.pendingAuth = null;
      state.error = null;
    });
  },
});

export const { setAuthState, clearAuthError, setPendingAuth, clearPendingAuth, setSessionData } =
  authSlice.actions;
export default authSlice.reducer;
