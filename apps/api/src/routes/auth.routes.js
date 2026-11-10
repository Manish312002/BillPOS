import { Router } from 'express';
import {
  superadminLoginSchema,
  totpVerificationSchema,
  totpEnrollmentConfirmSchema,
  totpRecoveryVerifySchema,
  changePasswordSchema,
  validateInvitationSchema,
  ownerActivationSchema,
  ownerLoginSchema,
  AUDIT_ACTIONS,
} from '@billingbuddy/shared';
import * as authService from '../services/auth.service.js';
import {
  authenticate,
  extractSessionToken,
  requireSuperadmin,
  requireSecondFactorComplete,
  requireRecoveryCodeAckComplete,
  requirePasswordChangeComplete,
} from '../middleware/auth.js';
import { csrfProtection } from '../middleware/csrf.js';
import { successResponse, errorResponse } from '../utils/apiResponse.js';
import { hashToken } from '../utils/security.js';
import { recordSecurityRejectionAuditSafe } from '../services/audit.service.js';
import { prisma } from '../db/client.js';

const router = Router();

// Mount centralized CSRF and Origin Protection on state-mutating requests
router.use(csrfProtection);

// Cookie helper
const isProduction = process.env.NODE_ENV === 'production';
const COOKIE_NAME = 'bb_session';
const COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours default (Superadmin)
const OWNER_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (Store Owner)

function setSessionCookie(res, token, maxAgeMs = COOKIE_MAX_AGE_MS) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
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
      req,
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
      isRecoveryCodeAckPending: result.isRecoveryCodeAckPending ?? true,
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
      isRecoveryCodeAckPending: result.isRecoveryCodeAckPending ?? false,
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
        isRecoveryCodeAckPending: result.isRecoveryCodeAckPending ?? false,
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
 * POST /api/auth/superadmin/recovery-codes/acknowledge
 * Confirms that the administrator has securely retained the emergency recovery codes.
 * Atomically marks acknowledgment complete on the server session and UserTotp.
 */
router.post(
  '/superadmin/recovery-codes/acknowledge',
  authenticate,
  requireSuperadmin,
  async (req, res, next) => {
    try {
      const result = await authService.acknowledgeRecoveryCodes({
        userId: req.user.id,
        sessionId: req.session.id,
      });

      return res
        .status(200)
        .json(successResponse(result, 'Recovery codes acknowledged successfully'));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/auth/superadmin/recovery-codes/regenerate
 * Regenerates a fresh set of recovery codes while acknowledgment is pending.
 * Invalidates prior codes and keeps acknowledgment pending.
 */
router.post(
  '/superadmin/recovery-codes/regenerate',
  authenticate,
  requireSuperadmin,
  async (req, res, next) => {
    try {
      const result = await authService.regenerateRecoveryCodes({
        userId: req.user.id,
        sessionId: req.session.id,
      });

      return res
        .status(200)
        .json(successResponse(result, 'Recovery codes regenerated successfully'));
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

      return res.status(200).json(
        successResponse(
          {
            user: result.user,
            mustChangePassword: false,
          },
          result.message
        )
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/auth/logout
 * Dedicated logout token resolver and session revocation endpoint.
 * Follows ADR-010 four-case operational matrix:
 * 1. Missing cookie -> 401 UNAUTHORIZED (no cookie cleared, no audit log)
 * 2. Malformed or unknown token -> 401 SESSION_INVALID, clear cookie, standalone SESSION_VALIDATION_FAILED audit log
 * 3. Already-revoked session -> 200 OK, clear cookie, skip duplicate audit logs
 * 4. Active session -> atomic conditional update + USER_LOGGED_OUT, clear cookie, 200 OK
 */
router.post('/logout', async (req, res, next) => {
  try {
    const token = extractSessionToken(req);

    // Case 1: Missing cookie / token
    if (!token) {
      return res.status(401).json(errorResponse('Authentication required', null, 'UNAUTHORIZED'));
    }

    // Case 2a: Malformed token string
    const isMalformed = typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(token);
    if (isMalformed) {
      clearSessionCookie(res);
      await recordSecurityRejectionAuditSafe({
        action: AUDIT_ACTIONS.SESSION_VALIDATION_FAILED,
        reason: 'MALFORMED_TOKEN',
        resourceType: 'SESSION',
        actorUserId: null,
        req,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return res
        .status(401)
        .json(errorResponse('Session is invalid or not found', null, 'SESSION_INVALID'));
    }

    let sessionTokenHash;
    try {
      sessionTokenHash = hashToken(token);
    } catch {
      clearSessionCookie(res);
      await recordSecurityRejectionAuditSafe({
        action: AUDIT_ACTIONS.SESSION_VALIDATION_FAILED,
        reason: 'MALFORMED_TOKEN',
        resourceType: 'SESSION',
        actorUserId: null,
        req,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return res
        .status(401)
        .json(errorResponse('Session is invalid or not found', null, 'SESSION_INVALID'));
    }

    const session = await prisma.session.findUnique({
      where: { sessionTokenHash },
      include: { activeTenant: true },
    });

    // Case 2: Unknown token (hash not found in database)
    if (!session) {
      clearSessionCookie(res);
      await recordSecurityRejectionAuditSafe({
        action: AUDIT_ACTIONS.SESSION_VALIDATION_FAILED,
        reason: 'SESSION_NOT_FOUND',
        resourceType: 'SESSION',
        actorUserId: null,
        req,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return res
        .status(401)
        .json(errorResponse('Session is invalid or not found', null, 'SESSION_INVALID'));
    }

    // Case 3: Already-revoked session (retry or race)
    if (session.revokedAt !== null) {
      clearSessionCookie(res);
      return res.status(200).json(successResponse(null, 'Logged out successfully'));
    }

    // Case 4: Active session (atomic revocation + audit insert)
    await authService.logout({
      sessionId: session.id,
      req,
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
router.get('/me', authenticate, async (req, res, next) => {
  try {
    let tenantMemberships = req.tenantMemberships || [];
    if (tenantMemberships.length === 0 && req.user) {
      tenantMemberships = await prisma.tenantMembership.findMany({
        where: { userId: req.user.id },
        include: { tenant: true },
      });
    }

    return res.status(200).json(
      successResponse({
        user: authService.sanitizeUser(req.user),
        session: {
          id: req.session.id,
          sessionType: req.session.sessionType,
          isSecondFactorPending: req.session.isSecondFactorPending,
          isRecoveryCodeAckPending: req.session.isRecoveryCodeAckPending ?? false,
          idleExpiresAt: req.session.idleExpiresAt,
          absoluteExpiresAt: req.session.absoluteExpiresAt,
        },
        platformRole: req.platformRole,
        activeTenant: req.activeTenant || null,
        tenantMemberships: tenantMemberships.map((m) => ({
          id: m.id,
          tenantId: m.tenantId,
          role: m.role,
          status: m.status,
          tenant: m.tenant
            ? {
                id: m.tenant.id,
                slug: m.tenant.slug,
                legalName: m.tenant.legalName,
                tradeName: m.tenant.tradeName,
                status: m.tenant.status,
              }
            : null,
        })),
      })
    );
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/superadmin/dashboard-access
 * Privileged route verifying SEC-AUTH-08: 2FA, recovery code ack, and password-change must be completed.
 */
router.get(
  '/superadmin/dashboard-access',
  authenticate,
  requireSuperadmin,
  requireSecondFactorComplete,
  requireRecoveryCodeAckComplete,
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

/**
 * POST /api/auth/owner/invitation/validate
 * Validates a Store Owner invitation token without exposing secrets
 */
router.post('/owner/invitation/validate', async (req, res, next) => {
  try {
    const validated = validateInvitationSchema.parse(req.body);

    const result = await authService.validateOwnerInvitation({
      token: validated.token,
    });

    return res.status(200).json(successResponse(result, 'Invitation is valid'));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/owner/activate
 * Sets initial password, accepts invitation, creates/links user & membership,
 * activates store, and establishes an authenticated 7-day session.
 */
router.post('/owner/activate', async (req, res, next) => {
  try {
    const validated = ownerActivationSchema.parse(req.body);

    const result = await authService.activateOwnerInvitation({
      token: validated.token,
      password: validated.password,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    setSessionCookie(res, result.sessionToken, OWNER_COOKIE_MAX_AGE_MS);

    return res.status(200).json(
      successResponse(
        {
          user: result.user,
          activeTenant: result.activeTenant,
          membership: result.membership,
        },
        'Store Owner account activated successfully'
      )
    );
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/owner/login
 * Store Owner credential login (phone or email + password, optional tenantSlug)
 */
router.post('/owner/login', async (req, res, next) => {
  try {
    const validated = ownerLoginSchema.parse(req.body);

    const result = await authService.loginOwner({
      identifier: validated.identifier,
      password: validated.password,
      tenantSlug: validated.tenantSlug,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      req,
    });

    setSessionCookie(res, result.sessionToken, OWNER_COOKIE_MAX_AGE_MS);

    return res.status(200).json(
      successResponse(
        {
          user: result.user,
          activeTenant: result.activeTenant,
          tenantMemberships: result.tenantMemberships,
        },
        'Store Owner logged in successfully'
      )
    );
  } catch (err) {
    next(err);
  }
});

export default router;
