import { prisma } from '../db/client.js';
import { hashToken } from '../utils/security.js';
import { errorResponse } from '../utils/apiResponse.js';
import {
  recordAuditEvent,
  recordSecurityRejectionAuditSafe,
} from '../services/audit.service.js';
import {
  AUDIT_MODULES,
  AUDIT_EVENT_TYPES,
  AUDIT_ACTIONS,
  AUDIT_STATUS,
} from '@billingbuddy/shared';

/**
 * Lightweight cookie parser for `bb_session` without adding third-party dependencies.
 */
export function extractSessionToken(req) {
  // 1. Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  // 2. Cookie header: bb_session=<token>
  const cookieHeader = req.headers.cookie;
  if (cookieHeader && typeof cookieHeader === 'string') {
    const cookies = cookieHeader.split(';');
    for (const cookie of cookies) {
      const [name, ...valParts] = cookie.trim().split('=');
      if (name === 'bb_session') {
        const val = valParts.join('=').trim();
        if (val) {
          try {
            return decodeURIComponent(val);
          } catch {
            return val;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Authentication middleware.
 * Resolves session, validates idle & absolute expiration, attaches user and session to request.
 */
export async function authenticate(req, res, next) {
  try {
    const token = extractSessionToken(req);

    if (!token) {
      return res.status(401).json(errorResponse('Authentication required', null, 'UNAUTHORIZED'));
    }

    const sessionTokenHash = hashToken(token);

    const session = await prisma.session.findUnique({
      where: { sessionTokenHash },
      include: {
        user: {
          include: {
            platformAuthorization: true,
          },
        },
        activeTenant: true,
      },
    });

    if (!session || session.revokedAt !== null) {
      await recordSecurityRejectionAuditSafe({
        action: AUDIT_ACTIONS.SESSION_VALIDATION_FAILED,
        reason: session ? 'SESSION_REVOKED' : 'SESSION_NOT_FOUND',
        resourceType: 'SESSION',
        resourceId: session ? session.id : null,
        actorUserId: null,
        metadata: {
          sessionUserId: session ? session.userId : null,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        req,
      });
      return res
        .status(401)
        .json(errorResponse('Session is invalid or has been revoked', null, 'SESSION_INVALID'));
    }

    const now = new Date();

    // Check idle expiration
    if (session.idleExpiresAt < now) {
      await recordSecurityRejectionAuditSafe({
        action: AUDIT_ACTIONS.SESSION_EXPIRED,
        reason: 'SESSION_IDLE_EXPIRED',
        resourceType: 'SESSION',
        resourceId: session.id,
        actorUserId: null,
        metadata: {
          sessionUserId: session.userId,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        req,
      });
      return res
        .status(401)
        .json(errorResponse('Session has expired due to inactivity', null, 'SESSION_IDLE_EXPIRED'));
    }

    // Check absolute expiration
    if (session.absoluteExpiresAt < now) {
      await recordSecurityRejectionAuditSafe({
        action: AUDIT_ACTIONS.SESSION_EXPIRED,
        reason: 'SESSION_ABSOLUTE_EXPIRED',
        resourceType: 'SESSION',
        resourceId: session.id,
        actorUserId: null,
        metadata: {
          sessionUserId: session.userId,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        req,
      });
      return res
        .status(401)
        .json(
          errorResponse('Session has reached absolute lifetime limit', null, 'SESSION_EXPIRED')
        );
    }

    if (!session.user || session.user.status !== 'ACTIVE') {
      await recordSecurityRejectionAuditSafe({
        action: AUDIT_ACTIONS.SESSION_VALIDATION_FAILED,
        reason: 'USER_INACTIVE',
        resourceType: 'SESSION',
        resourceId: session.id,
        actorUserId: null,
        metadata: {
          sessionUserId: session.userId,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        req,
      });
      return res
        .status(403)
        .json(errorResponse('User account is inactive or suspended', null, 'USER_INACTIVE'));
    }

    // Only load tenant memberships when session belongs to a TENANT context
    // This avoids querying TenantMembership and Tenant relations for PLATFORM/Superadmin requests
    let tenantMemberships = [];
    if (session.sessionType === 'TENANT') {
      tenantMemberships = await prisma.tenantMembership.findMany({
        where: {
          userId: session.userId,
          ...(session.activeTenantId ? { tenantId: session.activeTenantId } : {}),
        },
        include: {
          tenant: true,
        },
      });
    }

    // SEC-AUTH-06: Sliding idle session expiration (throttled to avoid DB write storms)
    // Superadmin: 30 minutes; Store Owner: 12 hours (ADR-002)
    const idleTimeoutMs = session.sessionType === 'TENANT' ? 12 * 60 * 60 * 1000 : 30 * 60 * 1000;
    const lastActivity = session.lastActivityAt ? new Date(session.lastActivityAt).getTime() : 0;
    if (now.getTime() - lastActivity > 60 * 1000) {
      const prospectiveIdle = new Date(now.getTime() + idleTimeoutMs);
      // Sliding expiration must never exceed the absolute expiration
      const effectiveIdle =
        prospectiveIdle > session.absoluteExpiresAt ? session.absoluteExpiresAt : prospectiveIdle;

      await prisma.session.update({
        where: { id: session.id },
        data: {
          lastActivityAt: now,
          idleExpiresAt: effectiveIdle,
        },
      });
      session.lastActivityAt = now;
      session.idleExpiresAt = effectiveIdle;
    }

    // Attach to request
    req.session = session;
    req.user = session.user;
    req.platformRole = session.user.platformAuthorization?.role || null;
    req.tenantMemberships = tenantMemberships;
    req.activeTenant = session.activeTenant || null;

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Enforces that second-factor (TOTP) verification has been successfully completed.
 */
export function requireSecondFactorComplete(req, res, next) {
  if (req.session && req.session.isSecondFactorPending) {
    return res
      .status(403)
      .json(errorResponse('Second-factor verification required', null, 'SECOND_FACTOR_REQUIRED'));
  }
  next();
}

/**
 * Enforces that emergency recovery-code acknowledgment has been confirmed by the server.
 * Blocks access to protected platform resources while acknowledgment is pending.
 */
export function requireRecoveryCodeAckComplete(req, res, next) {
  if (req.session && req.session.isRecoveryCodeAckPending) {
    return res
      .status(403)
      .json(
        errorResponse(
          'Recovery-code acknowledgment is required before accessing privileged resources',
          null,
          'RECOVERY_CODE_ACK_REQUIRED'
        )
      );
  }
  next();
}

/**
 * Enforces that initial Superadmin password has been changed if `mustChangePassword` is set.
 */
export function requirePasswordChangeComplete(req, res, next) {
  if (req.user && req.user.mustChangePassword) {
    return res
      .status(403)
      .json(
        errorResponse(
          'Password change is required before accessing privileged resources',
          null,
          'PASSWORD_CHANGE_REQUIRED'
        )
      );
  }
  next();
}

/**
 * Enforces Superadmin platform authorization.
 */
export function requireSuperadmin(req, res, next) {
  if (!req.platformRole || req.platformRole !== 'SUPERADMIN') {
    return res.status(403).json(errorResponse('Superadmin privileges required', null, 'FORBIDDEN'));
  }
  next();
}

/**
 * Enforces Store Owner authorization and server-side tenant membership validation.
 * - Rejects Superadmins (portal isolation).
 * - Rejects users without an ACTIVE Store Owner membership.
 * - Rejects if the tenant organization is SUSPENDED.
 * - Never trusts client-supplied role or tenant IDs as proof of authorization.
 */
export async function requireStoreOwner(req, res, next) {
  // 1. Portal isolation: Superadmins cannot access Store Owner resources directly
  if (req.platformRole === 'SUPERADMIN') {
    return res
      .status(403)
      .json(
        errorResponse(
          'Superadmins are not authorized to access Store Owner resources directly',
          null,
          'FORBIDDEN'
        )
      );
  }

  // 2. Resolve membership for active tenant or matching STORE_OWNER role
  const targetTenantId = req.session.activeTenantId || req.params.tenantId;
  const memberships = req.tenantMemberships || [];

  const membership = targetTenantId
    ? memberships.find((m) => m.tenantId === targetTenantId)
    : memberships.find((m) => m.role === 'STORE_OWNER');

  if (!membership || membership.role !== 'STORE_OWNER') {
    return res
      .status(403)
      .json(errorResponse('Store Owner privileges required', null, 'FORBIDDEN'));
  }

  // 3. Verify server-side membership status
  if (membership.status !== 'ACTIVE') {
    return res
      .status(403)
      .json(
        errorResponse('Tenant membership is inactive or suspended', null, 'MEMBERSHIP_INACTIVE')
      );
  }

  // 4. Verify tenant organization status
  if (membership.tenant && membership.tenant.status === 'SUSPENDED') {
    await recordAuditEvent({
      actorUserId: req.user.id,
      actorRole: 'STORE_OWNER',
      targetTenantId: membership.tenantId,
      module: AUDIT_MODULES.AUTH,
      eventType: AUDIT_EVENT_TYPES.SECURITY_AUTH,
      action: AUDIT_ACTIONS.TENANT_ACCESS_DENIED,
      status: AUDIT_STATUS.FAILURE,
      resourceType: 'TENANT',
      resourceId: membership.tenantId,
      metadata: {
        reason: 'TENANT_SUSPENDED',
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      req,
    });
    return res
      .status(403)
      .json(errorResponse('Tenant organization is suspended', null, 'TENANT_SUSPENDED'));
  }

  req.currentMembership = membership;
  req.currentTenant = membership.tenant;
  next();
}

/**
 * Factory for enforcing tenant membership with specific role requirements.
 */
export function requireTenantMembership(requiredRole = null) {
  return async (req, res, next) => {
    const targetTenantId = req.session.activeTenantId || req.params.tenantId;
    const memberships = req.tenantMemberships || [];

    const membership = targetTenantId
      ? memberships.find((m) => m.tenantId === targetTenantId)
      : memberships[0];

    if (!membership) {
      return res
        .status(403)
        .json(errorResponse('Valid tenant membership required', null, 'FORBIDDEN'));
    }

    if (membership.status !== 'ACTIVE') {
      return res
        .status(403)
        .json(
          errorResponse('Tenant membership is inactive or suspended', null, 'MEMBERSHIP_INACTIVE')
        );
    }

    if (membership.tenant && membership.tenant.status === 'SUSPENDED') {
      await recordAuditEvent({
        actorUserId: req.user.id,
        actorRole: membership.role,
        targetTenantId: membership.tenantId,
        module: AUDIT_MODULES.AUTH,
        eventType: AUDIT_EVENT_TYPES.SECURITY_AUTH,
        action: AUDIT_ACTIONS.TENANT_ACCESS_DENIED,
        status: AUDIT_STATUS.FAILURE,
        resourceType: 'TENANT',
        resourceId: membership.tenantId,
        metadata: {
          reason: 'TENANT_SUSPENDED',
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        req,
      });
      return res
        .status(403)
        .json(errorResponse('Tenant organization is suspended', null, 'TENANT_SUSPENDED'));
    }

    if (requiredRole && membership.role !== requiredRole) {
      return res
        .status(403)
        .json(errorResponse(`Requires ${requiredRole} role`, null, 'FORBIDDEN'));
    }

    req.currentMembership = membership;
    req.currentTenant = membership.tenant;
    next();
  };
}
