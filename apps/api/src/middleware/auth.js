import { prisma } from '../db/client.js';
import { hashToken } from '../utils/security.js';
import { errorResponse } from '../utils/apiResponse.js';

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
        if (val) return decodeURIComponent(val);
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
      },
    });

    if (!session || session.revokedAt !== null) {
      return res
        .status(401)
        .json(errorResponse('Session is invalid or has been revoked', null, 'SESSION_INVALID'));
    }

    const now = new Date();

    // Check idle expiration
    if (session.idleExpiresAt < now) {
      return res
        .status(401)
        .json(errorResponse('Session has expired due to inactivity', null, 'SESSION_IDLE_EXPIRED'));
    }

    // Check absolute expiration
    if (session.absoluteExpiresAt < now) {
      return res
        .status(401)
        .json(
          errorResponse('Session has reached absolute lifetime limit', null, 'SESSION_EXPIRED')
        );
    }

    if (!session.user || session.user.status !== 'ACTIVE') {
      return res
        .status(403)
        .json(errorResponse('User account is inactive or suspended', null, 'USER_INACTIVE'));
    }

    // SEC-AUTH-06: Sliding idle session expiration (throttled to avoid DB write storms)
    const SUPERADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
    const lastActivity = session.lastActivityAt ? new Date(session.lastActivityAt).getTime() : 0;
    if (now.getTime() - lastActivity > 60 * 1000) {
      const prospectiveIdle = new Date(now.getTime() + SUPERADMIN_IDLE_TIMEOUT_MS);
      // Sliding expiration must never exceed the 12-hour absolute expiration
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
