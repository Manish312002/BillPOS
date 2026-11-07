import { Router } from 'express';
import {
  superadminLoginSchema,
  totpVerificationSchema,
  totpEnrollmentConfirmSchema,
  totpRecoveryVerifySchema,
  changePasswordSchema,
} from '@billingbuddy/shared';
import * as authService from '../services/auth.service.js';
import {
  authenticate,
  requireSuperadmin,
  requireSecondFactorComplete,
  requirePasswordChangeComplete,
} from '../middleware/auth.js';
import { csrfProtection } from '../middleware/csrf.js';
import { successResponse } from '../utils/apiResponse.js';

const router = Router();

// Mount centralized CSRF and Origin Protection on state-mutating requests
router.use(csrfProtection);

// Cookie helper
const isProduction = process.env.NODE_ENV === 'production';
const COOKIE_NAME = 'bb_session';
const COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  });
}

/**
 * POST /api/auth/superadmin/login
 * Credential login for Root Platform Superadmin
 */
router.post('/superadmin/login', async (req, res, next) => {
  try {
    const validated = superadminLoginSchema.parse(req.body);

    const result = await authService.loginSuperadmin({
      identifier: validated.identifier,
      password: validated.password,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    setSessionCookie(res, result.sessionToken);

    const responseData = {
      isSecondFactorPending: result.isSecondFactorPending,
      requiresTotpEnrollment: result.requiresTotpEnrollment,
      requiresSecondFactor: result.requiresSecondFactor,
      mustChangePassword: result.mustChangePassword,
      user: result.user,
    };

    return res
      .status(200)
      .json(
        successResponse(
          responseData,
          result.requiresTotpEnrollment
            ? 'TOTP enrollment required'
            : 'Second-factor verification required'
        )
      );
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/superadmin/totp/enroll
 * Generates an unconfirmed TOTP secret and provisioning URI
 */
router.post('/superadmin/totp/enroll', authenticate, requireSuperadmin, async (req, res, next) => {
  try {
    const result = await authService.enrollTotp({
      userId: req.user.id,
    });

    return res.status(200).json(successResponse(result, 'TOTP enrollment initiated successfully'));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/superadmin/totp/confirm
 * Confirms initial TOTP enrollment, activates 2FA, rotates session, and reveals single-use recovery codes
 */
router.post('/superadmin/totp/confirm', authenticate, requireSuperadmin, async (req, res, next) => {
  try {
    const validated = totpEnrollmentConfirmSchema.parse(req.body);

    const result = await authService.confirmTotpEnrollment({
      userId: req.user.id,
      code: validated.code,
      secret: validated.secret,
      sessionId: req.session.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // SEC-AUTH-01: Rotate session cookie
    setSessionCookie(res, result.newSessionToken);

    const responseData = {
      recoveryCodes: result.recoveryCodes,
      mustChangePassword: result.mustChangePassword,
      user: result.user,
    };

    return res
      .status(200)
      .json(successResponse(responseData, 'TOTP enrollment confirmed successfully'));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/superadmin/totp/verify
 * Verifies submitted 6-digit TOTP code during second-factor login and rotates session
 */
router.post('/superadmin/totp/verify', authenticate, requireSuperadmin, async (req, res, next) => {
  try {
    const validated = totpVerificationSchema.parse(req.body);

    const result = await authService.verifyTotpLogin({
      userId: req.user.id,
      code: validated.code,
      sessionId: req.session.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // SEC-AUTH-01: Rotate session cookie
    setSessionCookie(res, result.newSessionToken);

    const responseData = {
      mustChangePassword: result.mustChangePassword,
      user: result.user,
    };

    return res
      .status(200)
      .json(successResponse(responseData, 'Second-factor authentication successful'));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/superadmin/totp/recovery
 * Consumes single-use emergency recovery code, elevates session, and rotates session
 */
router.post(
  '/superadmin/totp/recovery',
  authenticate,
  requireSuperadmin,
  async (req, res, next) => {
    try {
      const validated = totpRecoveryVerifySchema.parse(req.body);

      const result = await authService.verifyRecoveryCodeLogin({
        userId: req.user.id,
        recoveryCode: validated.recoveryCode,
        sessionId: req.session.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      // SEC-AUTH-01: Rotate session cookie
      setSessionCookie(res, result.newSessionToken);

      const responseData = {
        remainingRecoveryCodesCount: result.remainingRecoveryCodesCount,
        mustChangePassword: result.mustChangePassword,
        user: result.user,
      };

      return res
        .status(200)
        .json(
          successResponse(responseData, 'Emergency recovery code accepted. Session authenticated.')
        );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/auth/change-password
 * First-login and self-service password change.
 * SEC-AUTH-02: Strictly enforces that second-factor verification is completed first.
 */
router.post(
  '/change-password',
  authenticate,
  requireSecondFactorComplete,
  async (req, res, next) => {
    try {
      const validated = changePasswordSchema.parse(req.body);

      const result = await authService.changePassword({
        userId: req.user.id,
        currentPassword: validated.currentPassword,
        newPassword: validated.newPassword,
        sessionId: req.session.id,
        isSecondFactorPending: req.session.isSecondFactorPending,
      });

      return res.status(200).json(successResponse(null, result.message));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/auth/logout
 * Revokes current session
 */
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await authService.logout({
      sessionId: req.session.id,
    });

    clearSessionCookie(res);

    return res.status(200).json(successResponse(null, 'Logged out successfully'));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 * Returns authenticated user profile and session status
 */
router.get('/me', authenticate, (req, res) => {
  return res.status(200).json(
    successResponse({
      user: authService.sanitizeUser(req.user),
      session: {
        id: req.session.id,
        sessionType: req.session.sessionType,
        isSecondFactorPending: req.session.isSecondFactorPending,
        idleExpiresAt: req.session.idleExpiresAt,
        absoluteExpiresAt: req.session.absoluteExpiresAt,
      },
      platformRole: req.platformRole,
    })
  );
});

/**
 * GET /api/auth/superadmin/dashboard-access
 * Privileged route verifying SEC-AUTH-08: both 2FA and password-change must be completed.
 */
router.get(
  '/superadmin/dashboard-access',
  authenticate,
  requireSuperadmin,
  requireSecondFactorComplete,
  requirePasswordChangeComplete,
  (req, res) => {
    return res.status(200).json(
      successResponse(
        {
          hasAccess: true,
          role: req.platformRole,
          userId: req.user.id,
        },
        'Dashboard access granted'
      )
    );
  }
);

export default router;
