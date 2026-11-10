import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { prisma } from '../src/db/client.js';
import { assertPrivilegedMutationAuthorized } from '../src/services/privilegedAuth.service.js';
import {
  createTenant,
  resendInvitation,
  suspendTenant,
  reactivateTenant,
} from '../src/services/tenant.service.js';
import { hashPassword, hashToken, generateOpaqueToken } from '../src/utils/security.js';
import { withTestAuditCleanup } from './helpers/testAuditCleanup.js';

describe('Module 3.2.2.1: Transaction-Level Superadmin Authorization Implementation', () => {
  const testId = Date.now();
  const validPassword = 'TestSuperAdminPass2026!';

  // Actors for testing
  let authorizedSuperadmin = null;
  let missingTotpSuperadmin = null;
  let unconfirmedTotpSuperadmin = null;
  let unackSuperadmin = null;
  let suspendedSuperadmin = null;
  let nonAdminUser = null;

  // Track created entities for teardown
  const createdUserIds = [];
  const createdTenantIds = [];

  beforeAll(async () => {
    const passwordHash = await hashPassword(validPassword);

    // 1. Authorized Superadmin (ACTIVE, SUPERADMIN role, TOTP enabled, recovery codes acknowledged)
    authorizedSuperadmin = await prisma.user.create({
      data: {
        fullName: 'Authorized Superadmin',
        phone: `+91871${Math.floor(100000 + Math.random() * 900000)}`,
        email: `auth_superadmin_${testId}@billingbuddy.com`,
        passwordHash,
        status: 'ACTIVE',
        platformAuthorization: {
          create: { role: 'SUPERADMIN', status: 'ACTIVE' },
        },
        totp: {
          create: {
            secretEncrypted: 'mock_encrypted_secret',
            isEnabled: true,
            recoveryCodesAcknowledgedAt: new Date(),
          },
        },
      },
    });
    createdUserIds.push(authorizedSuperadmin.id);

    // 2. Superadmin without TOTP enrollment
    missingTotpSuperadmin = await prisma.user.create({
      data: {
        fullName: 'Missing TOTP Superadmin',
        phone: `+91872${Math.floor(100000 + Math.random() * 900000)}`,
        email: `missing_totp_${testId}@billingbuddy.com`,
        passwordHash,
        status: 'ACTIVE',
        platformAuthorization: {
          create: { role: 'SUPERADMIN', status: 'ACTIVE' },
        },
      },
    });
    createdUserIds.push(missingTotpSuperadmin.id);

    // 3. Superadmin with unconfirmed (isEnabled: false) TOTP enrollment
    unconfirmedTotpSuperadmin = await prisma.user.create({
      data: {
        fullName: 'Unconfirmed TOTP Superadmin',
        phone: `+91873${Math.floor(100000 + Math.random() * 900000)}`,
        email: `unconfirmed_totp_${testId}@billingbuddy.com`,
        passwordHash,
        status: 'ACTIVE',
        platformAuthorization: {
          create: { role: 'SUPERADMIN', status: 'ACTIVE' },
        },
        totp: {
          create: {
            secretEncrypted: 'mock_encrypted_secret',
            isEnabled: false,
            recoveryCodesAcknowledgedAt: null,
          },
        },
      },
    });
    createdUserIds.push(unconfirmedTotpSuperadmin.id);

    // 4. Superadmin with TOTP enabled but recovery codes unacknowledged (recoveryCodesAcknowledgedAt: null)
    unackSuperadmin = await prisma.user.create({
      data: {
        fullName: 'Unacknowledged Superadmin',
        phone: `+91874${Math.floor(100000 + Math.random() * 900000)}`,
        email: `unack_superadmin_${testId}@billingbuddy.com`,
        passwordHash,
        status: 'ACTIVE',
        platformAuthorization: {
          create: { role: 'SUPERADMIN', status: 'ACTIVE' },
        },
        totp: {
          create: {
            secretEncrypted: 'mock_encrypted_secret',
            isEnabled: true,
            recoveryCodesAcknowledgedAt: null,
          },
        },
      },
    });
    createdUserIds.push(unackSuperadmin.id);

    // 5. Suspended Superadmin
    suspendedSuperadmin = await prisma.user.create({
      data: {
        fullName: 'Suspended Superadmin',
        phone: `+91875${Math.floor(100000 + Math.random() * 900000)}`,
        email: `suspended_superadmin_${testId}@billingbuddy.com`,
        passwordHash,
        status: 'SUSPENDED',
        platformAuthorization: {
          create: { role: 'SUPERADMIN', status: 'ACTIVE' },
        },
        totp: {
          create: {
            secretEncrypted: 'mock_encrypted_secret',
            isEnabled: true,
            recoveryCodesAcknowledgedAt: new Date(),
          },
        },
      },
    });
    createdUserIds.push(suspendedSuperadmin.id);

    // 6. Regular user (no platform authorization)
    nonAdminUser = await prisma.user.create({
      data: {
        fullName: 'Non-Admin User',
        phone: `+91876${Math.floor(100000 + Math.random() * 900000)}`,
        email: `non_admin_${testId}@billingbuddy.com`,
        passwordHash,
        status: 'ACTIVE',
      },
    });
    createdUserIds.push(nonAdminUser.id);
  });

  afterAll(async () => {
    await withTestAuditCleanup(async () => {
      // Clean up created tenants
      for (const tenantId of createdTenantIds) {
        try {
          await prisma.auditLog.deleteMany({ where: { targetTenantId: tenantId } });
          await prisma.tenant.delete({ where: { id: tenantId } });
        } catch {
          // Ignored
        }
      }

      // Clean up created users
      for (const userId of createdUserIds) {
        try {
          await prisma.auditLog.deleteMany({ where: { actorUserId: userId } });
          await prisma.user.delete({ where: { id: userId } });
        } catch {
          // Ignored
        }
      }
    });
  });

  // =========================================================================
  // Requirement 1: Active Superadmin with acknowledged recovery codes succeeds
  // =========================================================================
  describe('Requirement 1: Authorization Helper Positive Path', () => {
    it('succeeds for an active Superadmin with enabled TOTP and acknowledged recovery codes', async () => {
      const result = await prisma.$transaction(async (tx) => {
        return await assertPrivilegedMutationAuthorized(tx, authorizedSuperadmin.id);
      });

      expect(result).toBeDefined();
      expect(result.userId).toBe(authorizedSuperadmin.id);
      expect(result.totpId).toBeDefined();
    });
  });

  // =========================================================================
  // Requirements 2-5: Rejection Cases
  // =========================================================================
  describe('Requirements 2-5: Rejection Guards under Transaction Lock', () => {
    it('Requirement 2: rejects missing or invalid actorUserId with 403 PRIVILEGED_AUTH_MISSING_ACTOR', async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          return await assertPrivilegedMutationAuthorized(tx, null);
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'PRIVILEGED_AUTH_MISSING_ACTOR',
      });

      await expect(
        prisma.$transaction(async (tx) => {
          return await assertPrivilegedMutationAuthorized(tx, '');
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'PRIVILEGED_AUTH_MISSING_ACTOR',
      });
    });

    it('Requirement 2b: rejects non-existent User with 403 PRIVILEGED_AUTH_USER_NOT_FOUND', async () => {
      const nonExistentId = crypto.randomUUID();
      await expect(
        prisma.$transaction(async (tx) => {
          return await assertPrivilegedMutationAuthorized(tx, nonExistentId);
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'PRIVILEGED_AUTH_USER_NOT_FOUND',
      });
    });

    it('Requirement 3: rejects suspended User with 403 PRIVILEGED_AUTH_USER_INACTIVE', async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          return await assertPrivilegedMutationAuthorized(tx, suspendedSuperadmin.id);
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'PRIVILEGED_AUTH_USER_INACTIVE',
      });
    });

    it('Requirement 3b: rejects user without Superadmin authorization with 403 PRIVILEGED_AUTH_NOT_SUPERADMIN', async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          return await assertPrivilegedMutationAuthorized(tx, nonAdminUser.id);
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'PRIVILEGED_AUTH_NOT_SUPERADMIN',
      });
    });

    it('Requirement 4: rejects missing UserTotp enrollment with 403 PRIVILEGED_AUTH_MFA_NOT_ENROLLED', async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          return await assertPrivilegedMutationAuthorized(tx, missingTotpSuperadmin.id);
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'PRIVILEGED_AUTH_MFA_NOT_ENROLLED',
      });
    });

    it('Requirement 4b: rejects unconfirmed TOTP (isEnabled: false) with 403 PRIVILEGED_AUTH_MFA_NOT_ENABLED', async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          return await assertPrivilegedMutationAuthorized(tx, unconfirmedTotpSuperadmin.id);
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'PRIVILEGED_AUTH_MFA_NOT_ENABLED',
      });
    });

    it('Requirement 5: rejects null recoveryCodesAcknowledgedAt with 403 PRIVILEGED_AUTH_RECOVERY_CODES_UNACKNOWLEDGED', async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          return await assertPrivilegedMutationAuthorized(tx, unackSuperadmin.id);
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'PRIVILEGED_AUTH_RECOVERY_CODES_UNACKNOWLEDGED',
      });
    });
  });

  // =========================================================================
  // Requirements 6-7: Concurrency & Lock-Order Verification
  // =========================================================================
  describe('Requirements 6-7: Concurrency & Mutex Behavior on UserTotp Lock', () => {
    it('Requirement 6: when regeneration wins the lock first and sets ack to NULL, the subsequent privileged mutation rejects', async () => {
      // Create a dedicated user for this race test
      const raceUser = await prisma.user.create({
        data: {
          fullName: 'Race User 1',
          phone: `+91877${Math.floor(100000 + Math.random() * 900000)}`,
          email: `race_user_1_${testId}@billingbuddy.com`,
          passwordHash: await hashPassword(validPassword),
          status: 'ACTIVE',
          platformAuthorization: {
            create: { role: 'SUPERADMIN', status: 'ACTIVE' },
          },
          totp: {
            create: {
              secretEncrypted: 'mock_encrypted_secret',
              isEnabled: true,
              recoveryCodesAcknowledgedAt: new Date(),
            },
          },
        },
      });
      createdUserIds.push(raceUser.id);

      // Coordination signals
      let regenAcquiredLockResolve;
      const regenAcquiredLockPromise = new Promise((res) => {
        regenAcquiredLockResolve = res;
      });

      let mutationCanProceedResolve;
      const mutationCanProceedPromise = new Promise((res) => {
        mutationCanProceedResolve = res;
      });

      // Transaction 1: Regeneration (simulated: locks UserTotp, resets ack to NULL, then commits)
      const regenTxPromise = prisma.$transaction(async (tx1) => {
        // 1. Lock UserTotp row
        await tx1.$queryRaw`
          SELECT "id" FROM "UserTotp" WHERE "userId" = ${raceUser.id} FOR UPDATE
        `;

        // Signal that Tx1 has acquired the lock
        regenAcquiredLockResolve();

        // Wait for Tx2 to attempt lock acquisition
        await mutationCanProceedPromise;

        // Invalidate acknowledgment (as recovery-code regeneration does)
        await tx1.userTotp.update({
          where: { userId: raceUser.id },
          data: { recoveryCodesAcknowledgedAt: null },
        });

        return 'REGEN_COMMITTED';
      });

      // Wait until Tx1 holds the lock
      await regenAcquiredLockPromise;

      // Transaction 2: Privileged mutation starts while Tx1 holds the lock
      let mutationError = null;
      const mutationTxPromise = (async () => {
        try {
          return await prisma.$transaction(async (tx2) => {
            // This will block in PostgreSQL until Tx1 commits
            return await assertPrivilegedMutationAuthorized(tx2, raceUser.id);
          });
        } catch (err) {
          mutationError = err;
          throw err;
        }
      })();

      // Give Tx2 a moment to enter the database and queue behind Tx1's lock
      await new Promise((r) => setTimeout(r, 50));

      // Now allow Tx1 to complete its mutation and commit
      mutationCanProceedResolve();

      // Wait for Tx1 to commit
      const regenResult = await regenTxPromise;
      expect(regenResult).toBe('REGEN_COMMITTED');

      // Now Tx2 unblocks, observes recoveryCodesAcknowledgedAt === null, and must reject
      await expect(mutationTxPromise).rejects.toMatchObject({
        statusCode: 403,
        code: 'PRIVILEGED_AUTH_RECOVERY_CODES_UNACKNOWLEDGED',
      });
      expect(mutationError).toBeDefined();
    });

    it('Requirement 7: when privileged mutation wins the lock first, regeneration waits until completion', async () => {
      // Create a dedicated user for this race test
      const raceUser = await prisma.user.create({
        data: {
          fullName: 'Race User 2',
          phone: `+91878${Math.floor(100000 + Math.random() * 900000)}`,
          email: `race_user_2_${testId}@billingbuddy.com`,
          passwordHash: await hashPassword(validPassword),
          status: 'ACTIVE',
          platformAuthorization: {
            create: { role: 'SUPERADMIN', status: 'ACTIVE' },
          },
          totp: {
            create: {
              secretEncrypted: 'mock_encrypted_secret',
              isEnabled: true,
              recoveryCodesAcknowledgedAt: new Date(),
            },
          },
        },
      });
      createdUserIds.push(raceUser.id);

      let mutationAcquiredLockResolve;
      const mutationAcquiredLockPromise = new Promise((res) => {
        mutationAcquiredLockResolve = res;
      });

      let mutationCanCommitResolve;
      const mutationCanCommitPromise = new Promise((res) => {
        mutationCanCommitResolve = res;
      });

      let mutationFinished = false;
      let regenObservedLockWait = false;

      // Transaction 1: Privileged mutation (acquires lock via assertPrivilegedMutationAuthorized)
      const mutationTxPromise = prisma.$transaction(async (tx1) => {
        const auth = await assertPrivilegedMutationAuthorized(tx1, raceUser.id);
        expect(auth.userId).toBe(raceUser.id);

        mutationAcquiredLockResolve();

        // Hold the lock for a controlled period
        await mutationCanCommitPromise;

        mutationFinished = true;
        return 'MUTATION_COMMITTED';
      });

      // Wait until Tx1 holds the UserTotp lock
      await mutationAcquiredLockPromise;

      // Transaction 2: Regeneration attempts to lock UserTotp
      const regenTxPromise = (async () => {
        return await prisma.$transaction(async (tx2) => {
          // This must block until Tx1 finishes
          const [row] = await tx2.$queryRaw`
            SELECT "id", "recoveryCodesAcknowledgedAt"
            FROM "UserTotp"
            WHERE "userId" = ${raceUser.id}
            FOR UPDATE
          `;
          // If Tx1 is still holding the lock, mutationFinished would be false
          // When Tx2 reaches here, Tx1 MUST have already committed
          regenObservedLockWait = mutationFinished;
          return row;
        });
      })();

      // Give Tx2 time to block on the row lock
      await new Promise((r) => setTimeout(r, 60));

      // Now release Tx1 so it commits
      mutationCanCommitResolve();

      const [mutationResult, regenResult] = await Promise.all([
        mutationTxPromise,
        regenTxPromise,
      ]);

      expect(mutationResult).toBe('MUTATION_COMMITTED');
      expect(regenResult).toBeDefined();
      expect(regenObservedLockWait).toBe(true);
    });
  });

  // =========================================================================
  // Requirement 8: All four Class A operations reject an unauthorized actor
  // =========================================================================
  describe('Requirement 8: Rejection Across All Four Class A Operations', () => {
    it('createTenant rejects unacknowledged actor with 403 PRIVILEGED_AUTH_RECOVERY_CODES_UNACKNOWLEDGED', async () => {
      const slug = `unack-create-${testId}`;
      await expect(
        createTenant({
          legalName: 'Unauthorized Create Store Ltd',
          slug,
          ownerFullName: 'Test Owner',
          ownerPhone: '+919999900001',
          ownerEmail: 'unack_create@example.com',
          actorUserId: unackSuperadmin.id,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'PRIVILEGED_AUTH_RECOVERY_CODES_UNACKNOWLEDGED',
      });

      // Verify no Tenant was created
      const tenant = await prisma.tenant.findUnique({ where: { slug } });
      expect(tenant).toBeNull();
    });

    it('resendInvitation rejects unacknowledged actor with 403 PRIVILEGED_AUTH_RECOVERY_CODES_UNACKNOWLEDGED', async () => {
      // First create a tenant with authorized superadmin
      const tenant = await createTenant({
        legalName: 'Resend Test Tenant Ltd',
        slug: `resend-test-${testId}`,
        ownerFullName: 'Resend Owner',
        ownerPhone: '+919999900002',
        ownerEmail: 'resend_owner@example.com',
        actorUserId: authorizedSuperadmin.id,
      });
      createdTenantIds.push(tenant.tenant.id);

      // Attempt to resend with unacknowledged actor
      await expect(
        resendInvitation({
          tenantId: tenant.tenant.id,
          actorUserId: unackSuperadmin.id,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'PRIVILEGED_AUTH_RECOVERY_CODES_UNACKNOWLEDGED',
      });
    });

    it('suspendTenant rejects unacknowledged actor with 403 PRIVILEGED_AUTH_RECOVERY_CODES_UNACKNOWLEDGED', async () => {
      // Create an ACTIVE tenant
      const tenant = await prisma.tenant.create({
        data: {
          legalName: 'Suspend Test Tenant Ltd',
          slug: `suspend-test-${testId}`,
          status: 'ACTIVE',
        },
      });
      createdTenantIds.push(tenant.id);

      await expect(
        suspendTenant({
          tenantId: tenant.id,
          reason: 'Test suspension',
          actorUserId: unackSuperadmin.id,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'PRIVILEGED_AUTH_RECOVERY_CODES_UNACKNOWLEDGED',
      });

      // Verify status is still ACTIVE
      const dbTenant = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      expect(dbTenant.status).toBe('ACTIVE');
    });

    it('reactivateTenant rejects unacknowledged actor with 403 PRIVILEGED_AUTH_RECOVERY_CODES_UNACKNOWLEDGED', async () => {
      // Create a SUSPENDED tenant
      const tenant = await prisma.tenant.create({
        data: {
          legalName: 'Reactivate Test Tenant Ltd',
          slug: `reactivate-test-${testId}`,
          status: 'SUSPENDED',
        },
      });
      createdTenantIds.push(tenant.id);

      await expect(
        reactivateTenant({
          tenantId: tenant.id,
          reason: 'Test reactivation',
          actorUserId: unackSuperadmin.id,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'PRIVILEGED_AUTH_RECOVERY_CODES_UNACKNOWLEDGED',
      });

      // Verify status is still SUSPENDED
      const dbTenant = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      expect(dbTenant.status).toBe('SUSPENDED');
    });
  });

  // =========================================================================
  // Requirement 9: All four Class A operations succeed for authorized actor
  // =========================================================================
  describe('Requirement 9: Success Across All Four Class A Operations', () => {
    let operationTenantId = null;

    it('1. createTenant succeeds with authorized actor and commits all records', async () => {
      const slug = `op-create-${testId}`;
      const result = await createTenant({
        legalName: 'Operations Tenant Ltd',
        tradeName: 'Operations Mart',
        slug,
        ownerFullName: 'Operations Owner',
        ownerPhone: '+919999900010',
        ownerEmail: 'operations_owner@example.com',
        actorUserId: authorizedSuperadmin.id,
      });

      expect(result).toBeDefined();
      expect(result.tenant.slug).toBe(slug);
      expect(result.tenant.status).toBe('INVITED');
      expect(result.invitation.status).toBe('INVITED_PENDING_ACCEPTANCE');

      operationTenantId = result.tenant.id;
      createdTenantIds.push(operationTenantId);

      // Verify audit record was created
      const audit = await prisma.auditLog.findFirst({
        where: { targetTenantId: operationTenantId, action: 'CREATE_TENANT' },
      });
      expect(audit).not.toBeNull();
      expect(audit.actorUserId).toBe(authorizedSuperadmin.id);
    });

    it('2. resendInvitation succeeds with authorized actor and supersedes prior invitation', async () => {
      const result = await resendInvitation({
        tenantId: operationTenantId,
        actorUserId: authorizedSuperadmin.id,
      });

      expect(result).toBeDefined();
      expect(result.invitation.status).toBe('INVITED_PENDING_ACCEPTANCE');

      // Verify prior invitation is superseded
      const supersededInv = await prisma.ownerInvitation.findFirst({
        where: { tenantId: operationTenantId, status: 'SUPERSEDED' },
      });
      expect(supersededInv).not.toBeNull();
    });

    it('3. suspendTenant succeeds with authorized actor and transitions status', async () => {
      // Must be ACTIVE first
      await prisma.tenant.update({
        where: { id: operationTenantId },
        data: { status: 'ACTIVE' },
      });

      const result = await suspendTenant({
        tenantId: operationTenantId,
        reason: 'Authorized compliance audit',
        actorUserId: authorizedSuperadmin.id,
      });

      expect(result).toBeDefined();
      expect(result.status).toBe('SUSPENDED');

      const dbTenant = await prisma.tenant.findUnique({ where: { id: operationTenantId } });
      expect(dbTenant.status).toBe('SUSPENDED');
    });

    it('4. reactivateTenant succeeds with authorized actor and transitions status', async () => {
      const result = await reactivateTenant({
        tenantId: operationTenantId,
        reason: 'Compliance audit cleared',
        actorUserId: authorizedSuperadmin.id,
      });

      expect(result).toBeDefined();
      expect(result.status).toBe('ACTIVE');

      const dbTenant = await prisma.tenant.findUnique({ where: { id: operationTenantId } });
      expect(dbTenant.status).toBe('ACTIVE');
    });
  });

  // =========================================================================
  // Requirement 10: Business mutation failure rolls back all transactional changes
  // =========================================================================
  describe('Requirement 10: Atomic Rollback on Business Mutation Failure', () => {
    it('rolls back completely when business state transition fails inside transaction', async () => {
      // Create a tenant in INVITED state
      const tenant = await prisma.tenant.create({
        data: {
          legalName: 'Rollback Test Tenant',
          slug: `rollback-test-${testId}`,
          status: 'INVITED', // cannot suspend an INVITED tenant
        },
      });
      createdTenantIds.push(tenant.id);

      // Attempt suspend on INVITED tenant with authorized actor
      // The authorization check will PASS, but business logic will throw INVALID_STATE_TRANSITION
      await expect(
        suspendTenant({
          tenantId: tenant.id,
          reason: 'Premature suspend',
          actorUserId: authorizedSuperadmin.id,
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_STATE_TRANSITION',
      });

      // Verify that NO audit log was persisted (rolled back)
      const audit = await prisma.auditLog.findFirst({
        where: { targetTenantId: tenant.id, action: 'TENANT_SUSPENDED' },
      });
      expect(audit).toBeNull();

      // Verify tenant status is still INVITED
      const dbTenant = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      expect(dbTenant.status).toBe('INVITED');
    });
  });
});
