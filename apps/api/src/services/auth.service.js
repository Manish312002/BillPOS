import { prisma } from '../db/client.js';
import {
  normalizePhone,
  normalizeEmail,
  normalizeIdentifier,
  AUDIT_MODULES,
  AUDIT_STATUS,
  AUDIT_EVENT_TYPES,
  AUDIT_ACTIONS,
} from '@billingbuddy/shared';
import {
  hashPassword,
  verifyPassword,
  generateOpaqueToken,
  hashToken,
  verifyTimingSafe,
  encryptTotpSecret,
  decryptTotpSecret,
} from '../utils/security.js';
import {
  generateTotpSecret,
  generateTotpUri,
  computeTotpCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode as verifyRecoveryCodeUtil,
} from '../utils/totp.js';
import {
  recordAuditEvent,
  recordSecurityRejectionAuditSafe,
} from './audit.service.js';
import { provisionTrialSubscription } from './subscription.service.js';

// Superadmin session lifetime constants (ADR-002)
const SUPERADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes idle timeout
const SUPERADMIN_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours absolute lifetime
const TOTP_MAX_FAILED_ATTEMPTS = 5;

// Store Owner session lifetime constants (ADR-002)
const STORE_OWNER_IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours idle timeout
const STORE_OWNER_ABSOLUTE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days absolute lifetime

/**
 * Safely masks an identifier (email or phone) for audit logging.
 * Never leaks the full identifier while preserving diagnostics.
 *
 * @param {string} identifier
 * @returns {string}
 */
export function maskIdentifier(identifier) {
  if (!identifier || typeof identifier !== 'string') return '[UNKNOWN]';
  const trimmed = identifier.trim();
  if (trimmed.includes('@')) {
    const parts = trimmed.split('@');
    const local = parts[0];
    const domain = parts[1] || '';
    if (local.length <= 2) {
      return `${local[0] || '*'}***@${domain}`;
    }
    return `${local[0]}***${local[local.length - 1]}@${domain}`;
  }
  // Phone: mask all digits except the last 4
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length >= 4) {
    const lastFour = digitsOnly.slice(-4);
    return `******${lastFour}`;
  }
  return '******';
}

/**
 * Transactionally revokes an old pending session and creates a new fully authenticated session.
 * Enforces SEC-AUTH-01 (Session rotation on privilege escalation).
 */
export async function rotateSessionToFullyAuthenticated(
  tx,
  oldSessionId,
  userId,
  ipAddress,
  userAgent,
  options = {}
) {
  if (oldSessionId) {
    await tx.session.updateMany({
      where: { id: oldSessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  const newSessionToken = generateOpaqueToken(32);
  const newSessionTokenHash = hashToken(newSessionToken);
  const now = new Date();

  const newSession = await tx.session.create({
    data: {
      userId,
      sessionTokenHash: newSessionTokenHash,
      sessionType: 'PLATFORM',
      isSecondFactorPending: false,
      isRecoveryCodeAckPending: Boolean(options.isRecoveryCodeAckPending),
      idleExpiresAt: new Date(now.getTime() + SUPERADMIN_IDLE_TIMEOUT_MS),
      absoluteExpiresAt: new Date(now.getTime() + SUPERADMIN_ABSOLUTE_TIMEOUT_MS),
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      lastActivityAt: now,
    },
  });

  await recordAuditEvent({
    tx,
    actorUserId: userId,
    actorRole: 'SUPERADMIN',
    module: AUDIT_MODULES.AUTH,
    eventType: AUDIT_EVENT_TYPES.SECURITY_AUTH,
    action: AUDIT_ACTIONS.SESSION_ROTATED,
    status: AUDIT_STATUS.SUCCESS,
    resourceType: 'SESSION',
    resourceId: newSession.id,
    metadata: {
      previousSessionId: oldSessionId,
      sessionType: 'PLATFORM',
      isSecondFactorPending: false,
    },
    ipAddress,
    userAgent,
  });

  return {
    newSessionToken,
    newSessionId: newSession.id,
    isRecoveryCodeAckPending: newSession.isRecoveryCodeAckPending,
  };
}

/**
 * Atomically increments failedAttempts and assigns lockedUntil in a single PostgreSQL statement.
 * Eliminates race conditions between failure counter and lockout threshold assignment.
 *
 * @param {string} totpId - ID of the UserTotp row
 * @returns {Promise<{ failedAttempts: number, lockedUntil: Date | null }>}
 */
async function recordFailedAttemptAtomic(totpId) {
  const result = await prisma.$queryRaw`
    UPDATE "UserTotp"
    SET "failedAttempts" = "failedAttempts" + 1,
        "lockedUntil" = CASE
          WHEN "failedAttempts" + 1 >= ${TOTP_MAX_FAILED_ATTEMPTS}
          THEN NOW() + INTERVAL '15 minutes'
          ELSE "lockedUntil"
        END
    WHERE "id" = ${totpId}
    RETURNING "failedAttempts", "lockedUntil"
  `;

  return result[0];
}

/**
 * Strips sensitive fields (hashes, encrypted secrets) before returning user object
 */
export function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

/**
 * Superadmin credential login.
 * Validates identifier/password and initiates second-factor session.
 */
export async function loginSuperadmin({ identifier, password, ipAddress, userAgent, req }) {
  if (!identifier || typeof identifier !== 'string' || !password || typeof password !== 'string') {
    await recordAuditEvent({
      actorUserId: null,
      module: AUDIT_MODULES.AUTH,
      eventType: AUDIT_EVENT_TYPES.SECURITY_AUTH,
      action: AUDIT_ACTIONS.SUPERADMIN_LOGIN_FAILED,
      status: AUDIT_STATUS.FAILURE,
      metadata: {
        identifier: maskIdentifier(identifier),
        reason: 'INVALID_CREDENTIALS',
      },
      ipAddress,
      userAgent,
      req,
    });
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  const { email, phone, rawTrimmed } = normalizeIdentifier(identifier);

  const orConditions = [];
  if (email) orConditions.push({ email });
  if (phone) orConditions.push({ phone });
  if (orConditions.length === 0) {
    orConditions.push({ email: rawTrimmed.toLowerCase() }, { phone: rawTrimmed });
  }

  // Find candidate users by phone or email
  const candidateUsers = await prisma.user.findMany({
    where: {
      OR: orConditions,
    },
    include: {
      platformAuthorization: true,
      totp: true,
    },
  });

  // Ambiguous identity defense: multiple distinct users matched
  if (candidateUsers.length > 1) {
    console.warn('[AUTH_DIAGNOSTIC] Superadmin login failed: ambiguous_identity_match', {
      count: candidateUsers.length,
    });
    await verifyPassword(
      'dummy_timing_constant',
      '$2b$12$e8wVdK0tM7L85a1vK9H26u2wVdK0tM7L85a1vK9H26u2wVdK0tM7L'
    );
    await recordAuditEvent({
      actorUserId: null,
      module: AUDIT_MODULES.AUTH,
      eventType: AUDIT_EVENT_TYPES.SECURITY_AUTH,
      action: AUDIT_ACTIONS.SUPERADMIN_LOGIN_FAILED,
      status: AUDIT_STATUS.FAILURE,
      metadata: {
        identifier: maskIdentifier(identifier),
        reason: 'AMBIGUOUS_IDENTITY',
      },
      ipAddress,
      userAgent,
      req,
    });
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  const user = candidateUsers.length === 1 ? candidateUsers[0] : null;

  // Timing-safe defense against account enumeration: run dummy bcrypt if user not found
  if (
    !user ||
    !user.passwordHash ||
    user.status !== 'ACTIVE' ||
    !user.platformAuthorization ||
    user.platformAuthorization.status !== 'ACTIVE' ||
    user.platformAuthorization.role !== 'SUPERADMIN'
  ) {
    await verifyPassword(
      'dummy_timing_constant',
      '$2b$12$e8wVdK0tM7L85a1vK9H26u2wVdK0tM7L85a1vK9H26u2wVdK0tM7L'
    );
    await recordSecurityRejectionAuditSafe({
      action: AUDIT_ACTIONS.SUPERADMIN_LOGIN_FAILED,
      reason: 'INVALID_CREDENTIALS',
      resourceType: 'SESSION',
      metadata: {
        identifier: maskIdentifier(identifier),
      },
      ipAddress,
      userAgent,
      req,
    });
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  const isPasswordValid = await verifyPassword(password, user.passwordHash);
  if (!isPasswordValid) {
    await recordSecurityRejectionAuditSafe({
      action: AUDIT_ACTIONS.SUPERADMIN_LOGIN_FAILED,
      reason: 'INVALID_CREDENTIALS',
      resourceType: 'SESSION',
      metadata: {
        identifier: maskIdentifier(identifier),
      },
      ipAddress,
      userAgent,
      req,
    });
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  const isTotpEnabled = Boolean(user.totp && user.totp.isEnabled);
  const requiresTotpEnrollment = !isTotpEnabled;

  // Check if account is temporarily locked due to excessive failed attempts
  if (user.totp && user.totp.lockedUntil && user.totp.lockedUntil > new Date()) {
    await recordSecurityRejectionAuditSafe({
      action: AUDIT_ACTIONS.SUPERADMIN_LOGIN_FAILED,
      reason: 'ACCOUNT_LOCKED',
      resourceType: 'SESSION',
      metadata: {
        identifier: maskIdentifier(identifier),
      },
      ipAddress,
      userAgent,
      req,
    });
    const err = new Error(
      'Account temporarily locked due to excessive failed attempts. Please try again later.'
    );
    err.statusCode = 429;
    err.code = 'TOO_MANY_REQUESTS';
    throw err;
  }

  // Generate 256-bit opaque session token
  const sessionToken = generateOpaqueToken(32);
  const sessionTokenHash = hashToken(sessionToken);
  const now = new Date();

  // Atomically persist session state and audit log in one transaction (ADR-010 Option A)
  const session = await prisma.$transaction(async (tx) => {
    // ADR-002: Second factor is pending until confirmed/verified
    const createdSession = await tx.session.create({
      data: {
        userId: user.id,
        sessionTokenHash,
        sessionType: 'PLATFORM',
        isSecondFactorPending: true,
        idleExpiresAt: new Date(now.getTime() + SUPERADMIN_IDLE_TIMEOUT_MS),
        absoluteExpiresAt: new Date(now.getTime() + SUPERADMIN_ABSOLUTE_TIMEOUT_MS),
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      },
    });

    // Record successful Superadmin credential authentication event atomically
    await recordAuditEvent({
      tx,
      actorUserId: user.id,
      actorRole: 'SUPERADMIN',
      module: AUDIT_MODULES.AUTH,
      eventType: AUDIT_EVENT_TYPES.SECURITY_AUTH,
      action: AUDIT_ACTIONS.SUPERADMIN_LOGIN_SUCCESS,
      status: AUDIT_STATUS.SUCCESS,
      resourceType: 'SESSION',
      resourceId: createdSession.id,
      metadata: {
        identifier: maskIdentifier(identifier),
        isSecondFactorPending: true,
        requiresTotpEnrollment,
        mustChangePassword: user.mustChangePassword,
      },
      ipAddress,
      userAgent,
      req,
    });

    return createdSession;
  });

  return {
    sessionToken,
    sessionId: session.id,
    isSecondFactorPending: true,
    requiresTotpEnrollment,
    requiresSecondFactor: true,
    mustChangePassword: user.mustChangePassword,
    user: sanitizeUser(user),
  };
}

/**
 * Initiates TOTP enrollment by generating a Base32 secret, storing it AES-256-GCM encrypted
 * in unconfirmed state, and returning the provisioning URI.
 */
export async function enrollTotp({ userId }) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      platformAuthorization: true,
      totp: true,
    },
  });

  if (
    !user ||
    user.status !== 'ACTIVE' ||
    !user.platformAuthorization ||
    user.platformAuthorization.role !== 'SUPERADMIN'
  ) {
    const err = new Error('Unauthorized');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  if (user.totp && user.totp.isEnabled) {
    const err = new Error('TOTP is already enabled for this account');
    err.statusCode = 400;
    err.code = 'BAD_REQUEST';
    throw err;
  }

  // Generate 20-byte cryptographically random Base32 secret
  const secret = generateTotpSecret();
  const accountIdentifier = user.phone || user.email || 'Superadmin';
  const provisioningUri = generateTotpUri({
    secret,
    accountName: accountIdentifier,
    issuer: 'BillingBuddy',
  });

  // Encrypt secret at rest via AES-256-GCM
  const secretEncrypted = encryptTotpSecret(secret);

  // Persist unconfirmed TOTP record
  await prisma.userTotp.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      secretEncrypted,
      isEnabled: false,
      recoveryCodeHashes: [],
    },
    update: {
      secretEncrypted,
      isEnabled: false,
      recoveryCodeHashes: [],
      failedAttempts: 0,
      lockedUntil: null,
    },
  });

  return {
    provisioningUri,
    secret,
    accountName: accountIdentifier,
    issuer: 'BillingBuddy',
  };
}

/**
 * Confirms initial TOTP enrollment with a valid 6-digit code.
 * Generates and reveals 128-bit emergency recovery codes once upon confirmation.
 * Rotates the session transactionally to fully authenticated state.
 */
export async function confirmTotpEnrollment({
  userId,
  code,
  secret: providedSecret,
  sessionId,
  ipAddress,
  userAgent,
}) {
  const totp = await prisma.userTotp.findUnique({
    where: { userId },
    include: { user: true },
  });

  if (!totp) {
    const err = new Error('TOTP enrollment has not been initiated');
    err.statusCode = 400;
    err.code = 'BAD_REQUEST';
    throw err;
  }

  if (totp.isEnabled) {
    const err = new Error('TOTP is already enabled for this account');
    err.statusCode = 400;
    err.code = 'BAD_REQUEST';
    throw err;
  }

  // SEC-AUTH-05: Check lockout on enrollment confirmation
  if (totp.lockedUntil && totp.lockedUntil > new Date()) {
    const err = new Error(
      'Account temporarily locked due to excessive failed attempts. Please try again later.'
    );
    err.statusCode = 429;
    err.code = 'TOO_MANY_REQUESTS';
    throw err;
  }

  // Decrypt stored secret
  const storedSecret = decryptTotpSecret(totp.secretEncrypted);

  if (providedSecret && providedSecret.trim().toUpperCase() !== storedSecret.trim().toUpperCase()) {
    const err = new Error('Provided secret does not match pending enrollment');
    err.statusCode = 400;
    err.code = 'BAD_REQUEST';
    throw err;
  }

  // Calculate current time step
  const now = Date.now();
  const currentStep = Math.floor(now / 30000);

  // Verify submitted code against candidate steps (T-1, T, T+1)
  const candidateSteps = [currentStep, currentStep - 1, currentStep + 1];
  let matchedStep = null;

  for (const step of candidateSteps) {
    const stepTimestamp = step * 30000;
    const expected = computeTotpCode(storedSecret, stepTimestamp);
    if (verifyTimingSafe(code.trim(), expected)) {
      matchedStep = step;
      break;
    }
  }

  if (matchedStep === null) {
    // SEC-AUTH-05, SEC-AUTH-09: Single-query atomic increment and lockout assignment
    await recordFailedAttemptAtomic(totp.id);

    const err = new Error('Invalid TOTP verification code');
    err.statusCode = 400;
    err.code = 'INVALID_TOTP_CODE';
    throw err;
  }

  // Generate 8 emergency recovery codes with 128-bit CSPRNG entropy each
  const recoveryCodes = generateRecoveryCodes(8);
  const recoveryCodeHashes = recoveryCodes.map(hashRecoveryCode);

  let rotatedSession = null;

  // Atomically enable TOTP and rotate active session with lockout check
  await prisma.$transaction(async (tx) => {
    const updateResult = await tx.userTotp.updateMany({
      where: {
        id: totp.id,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
      },
      data: {
        isEnabled: true,
        confirmedAt: new Date(),
        recoveryCodeHashes,
        lastAcceptedStep: matchedStep,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    if (updateResult.count === 0) {
      const err = new Error(
        'Account temporarily locked due to excessive failed attempts. Please try again later.'
      );
      err.statusCode = 429;
      err.code = 'TOO_MANY_REQUESTS';
      throw err;
    }

    // SEC-AUTH-01: Session rotation on privilege elevation with pending recovery code acknowledgment
    rotatedSession = await rotateSessionToFullyAuthenticated(
      tx,
      sessionId,
      userId,
      ipAddress,
      userAgent,
      { isRecoveryCodeAckPending: true }
    );

    await tx.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  });

  return {
    recoveryCodes, // Revealed ONLY ONCE on enrollment confirmation
    newSessionToken: rotatedSession.newSessionToken,
    newSessionId: rotatedSession.newSessionId,
    mustChangePassword: totp.user.mustChangePassword,
    user: sanitizeUser(totp.user),
    isRecoveryCodeAckPending: true,
  };
}

/**
 * Verifies submitted 6-digit TOTP code during login.
 * Enforces replay prevention, atomic timestep persistence, and session rotation.
 */
export async function verifyTotpLogin({ userId, code, sessionId, ipAddress, userAgent }) {
  const totp = await prisma.userTotp.findUnique({
    where: { userId },
    include: { user: true },
  });

  if (!totp || !totp.isEnabled) {
    const err = new Error('Authentication failed');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  // Check lockout
  if (totp.lockedUntil && totp.lockedUntil > new Date()) {
    const err = new Error(
      'Account temporarily locked due to excessive failed attempts. Please try again later.'
    );
    err.statusCode = 429;
    err.code = 'TOO_MANY_REQUESTS';
    throw err;
  }

  const storedSecret = decryptTotpSecret(totp.secretEncrypted);
  const now = Date.now();
  const currentStep = Math.floor(now / 30000);

  // Check window steps (T, T-1, T+1)
  const candidateSteps = [currentStep, currentStep - 1, currentStep + 1];
  let matchedStep = null;

  for (const step of candidateSteps) {
    const stepTimestamp = step * 30000;
    const expected = computeTotpCode(storedSecret, stepTimestamp);
    if (verifyTimingSafe(code.trim(), expected)) {
      matchedStep = step;
      break;
    }
  }

  if (matchedStep === null) {
    // SEC-AUTH-09: Single-query atomic increment and lockout assignment
    await recordFailedAttemptAtomic(totp.id);

    const err = new Error('Invalid verification code');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  // REPLAY ATTACK DEFENSE: Timestep must be strictly greater than last accepted step
  if (totp.lastAcceptedStep !== null && matchedStep <= totp.lastAcceptedStep) {
    const err = new Error('Code has already been used. Please wait for the next time-step.');
    err.statusCode = 400;
    err.code = 'TOTP_CODE_REUSED';
    throw err;
  }

  let rotatedSession = null;

  await prisma.$transaction(async (tx) => {
    // ATOMIC TIMESTEP PERSISTENCE & LOCKOUT RE-CHECK:
    // Ensures a valid code cannot authenticate if the account was locked concurrently
    const updateResult = await tx.userTotp.updateMany({
      where: {
        id: totp.id,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
        AND: [
          {
            OR: [{ lastAcceptedStep: null }, { lastAcceptedStep: { lt: matchedStep } }],
          },
        ],
      },
      data: {
        lastAcceptedStep: matchedStep,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    if (updateResult.count === 0) {
      const current = await tx.userTotp.findUnique({ where: { id: totp.id } });
      if (current && current.lockedUntil && current.lockedUntil > new Date()) {
        const err = new Error(
          'Account temporarily locked due to excessive failed attempts. Please try again later.'
        );
        err.statusCode = 429;
        err.code = 'TOO_MANY_REQUESTS';
        throw err;
      }

      const err = new Error('Code has already been used or verified concurrently');
      err.statusCode = 400;
      err.code = 'TOTP_CODE_REUSED';
      throw err;
    }

    // SEC-AUTH-01: Session rotation on privilege elevation
    // If the user never acknowledged recovery codes, preserve pending acknowledgment restriction
    const isAckPending = totp.recoveryCodesAcknowledgedAt === null;
    rotatedSession = await rotateSessionToFullyAuthenticated(
      tx,
      sessionId,
      userId,
      ipAddress,
      userAgent,
      { isRecoveryCodeAckPending: isAckPending }
    );

    await tx.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  });

  return {
    newSessionToken: rotatedSession.newSessionToken,
    newSessionId: rotatedSession.newSessionId,
    user: sanitizeUser(totp.user),
    mustChangePassword: totp.user.mustChangePassword,
    isRecoveryCodeAckPending: rotatedSession.isRecoveryCodeAckPending,
  };
}

/**
 * Verifies and atomically consumes a single-use 128-bit emergency recovery code.
 * Enforces atomic PostgreSQL array removal and session rotation.
 */
export async function verifyRecoveryCodeLogin({
  userId,
  recoveryCode,
  sessionId,
  ipAddress,
  userAgent,
}) {
  const totp = await prisma.userTotp.findUnique({
    where: { userId },
    include: { user: true },
  });

  if (!totp || !totp.isEnabled) {
    const err = new Error('Authentication failed');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  if (totp.lockedUntil && totp.lockedUntil > new Date()) {
    const err = new Error(
      'Account temporarily locked due to excessive failed attempts. Please try again later.'
    );
    err.statusCode = 429;
    err.code = 'TOO_MANY_REQUESTS';
    throw err;
  }

  // Verify submitted code in constant time against stored SHA-256 hashes
  const matchedHash = verifyRecoveryCodeUtil(recoveryCode, totp.recoveryCodeHashes);

  if (!matchedHash) {
    // SEC-AUTH-09: Single-query atomic increment and lockout assignment
    await recordFailedAttemptAtomic(totp.id);

    const err = new Error('Invalid recovery code');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  let rotatedSession = null;

  await prisma.$transaction(async (tx) => {
    // SEC-AUTH-04: Atomic PostgreSQL array removal with lockout constraint
    const rowsUpdated = await tx.$executeRaw`
      UPDATE "UserTotp"
      SET "recoveryCodeHashes" = array_remove("recoveryCodeHashes", ${matchedHash}),
          "failedAttempts" = 0,
          "lockedUntil" = NULL
      WHERE "id" = ${totp.id}
        AND ("lockedUntil" IS NULL OR "lockedUntil" <= NOW())
        AND ${matchedHash} = ANY("recoveryCodeHashes")
    `;

    if (rowsUpdated === 0) {
      const current = await tx.userTotp.findUnique({ where: { id: totp.id } });
      if (current && current.lockedUntil && current.lockedUntil > new Date()) {
        const err = new Error(
          'Account temporarily locked due to excessive failed attempts. Please try again later.'
        );
        err.statusCode = 429;
        err.code = 'TOO_MANY_REQUESTS';
        throw err;
      }

      const err = new Error('Recovery code has already been consumed or raced concurrently');
      err.statusCode = 400;
      err.code = 'RECOVERY_CODE_REUSED';
      throw err;
    }

    // SEC-AUTH-01: Session rotation on privilege elevation
    // Consuming a recovery code authenticates the session, but does NOT automatically mark
    // recovery-code acknowledgment complete. If acknowledgment is pending, it must be retained.
    const isAckPending = totp.recoveryCodesAcknowledgedAt === null;
    rotatedSession = await rotateSessionToFullyAuthenticated(
      tx,
      sessionId,
      userId,
      ipAddress,
      userAgent,
      { isRecoveryCodeAckPending: isAckPending }
    );

    await tx.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  });

  const updatedTotp = await prisma.userTotp.findUnique({
    where: { id: totp.id },
  });

  return {
    newSessionToken: rotatedSession.newSessionToken,
    newSessionId: rotatedSession.newSessionId,
    user: sanitizeUser(totp.user),
    mustChangePassword: totp.user.mustChangePassword,
    remainingRecoveryCodesCount: updatedTotp.recoveryCodeHashes.length,
    isRecoveryCodeAckPending: rotatedSession.isRecoveryCodeAckPending,
  };
}

/**
 * Changes user password with current password verification and bcrypt cost 12.
 * Enforces second-factor completion and invalidates other active sessions upon success.
 */
export async function changePassword({
  userId,
  currentPassword,
  newPassword,
  sessionId,
  isSecondFactorPending,
}) {
  // SEC-AUTH-02: 2FA must be complete before changing password
  if (isSecondFactorPending) {
    const err = new Error('Second-factor verification required before changing password');
    err.statusCode = 403;
    err.code = 'SECOND_FACTOR_REQUIRED';
    throw err;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user || !user.passwordHash) {
    const err = new Error('User not found');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  const isCurrentMatch = await verifyPassword(currentPassword, user.passwordHash);
  if (!isCurrentMatch) {
    const err = new Error('Current password is incorrect');
    err.statusCode = 400;
    err.code = 'INVALID_PASSWORD';
    throw err;
  }

  if (currentPassword === newPassword) {
    const err = new Error('New password cannot be identical to current password');
    err.statusCode = 400;
    err.code = 'BAD_REQUEST';
    throw err;
  }

  // Hashes with native bcrypt 12 rounds and validates complexity
  const newHash = await hashPassword(newPassword);

  let updatedUser = null;
  await prisma.$transaction(async (tx) => {
    updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
      },
    });

    // Invalidate all other active sessions for this user
    if (sessionId) {
      await tx.session.updateMany({
        where: {
          userId,
          id: { not: sessionId },
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    }
  });

  return {
    success: true,
    message: 'Password changed successfully',
    mustChangePassword: false,
    user: sanitizeUser(updatedUser),
  };
}

/**
 * Revokes a session upon user logout and records an immutable audit event atomically.
 * Uses conditional update (updateMany where revokedAt: null) to guarantee that concurrent
 * or repeated logout calls only record a single audit event and return an idempotent result.
 */
export async function logout({ sessionId, req = null, tx = null }) {
  if (!sessionId) return { success: false, reason: 'NO_SESSION_ID' };

  const executeLogout = async (db) => {
    const session = await db.session.findUnique({
      where: { id: sessionId },
      include: { activeTenant: true },
    });

    if (!session || session.revokedAt !== null) {
      return { success: true, alreadyRevoked: true };
    }

    const result = await db.session.updateMany({
      where: {
        id: sessionId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    if (result.count === 1) {
      const isSuperadmin = session.sessionType === 'PLATFORM';
      const action = isSuperadmin ? AUDIT_ACTIONS.SUPERADMIN_LOGOUT : AUDIT_ACTIONS.OWNER_LOGOUT;
      const role = isSuperadmin ? 'SUPERADMIN' : 'STORE_OWNER';

      await recordAuditEvent({
        tx: db,
        actorUserId: session.userId,
        actorRole: role,
        targetTenantId: session.activeTenantId || null,
        module: AUDIT_MODULES.AUTH,
        eventType: AUDIT_EVENT_TYPES.SECURITY_AUTH,
        action,
        status: AUDIT_STATUS.SUCCESS,
        resourceType: 'SESSION',
        resourceId: session.id,
        metadata: {
          sessionType: session.sessionType,
          revocationReason: 'USER_LOGOUT',
        },
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        req,
      });

      return { success: true, revoked: true };
    }

    return { success: true, alreadyRevoked: true };
  };

  if (tx) {
    return await executeLogout(tx);
  }

  return await prisma.$transaction(async (trx) => {
    return await executeLogout(trx);
  });
}

/**
 * Revokes a session for security or administrative reasons and records an audit event atomically.
 * Uses conditional update (updateMany where revokedAt: null) to ensure only one audit event is emitted.
 */
export async function revokeSession({
  sessionId,
  reason = 'ADMINISTRATIVE_REVOCATION',
  revokedByUserId = null,
  revokedByRole = null,
  tx = null,
  req = null,
}) {
  const executeRevoke = async (db) => {
    const session = await db.session.findUnique({
      where: { id: sessionId },
      include: { activeTenant: true },
    });

    if (!session || session.revokedAt !== null) {
      return null;
    }

    const result = await db.session.updateMany({
      where: {
        id: sessionId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    if (result.count !== 1) {
      return null;
    }

    const isSuperadmin = session.sessionType === 'PLATFORM';
    const action = isSuperadmin
      ? AUDIT_ACTIONS.SUPERADMIN_SESSION_REVOKED
      : AUDIT_ACTIONS.OWNER_SESSION_REVOKED;
    const role = isSuperadmin ? 'SUPERADMIN' : 'STORE_OWNER';

    await recordAuditEvent({
      tx: db,
      actorUserId: revokedByUserId || session.userId,
      actorRole: revokedByRole || role,
      targetTenantId: session.activeTenantId || null,
      module: AUDIT_MODULES.AUTH,
      eventType: AUDIT_EVENT_TYPES.SECURITY_AUTH,
      action,
      status: AUDIT_STATUS.SUCCESS,
      resourceType: 'SESSION',
      resourceId: session.id,
      metadata: {
        sessionType: session.sessionType,
        reason,
        revokedSessionUserId: session.userId,
      },
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      req,
    });

    return session;
  };

  if (tx) {
    return await executeRevoke(tx);
  }

  return await prisma.$transaction(async (trx) => {
    return await executeRevoke(trx);
  });
}

/**
 * Acknowledges emergency recovery codes and marks the server session fully un-restricted.
 * Rejects repeated or invalid transitions atomically using PostgreSQL row-level locking.
 */
export async function acknowledgeRecoveryCodes({ userId, sessionId }) {
  if (!userId || !sessionId) {
    const err = new Error('User ID and Session ID are required');
    err.statusCode = 400;
    err.code = 'BAD_REQUEST';
    throw err;
  }

  return await prisma.$transaction(async (tx) => {
    // 1. Atomically check and update session with conditional state check
    const updateResult = await tx.session.updateMany({
      where: {
        id: sessionId,
        userId,
        isRecoveryCodeAckPending: true,
        revokedAt: null,
      },
      data: { isRecoveryCodeAckPending: false },
    });

    if (updateResult.count === 0) {
      const existing = await tx.session.findUnique({ where: { id: sessionId } });
      if (!existing || existing.userId !== userId || existing.revokedAt !== null) {
        const err = new Error('Session is invalid or revoked');
        err.statusCode = 401;
        err.code = 'UNAUTHORIZED';
        throw err;
      }

      const err = new Error('Recovery-code acknowledgment is not pending for this session');
      err.statusCode = 400;
      err.code = 'ACK_NOT_PENDING';
      throw err;
    }

    // 2. Validate UserTotp
    const totp = await tx.userTotp.findUnique({
      where: { userId },
    });

    if (!totp || !totp.isEnabled) {
      const err = new Error('Two-factor authentication is not active');
      err.statusCode = 400;
      err.code = 'INVALID_STATE';
      throw err;
    }

    const now = new Date();

    // 3. Record acknowledgment timestamp
    await tx.userTotp.update({
      where: { id: totp.id },
      data: { recoveryCodesAcknowledgedAt: now },
    });

    const user = await tx.user.findUnique({ where: { id: userId } });

    return {
      acknowledged: true,
      acknowledgedAt: now,
      user: sanitizeUser(user),
    };
  });
}

/**
 * Regenerates a fresh set of emergency recovery codes while acknowledgment is pending.
 * Invalidates previously generated codes and keeps acknowledgment pending.
 */
export async function regenerateRecoveryCodes({ userId, sessionId }) {
  if (!userId || !sessionId) {
    const err = new Error('User ID and Session ID are required');
    err.statusCode = 400;
    err.code = 'BAD_REQUEST';
    throw err;
  }

  return await prisma.$transaction(async (tx) => {
    // 1. Validate session and ensure acknowledgment is pending
    const session = await tx.session.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.userId !== userId || session.revokedAt !== null) {
      const err = new Error('Session is invalid or revoked');
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    if (!session.isRecoveryCodeAckPending) {
      const err = new Error(
        'Recovery-code regeneration is only permitted while acknowledgment is pending'
      );
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    // 2. Validate UserTotp
    const totp = await tx.userTotp.findUnique({
      where: { userId },
    });

    if (!totp || !totp.isEnabled) {
      const err = new Error('Two-factor authentication is not active');
      err.statusCode = 400;
      err.code = 'INVALID_STATE';
      throw err;
    }

    // 3. Generate fresh 8 recovery codes
    const newRecoveryCodes = generateRecoveryCodes(8);
    const newRecoveryCodeHashes = newRecoveryCodes.map(hashRecoveryCode);

    // 4. Atomically overwrite old recovery code hashes with new hashes
    await tx.userTotp.update({
      where: { id: totp.id },
      data: {
        recoveryCodeHashes: newRecoveryCodeHashes,
      },
    });

    return {
      recoveryCodes: newRecoveryCodes,
    };
  });
}

/**
 * Validates a Store Owner invitation bearer token (hash verification, expiration, status).
 * Never exposes secrets (token hash or raw token).
 */
export async function validateOwnerInvitation({ token }) {
  if (!token || typeof token !== 'string') {
    const err = new Error('Invitation token is required');
    err.statusCode = 400;
    err.code = 'BAD_REQUEST';
    throw err;
  }

  const tokenHash = hashToken(token.trim());
  const invitation = await prisma.ownerInvitation.findUnique({
    where: { tokenHash },
    include: {
      tenant: true,
    },
  });

  if (!invitation) {
    const err = new Error('Invalid or unknown invitation token');
    err.statusCode = 404;
    err.code = 'INVITATION_NOT_FOUND';
    throw err;
  }

  if (invitation.status === 'SUPERSEDED') {
    const err = new Error('This invitation has been superseded by a newer link');
    err.statusCode = 410;
    err.code = 'INVITATION_SUPERSEDED';
    throw err;
  }

  if (invitation.status === 'REVOKED') {
    const err = new Error('This invitation has been revoked');
    err.statusCode = 410;
    err.code = 'INVITATION_REVOKED';
    throw err;
  }

  if (invitation.status === 'ACCEPTED') {
    const err = new Error('This invitation has already been accepted');
    err.statusCode = 410;
    err.code = 'INVITATION_ALREADY_ACCEPTED';
    throw err;
  }

  const now = new Date();
  if (invitation.expiresAt <= now || invitation.status === 'EXPIRED') {
    const err = new Error('This invitation has expired. Please request a new invitation link.');
    err.statusCode = 410;
    err.code = 'INVITATION_EXPIRED';
    throw err;
  }

  if (invitation.tenant.status === 'SUSPENDED') {
    const err = new Error('Store organization is currently suspended');
    err.statusCode = 403;
    err.code = 'TENANT_SUSPENDED';
    throw err;
  }

  return {
    valid: true,
    tenant: {
      id: invitation.tenant.id,
      slug: invitation.tenant.slug,
      legalName: invitation.tenant.legalName,
      tradeName: invitation.tenant.tradeName,
      status: invitation.tenant.status,
    },
    invitedPhone: invitation.invitedPhone,
    invitedEmail: invitation.invitedEmail,
    expiresAt: invitation.expiresAt,
  };
}

/**
 * Activates a Store Owner invitation atomically:
 * - Verifies token hash, status, expiration, and tenant status.
 * - Transitions invitation status to ACCEPTED.
 * - Creates or reuses User identity (multi-tenant owner support).
 * - Creates or activates TenantMembership with STORE_OWNER role.
 * - Transitions Tenant status to ACTIVE.
 * - Upserts OnboardingProgress at Step 1.
 * - Records TENANT_ACTIVATED audit event.
 * - Creates a 12h idle / 7d absolute TENANT session.
 */
export async function activateOwnerInvitation({ token, password, ipAddress, userAgent }) {
  if (!token || typeof token !== 'string') {
    const err = new Error('Invitation token is required');
    err.statusCode = 400;
    err.code = 'BAD_REQUEST';
    throw err;
  }

  const tokenHash = hashToken(token.trim());
  const newPasswordHash = await hashPassword(password);

  try {
    return await prisma.$transaction(
      async (tx) => {
        const invitation = await tx.ownerInvitation.findUnique({
          where: { tokenHash },
          include: {
            tenant: true,
          },
        });

        if (!invitation) {
          const err = new Error('Invalid or unknown invitation token');
          err.statusCode = 404;
          err.code = 'INVITATION_NOT_FOUND';
          throw err;
        }

        if (invitation.status === 'SUPERSEDED') {
          const err = new Error('This invitation has been superseded by a newer link');
          err.statusCode = 410;
          err.code = 'INVITATION_SUPERSEDED';
          throw err;
        }

        if (invitation.status === 'REVOKED') {
          const err = new Error('This invitation has been revoked');
          err.statusCode = 410;
          err.code = 'INVITATION_REVOKED';
          throw err;
        }

        if (invitation.status === 'ACCEPTED') {
          const err = new Error('This invitation has already been accepted');
          err.statusCode = 410;
          err.code = 'INVITATION_ALREADY_ACCEPTED';
          throw err;
        }

        const now = new Date();
        if (invitation.expiresAt <= now || invitation.status === 'EXPIRED') {
          const err = new Error(
            'This invitation has expired. Please request a new invitation link.'
          );
          err.statusCode = 410;
          err.code = 'INVITATION_EXPIRED';
          throw err;
        }

        if (invitation.tenant.status === 'SUSPENDED') {
          const err = new Error('Store organization is currently suspended');
          err.statusCode = 403;
          err.code = 'TENANT_SUSPENDED';
          throw err;
        }

        // Atomically consume invitation with conditional check (status must be PENDING)
        const updateResult = await tx.ownerInvitation.updateMany({
          where: {
            id: invitation.id,
            status: 'PENDING',
          },
          data: {
            status: 'ACCEPTED',
            acceptedAt: now,
          },
        });

        if (updateResult.count !== 1) {
          const err = new Error('This invitation has already been accepted or raced concurrently');
          err.statusCode = 410;
          err.code = 'INVITATION_ALREADY_ACCEPTED';
          throw err;
        }

        const normPhone = normalizePhone(invitation.invitedPhone) || invitation.invitedPhone;
        const normEmail =
          normalizeEmail(invitation.invitedEmail) ||
          invitation.invitedEmail?.trim()?.toLowerCase() ||
          null;

        // Multi-tenant user reuse or creation: lookup by phone or email
        const userByPhone = normPhone
          ? await tx.user.findFirst({ where: { phone: normPhone } })
          : null;
        const userByEmail = normEmail
          ? await tx.user.findFirst({ where: { email: normEmail } })
          : null;

        // Check for ambiguous identity conflict: phone and email point to different existing users
        if (userByPhone && userByEmail && userByPhone.id !== userByEmail.id) {
          console.warn('[AUTH_DIAGNOSTIC] Activation failed: ambiguous_identity_conflict', {
            phoneUserId: userByPhone.id,
            emailUserId: userByEmail.id,
          });
          const conflictErr = new Error(
            'Invitation phone number and email address belong to different existing accounts'
          );
          conflictErr.statusCode = 409;
          conflictErr.code = 'IDENTITY_CONFLICT';
          throw conflictErr;
        }

        let user = userByPhone || userByEmail;

        if (user && user.status !== 'ACTIVE') {
          console.warn('[AUTH_DIAGNOSTIC] Activation failed: user_inactive', { userId: user.id });
          const err = new Error('User account is inactive or suspended');
          err.statusCode = 403;
          err.code = 'USER_INACTIVE';
          throw err;
        }

        // Lookup tenant creation audit to retrieve nominated ownerFullName if available
        const creationAudit = await tx.auditLog.findFirst({
          where: {
            targetTenantId: invitation.tenantId,
            eventType: 'TENANT_CREATED',
          },
          select: { metadata: true },
        });
        const nominatedFullName =
          creationAudit?.metadata?.ownerFullName ||
          invitation.tenant.tradeName ||
          invitation.tenant.legalName;

        if (user) {
          // SEC-AUTH-MULTI: Preserve existing credentials; do NOT overwrite passwordHash or security settings
          user = await tx.user.update({
            where: { id: user.id },
            data: {
              lastLoginAt: now,
              ...(user.fullName ? {} : { fullName: nominatedFullName }),
              ...(user.email ? {} : normEmail ? { email: normEmail } : {}),
              ...(user.phone ? {} : normPhone ? { phone: normPhone } : {}),
            },
          });
        } else {
          user = await tx.user.create({
            data: {
              phone: normPhone,
              email: normEmail,
              fullName: nominatedFullName,
              passwordHash: newPasswordHash,
              status: 'ACTIVE',
              mustChangePassword: false,
              lastLoginAt: now,
            },
          });
        }

        // Upsert STORE_OWNER TenantMembership
        const membership = await tx.tenantMembership.upsert({
          where: {
            tenantId_userId: {
              tenantId: invitation.tenantId,
              userId: user.id,
            },
          },
          create: {
            tenantId: invitation.tenantId,
            userId: user.id,
            role: 'STORE_OWNER',
            status: 'ACTIVE',
          },
          update: {
            role: 'STORE_OWNER',
            status: 'ACTIVE',
          },
          include: {
            tenant: true,
          },
        });

        // Activate Tenant
        const updatedTenant = await tx.tenant.update({
          where: { id: invitation.tenantId },
          data: {
            status: 'ACTIVE',
          },
        });

        // Automatically provision 14-day trial subscription (Decision D-03)
        await provisionTrialSubscription({
          tenantId: invitation.tenantId,
          actorUserId: user.id,
          actorRole: 'STORE_OWNER',
          authorizedTenantId: invitation.tenantId,
          tx,
        });

        // Initialize or preserve OnboardingProgress at Step 1
        await tx.onboardingProgress.upsert({
          where: { tenantId: invitation.tenantId },
          create: {
            tenantId: invitation.tenantId,
            currentStep: 1,
            isCompleted: false,
            stepData: {},
          },
          update: {},
        });

        // AuditLog entry for activation
        await recordAuditEvent({
          tx,
          actorUserId: user.id,
          actorRole: 'STORE_OWNER',
          targetTenantId: invitation.tenantId,
          module: AUDIT_MODULES.AUTH,
          eventType: 'TENANT_ACTIVATED',
          action: 'ACTIVATE_TENANT',
          status: AUDIT_STATUS.SUCCESS,
          resourceType: 'TENANT',
          resourceId: invitation.tenantId,
          metadata: {
            invitationId: invitation.id,
            userId: user.id,
            phone: invitation.invitedPhone ? maskIdentifier(invitation.invitedPhone) : null,
            email: invitation.invitedEmail ? maskIdentifier(invitation.invitedEmail) : null,
          },
          ipAddress: ipAddress || null,
          userAgent: userAgent || null,
        });

        // Create 12h idle / 7d absolute TENANT session
        const sessionToken = generateOpaqueToken(32);
        const sessionTokenHash = hashToken(sessionToken);

        const session = await tx.session.create({
          data: {
            userId: user.id,
            sessionTokenHash,
            sessionType: 'TENANT',
            activeTenantId: invitation.tenantId,
            isSecondFactorPending: false,
            isRecoveryCodeAckPending: false,
            idleExpiresAt: new Date(now.getTime() + STORE_OWNER_IDLE_TIMEOUT_MS),
            absoluteExpiresAt: new Date(now.getTime() + STORE_OWNER_ABSOLUTE_TIMEOUT_MS),
            ipAddress: ipAddress || null,
            userAgent: userAgent || null,
            lastActivityAt: now,
          },
        });

        return {
          sessionToken,
          sessionId: session.id,
          user: sanitizeUser(user),
          activeTenant: {
            id: updatedTenant.id,
            slug: updatedTenant.slug,
            legalName: updatedTenant.legalName,
            tradeName: updatedTenant.tradeName,
            status: updatedTenant.status,
          },
          membership: {
            id: membership.id,
            tenantId: membership.tenantId,
            role: membership.role,
            status: membership.status,
            tenant: {
              id: updatedTenant.id,
              slug: updatedTenant.slug,
              legalName: updatedTenant.legalName,
              tradeName: updatedTenant.tradeName,
              status: updatedTenant.status,
            },
          },
        };
      },
      { maxWait: 10000, timeout: 15000 }
    );
  } catch (err) {
    // Map concurrent race conflicts (deadlocks, serialization errors, timeout wait races) to clean 410 responses
    if (
      err.code === 'P2034' ||
      err.code === 'P2028' ||
      (err.code === 'P2002' &&
        (err.meta?.target?.includes('tenantId_userId') ||
          err.meta?.target?.includes('tokenHash') ||
          err.meta?.target?.includes('phone') ||
          err.meta?.target?.includes('email')))
    ) {
      const conflictErr = new Error(
        'This invitation has already been accepted or raced concurrently'
      );
      conflictErr.statusCode = 410;
      conflictErr.code = 'INVITATION_ALREADY_ACCEPTED';
      throw conflictErr;
    }
    throw err;
  }
}

/**
 * Store Owner credential login.
 * Validates identifier/password, resolves active tenant membership,
 * and creates a 12h idle / 7d absolute TENANT session.
 */
export async function loginOwner({ identifier, password, tenantSlug, ipAddress, userAgent, req }) {
  if (!identifier || typeof identifier !== 'string' || !password || typeof password !== 'string') {
    await recordSecurityRejectionAuditSafe({
      action: AUDIT_ACTIONS.OWNER_LOGIN_FAILED,
      reason: 'MISSING_CREDENTIALS',
      resourceType: 'SESSION',
      metadata: {
        identifier: identifier ? maskIdentifier(identifier) : null,
      },
      ipAddress,
      userAgent,
      req,
    });
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  const { email, phone, rawTrimmed } = normalizeIdentifier(identifier);

  const orConditions = [];
  if (email) orConditions.push({ email });
  if (phone) orConditions.push({ phone });
  if (orConditions.length === 0) {
    orConditions.push({ email: rawTrimmed.toLowerCase() }, { phone: rawTrimmed });
  }

  const candidateUsers = await prisma.user.findMany({
    where: {
      OR: orConditions,
    },
    include: {
      tenantMemberships: {
        include: {
          tenant: true,
        },
      },
      platformAuthorization: true,
    },
  });

  // Diagnostic 1: User not found
  if (candidateUsers.length === 0) {
    console.warn('[AUTH_DIAGNOSTIC] Store Owner login failed: user_not_found', {
      identifier: rawTrimmed.includes('@')
        ? rawTrimmed.toLowerCase()
        : rawTrimmed.replace(/\d(?=\d{4})/g, '*'),
    });
    await verifyPassword(
      'dummy_timing_constant',
      '$2b$12$e8wVdK0tM7L85a1vK9H26u2wVdK0tM7L85a1vK9H26u2wVdK0tM7L'
    );
    await recordSecurityRejectionAuditSafe({
      action: AUDIT_ACTIONS.OWNER_LOGIN_FAILED,
      reason: 'USER_NOT_FOUND',
      resourceType: 'SESSION',
      metadata: {
        identifier: maskIdentifier(identifier),
      },
      ipAddress,
      userAgent,
      req,
    });
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  // Diagnostic 2: Ambiguous identity match (multiple accounts match identifier)
  if (candidateUsers.length > 1) {
    console.warn('[AUTH_DIAGNOSTIC] Store Owner login failed: ambiguous_identity_match', {
      count: candidateUsers.length,
    });
    await verifyPassword(
      'dummy_timing_constant',
      '$2b$12$e8wVdK0tM7L85a1vK9H26u2wVdK0tM7L85a1vK9H26u2wVdK0tM7L'
    );
    await recordSecurityRejectionAuditSafe({
      action: AUDIT_ACTIONS.OWNER_LOGIN_FAILED,
      reason: 'AMBIGUOUS_IDENTITY',
      resourceType: 'SESSION',
      metadata: {
        identifier: maskIdentifier(identifier),
      },
      ipAddress,
      userAgent,
      req,
    });
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  const user = candidateUsers[0];

  // Diagnostic 3: Inactive user or missing passwordHash
  if (!user.passwordHash || user.status !== 'ACTIVE') {
    console.warn('[AUTH_DIAGNOSTIC] Store Owner login failed: inactive_user', {
      userId: user.id,
      status: user.status,
      hasPassword: Boolean(user.passwordHash),
    });
    await verifyPassword(
      'dummy_timing_constant',
      '$2b$12$e8wVdK0tM7L85a1vK9H26u2wVdK0tM7L85a1vK9H26u2wVdK0tM7L'
    );
    await recordSecurityRejectionAuditSafe({
      action: AUDIT_ACTIONS.OWNER_LOGIN_FAILED,
      reason: 'USER_INACTIVE',
      resourceType: 'SESSION',
      metadata: {
        identifier: maskIdentifier(identifier),
      },
      ipAddress,
      userAgent,
      req,
    });
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  // Diagnostic 4: Incorrect password
  const isPasswordValid = await verifyPassword(password, user.passwordHash);
  if (!isPasswordValid) {
    console.warn('[AUTH_DIAGNOSTIC] Store Owner login failed: incorrect_password', {
      userId: user.id,
    });
    await recordSecurityRejectionAuditSafe({
      action: AUDIT_ACTIONS.OWNER_LOGIN_FAILED,
      reason: 'INVALID_CREDENTIALS',
      resourceType: 'SESSION',
      metadata: {
        identifier: maskIdentifier(identifier),
      },
      ipAddress,
      userAgent,
      req,
    });
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  // Filter for active STORE_OWNER memberships
  const activeMemberships = (user.tenantMemberships || []).filter(
    (m) => m.role === 'STORE_OWNER' && m.status === 'ACTIVE'
  );

  // Diagnostic 5: Missing membership
  if (activeMemberships.length === 0) {
    console.warn('[AUTH_DIAGNOSTIC] Store Owner login failed: missing_membership', {
      userId: user.id,
    });
    await recordSecurityRejectionAuditSafe({
      action: AUDIT_ACTIONS.OWNER_LOGIN_FAILED,
      reason: 'MISSING_MEMBERSHIP',
      resourceType: 'SESSION',
      metadata: {
        identifier: maskIdentifier(identifier),
      },
      ipAddress,
      userAgent,
      req,
    });
    const err = new Error('No active store owner memberships found');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  // Filter for non-suspended tenants
  const validMemberships = activeMemberships.filter(
    (m) => m.tenant && m.tenant.status !== 'SUSPENDED'
  );

  // Diagnostic 6: Suspended tenant
  if (validMemberships.length === 0) {
    console.warn('[AUTH_DIAGNOSTIC] Store Owner login failed: suspended_tenant', {
      userId: user.id,
    });
    await recordSecurityRejectionAuditSafe({
      action: AUDIT_ACTIONS.OWNER_LOGIN_FAILED,
      reason: 'TENANT_SUSPENDED',
      resourceType: 'SESSION',
      targetTenantId: activeMemberships[0]?.tenantId || null,
      metadata: {
        identifier: maskIdentifier(identifier),
      },
      ipAddress,
      userAgent,
      req,
    });
    const err = new Error('Store organization is currently suspended');
    err.statusCode = 403;
    err.code = 'TENANT_SUSPENDED';
    throw err;
  }

  // Resolve target tenant
  let targetMembership;
  if (tenantSlug) {
    const normalizedSlug = tenantSlug.trim().toLowerCase();
    targetMembership = validMemberships.find((m) => m.tenant.slug === normalizedSlug);
    // Diagnostic 7: Invalid tenant or access not permitted
    if (!targetMembership) {
      console.warn('[AUTH_DIAGNOSTIC] Store Owner login failed: invalid_tenant', {
        userId: user.id,
        requestedSlug: normalizedSlug,
      });
      await recordSecurityRejectionAuditSafe({
        action: AUDIT_ACTIONS.OWNER_LOGIN_FAILED,
        reason: 'INVALID_TENANT',
        resourceType: 'SESSION',
        metadata: {
          identifier: maskIdentifier(identifier),
          requestedSlug: normalizedSlug,
        },
        ipAddress,
        userAgent,
        req,
      });
      const err = new Error(`You do not have access to store "${tenantSlug}"`);
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }
  } else {
    // Default-tenant selection: first active non-suspended store
    targetMembership = validMemberships[0];
  }

  const now = new Date();
  const sessionToken = generateOpaqueToken(32);
  const sessionTokenHash = hashToken(sessionToken);

  // Atomically persist user update, session state, and audit log in one transaction (ADR-010 Option A)
  const session = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now },
    });

    const createdSession = await tx.session.create({
      data: {
        userId: user.id,
        sessionTokenHash,
        sessionType: 'TENANT',
        activeTenantId: targetMembership.tenant.id,
        isSecondFactorPending: false,
        isRecoveryCodeAckPending: false,
        idleExpiresAt: new Date(now.getTime() + STORE_OWNER_IDLE_TIMEOUT_MS),
        absoluteExpiresAt: new Date(now.getTime() + STORE_OWNER_ABSOLUTE_TIMEOUT_MS),
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        lastActivityAt: now,
      },
    });

    // Record successful Owner credential authentication event atomically
    await recordAuditEvent({
      tx,
      actorUserId: user.id,
      actorRole: 'STORE_OWNER',
      targetTenantId: targetMembership.tenant.id,
      module: AUDIT_MODULES.AUTH,
      eventType: AUDIT_EVENT_TYPES.SECURITY_AUTH,
      action: AUDIT_ACTIONS.OWNER_LOGIN_SUCCESS,
      status: AUDIT_STATUS.SUCCESS,
      resourceType: 'SESSION',
      resourceId: createdSession.id,
      metadata: {
        identifier: maskIdentifier(identifier),
        tenantSlug: targetMembership.tenant.slug,
      },
      ipAddress,
      userAgent,
      req,
    });

    return createdSession;
  });

  return {
    sessionToken,
    sessionId: session.id,
    user: sanitizeUser(user),
    activeTenant: {
      id: targetMembership.tenant.id,
      slug: targetMembership.tenant.slug,
      legalName: targetMembership.tenant.legalName,
      tradeName: targetMembership.tenant.tradeName,
      status: targetMembership.tenant.status,
    },
    tenantMemberships: validMemberships.map((m) => ({
      id: m.id,
      tenantId: m.tenantId,
      role: m.role,
      status: m.status,
      tenant: {
        id: m.tenant.id,
        slug: m.tenant.slug,
        legalName: m.tenant.legalName,
        tradeName: m.tenant.tradeName,
        status: m.tenant.status,
      },
    })),
  };
}
