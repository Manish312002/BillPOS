import { prisma } from '../db/client.js';
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

// Superadmin session lifetime constants (ADR-002)
const SUPERADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes idle timeout
const SUPERADMIN_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours absolute lifetime
const TOTP_MAX_FAILED_ATTEMPTS = 5;

/**
 * Transactionally revokes an old pending session and creates a new fully authenticated session.
 * Enforces SEC-AUTH-01 (Session rotation on privilege escalation).
 */
async function rotateSessionToFullyAuthenticated(tx, oldSessionId, userId, ipAddress, userAgent) {
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
      idleExpiresAt: new Date(now.getTime() + SUPERADMIN_IDLE_TIMEOUT_MS),
      absoluteExpiresAt: new Date(now.getTime() + SUPERADMIN_ABSOLUTE_TIMEOUT_MS),
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      lastActivityAt: now,
    },
  });

  return {
    newSessionToken,
    newSessionId: newSession.id,
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
export async function loginSuperadmin({ identifier, password, ipAddress, userAgent }) {
  if (!identifier || typeof identifier !== 'string' || !password || typeof password !== 'string') {
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  const cleanIdentifier = identifier.trim();
  const normalizedEmail = cleanIdentifier.toLowerCase();

  // Find user by phone or email
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: normalizedEmail }, { phone: cleanIdentifier }],
    },
    include: {
      platformAuthorization: true,
      totp: true,
    },
  });

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
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  const isPasswordValid = await verifyPassword(password, user.passwordHash);
  if (!isPasswordValid) {
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  const isTotpEnabled = Boolean(user.totp && user.totp.isEnabled);
  const requiresTotpEnrollment = !isTotpEnabled;

  // Check if account is temporarily locked due to excessive failed attempts
  if (user.totp && user.totp.lockedUntil && user.totp.lockedUntil > new Date()) {
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

  // ADR-002: Second factor is pending until confirmed/verified
  const session = await prisma.session.create({
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

    // SEC-AUTH-01: Session rotation on privilege elevation
    rotatedSession = await rotateSessionToFullyAuthenticated(
      tx,
      sessionId,
      userId,
      ipAddress,
      userAgent
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
    rotatedSession = await rotateSessionToFullyAuthenticated(
      tx,
      sessionId,
      userId,
      ipAddress,
      userAgent
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
    rotatedSession = await rotateSessionToFullyAuthenticated(
      tx,
      sessionId,
      userId,
      ipAddress,
      userAgent
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

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
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
  };
}

/**
 * Revokes a session upon logout.
 */
export async function logout({ sessionId }) {
  if (!sessionId) return;
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
