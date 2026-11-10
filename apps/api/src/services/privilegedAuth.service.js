import { prisma } from '../db/client.js';

/**
 * Transaction-level authorization guard for Class A privileged platform mutations.
 *
 * This helper MUST be called as the first operation inside a Prisma interactive
 * transaction ($transaction) for every privileged platform mutation:
 *   - createTenant
 *   - resendInvitation
 *   - suspendTenant
 *   - reactivateTenant
 *
 * Security invariants enforced:
 *   1. Actor User exists and is ACTIVE.
 *   2. Actor has an ACTIVE PlatformAuthorization with SUPERADMIN role.
 *   3. Actor has an enabled TOTP enrollment (UserTotp.isEnabled === true).
 *   4. Recovery codes have been acknowledged (recoveryCodesAcknowledgedAt IS NOT NULL).
 *   5. A row-level lock (FOR UPDATE) is held on the UserTotp record until the
 *      transaction commits or rolls back, preventing concurrent recovery-code
 *      regeneration from invalidating the acknowledgment state mid-transaction.
 *
 * Concurrency guarantee:
 *   If recovery-code regeneration (which also locks UserTotp FOR UPDATE) wins the
 *   lock first and sets recoveryCodesAcknowledgedAt = NULL, this guard will observe
 *   the pending state and reject. If this guard wins the lock first, regeneration
 *   waits until this transaction completes.
 *
 * This does NOT replace Express middleware guards (requireRecoveryCodeAckComplete,
 * requireSuperadmin, etc.) which provide fast HTTP-layer rejection. This guard
 * provides the concurrency-safe, transactional re-verification under lock.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx - Active Prisma interactive transaction client
 * @param {string} actorUserId - The ID of the acting Superadmin user
 * @returns {Promise<{ userId: string, totpId: string }>} Verified actor identifiers
 * @throws {Error} With statusCode and code properties for HTTP error mapping
 */
export async function assertPrivilegedMutationAuthorized(tx, actorUserId) {
  // ─── Validate input ────────────────────────────────────────────────
  if (!actorUserId || typeof actorUserId !== 'string') {
    const err = new Error('Actor user ID is required for privileged mutations');
    err.statusCode = 403;
    err.code = 'PRIVILEGED_AUTH_MISSING_ACTOR';
    throw err;
  }

  // ─── Step 1: Verify User exists and is ACTIVE ──────────────────────
  // Uses Prisma ORM findUnique (not a raw lock) — the User row is read
  // to verify status. The critical lock is on UserTotp below.
  const user = await tx.user.findUnique({
    where: { id: actorUserId },
    include: {
      platformAuthorization: true,
    },
  });

  if (!user) {
    const err = new Error('Actor user does not exist');
    err.statusCode = 403;
    err.code = 'PRIVILEGED_AUTH_USER_NOT_FOUND';
    throw err;
  }

  if (user.status !== 'ACTIVE') {
    const err = new Error('Actor user account is inactive or suspended');
    err.statusCode = 403;
    err.code = 'PRIVILEGED_AUTH_USER_INACTIVE';
    throw err;
  }

  // ─── Step 2: Verify Superadmin platform authorization ──────────────
  if (
    !user.platformAuthorization ||
    user.platformAuthorization.role !== 'SUPERADMIN' ||
    user.platformAuthorization.status !== 'ACTIVE'
  ) {
    const err = new Error('Active Superadmin platform authorization required');
    err.statusCode = 403;
    err.code = 'PRIVILEGED_AUTH_NOT_SUPERADMIN';
    throw err;
  }

  // ─── Step 3: Acquire FOR UPDATE lock on UserTotp and verify state ──
  // This is the critical concurrency guard. The row lock prevents concurrent
  // recovery-code regeneration from committing while this transaction is active.
  const totpRows = await tx.$queryRaw`
    SELECT "id", "isEnabled", "recoveryCodesAcknowledgedAt"
    FROM "UserTotp"
    WHERE "userId" = ${actorUserId}
    FOR UPDATE
  `;

  const totpRecord = totpRows && totpRows.length > 0 ? totpRows[0] : null;

  if (!totpRecord) {
    const err = new Error('Two-factor authentication enrollment is required for privileged mutations');
    err.statusCode = 403;
    err.code = 'PRIVILEGED_AUTH_MFA_NOT_ENROLLED';
    throw err;
  }

  if (!totpRecord.isEnabled) {
    const err = new Error('Two-factor authentication must be confirmed and enabled');
    err.statusCode = 403;
    err.code = 'PRIVILEGED_AUTH_MFA_NOT_ENABLED';
    throw err;
  }

  // ─── Step 4: Verify recovery-code acknowledgment under lock ────────
  if (totpRecord.recoveryCodesAcknowledgedAt === null) {
    const err = new Error(
      'Recovery codes must be acknowledged before executing privileged platform operations'
    );
    err.statusCode = 403;
    err.code = 'PRIVILEGED_AUTH_RECOVERY_CODES_UNACKNOWLEDGED';
    throw err;
  }

  return {
    userId: user.id,
    totpId: totpRecord.id,
  };
}
