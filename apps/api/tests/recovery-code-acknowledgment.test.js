import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { hashPassword } from '../src/utils/security.js';
import { computeTotpCode, decryptTotpSecret } from '../src/utils/totp.js';
import { withTestAuditCleanup } from './helpers/testCleanup.js';

describe('Server-Enforced Recovery-Code Acknowledgment & Regeneration (BB-WP02)', () => {
  const testId = Date.now();
  const superadminPhone = `+91848${Math.floor(100000 + Math.random() * 900000)}`;
  const superadminEmail = `superadmin_ack_${testId}@billingbuddy.com`;
  const initialPassword = 'SuperAdmin@InitialPass2026!';

  let superadminUser = null;
  let nonAdminUser = null;

  function extractSessionCookie(res) {
    const cookieHeader = res.headers['set-cookie'];
    if (!cookieHeader) return null;
    const cookies = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader];
    for (const cookie of cookies) {
      const match = cookie.match(/bb_session=([^;]+)/);
      if (match) return decodeURIComponent(match[1]);
    }
    return null;
  }

  beforeAll(async () => {
    const initialHash = await hashPassword(initialPassword);

    // 1. Create a platform Superadmin user
    superadminUser = await prisma.user.create({
      data: {
        fullName: 'Test Superadmin Ack Auditor',
        phone: superadminPhone,
        email: superadminEmail,
        passwordHash: initialHash,
        status: 'ACTIVE',
        mustChangePassword: false, // Set to false to isolate recovery ack tests from password-change checks
        platformAuthorization: {
          create: {
            role: 'SUPERADMIN',
            status: 'ACTIVE',
          },
        },
      },
      include: { platformAuthorization: true },
    });

    // 2. Create a normal user without platform authorization
    nonAdminUser = await prisma.user.create({
      data: {
        fullName: 'Regular Non-Admin User',
        phone: `+91748${Math.floor(100000 + Math.random() * 900000)}`,
        email: `regular_ack_${testId}@example.com`,
        passwordHash: initialHash,
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    // Cleanup created test users
    await withTestAuditCleanup(async () => {
      const userIds = [superadminUser?.id, nonAdminUser?.id].filter(Boolean);
      if (userIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
    });
  });

  describe('Lifecycle: Enrollment Confirmation to Acknowledgment', () => {
    let pendingLoginToken = null;
    let enrolledSessionToken = null;
    let initialRecoveryCodes = [];

    it('1. Credentials login succeeds and prompts for TOTP enrollment', async () => {
      const res = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: superadminEmail, password: initialPassword });

      expect(res.status).toBe(200);
      expect(res.body.data.requiresTotpEnrollment).toBe(true);
      pendingLoginToken = extractSessionCookie(res);
      expect(pendingLoginToken).toBeTruthy();
    });

    it('2. Initiates TOTP enrollment', async () => {
      const res = await request(app)
        .post('/api/auth/superadmin/totp/enroll')
        .set('Authorization', `Bearer ${pendingLoginToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.secret).toBeTruthy();
    });

    it('3. TOTP confirmation creates pending acknowledgment state & reveals recovery codes', async () => {
      const totpRecord = await prisma.userTotp.findUnique({
        where: { userId: superadminUser.id },
      });
      const rawSecret = decryptTotpSecret(totpRecord.secretEncrypted);
      const validCode = computeTotpCode(rawSecret);

      const res = await request(app)
        .post('/api/auth/superadmin/totp/confirm')
        .set('Authorization', `Bearer ${pendingLoginToken}`)
        .send({ code: validCode });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isRecoveryCodeAckPending).toBe(true);
      expect(res.body.data.recoveryCodes).toHaveLength(8);

      initialRecoveryCodes = res.body.data.recoveryCodes;
      enrolledSessionToken = extractSessionCookie(res);
      expect(enrolledSessionToken).toBeTruthy();

      // Verify in DB directly
      const sessionInDb = await prisma.session.findFirst({
        where: { userId: superadminUser.id, revokedAt: null },
      });
      expect(sessionInDb.isRecoveryCodeAckPending).toBe(true);
    });

    it('4. Session remains restricted after TOTP confirmation', async () => {
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${enrolledSessionToken}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.data.session.isRecoveryCodeAckPending).toBe(true);
    });

    it('5. /api/platform/tenants returns 403 while acknowledgment is pending', async () => {
      const res = await request(app)
        .get('/api/platform/tenants')
        .set('Authorization', `Bearer ${enrolledSessionToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('RECOVERY_CODE_ACK_REQUIRED');
      expect(res.body.message).toMatch(/Recovery-code acknowledgment is required/i);
    });

    it('6. Privileged dashboard access is blocked while acknowledgment is pending', async () => {
      const res = await request(app)
        .get('/api/auth/superadmin/dashboard-access')
        .set('Authorization', `Bearer ${enrolledSessionToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('RECOVERY_CODE_ACK_REQUIRED');
    });

    it('7. Direct API access cannot bypass acknowledgment', async () => {
      const postTenantRes = await request(app)
        .post('/api/platform/tenants')
        .set('Authorization', `Bearer ${enrolledSessionToken}`)
        .send({
          legalName: 'Bypass Attempt Org',
          tradeName: 'Bypass Inc',
          ownerPhone: '+919999999999',
          ownerEmail: 'bypass@example.com',
          ownerFullName: 'Bypass Owner',
        });

      expect(postTenantRes.status).toBe(403);
      expect(postTenantRes.body.code).toBe('RECOVERY_CODE_ACK_REQUIRED');
    });

    it('8. Acknowledgment endpoint rejects unauthenticated requests', async () => {
      const res = await request(app).post('/api/auth/superadmin/recovery-codes/acknowledge');

      expect(res.status).toBe(401);
    });

    it('9. Acknowledgment endpoint rejects wrong role (non-admin user)', async () => {
      // Create session for non-admin
      const { hashToken, generateOpaqueToken } = await import('../src/utils/security.js');
      const token = generateOpaqueToken(32);
      await prisma.session.create({
        data: {
          userId: nonAdminUser.id,
          sessionTokenHash: hashToken(token),
          sessionType: 'TENANT',
          isSecondFactorPending: false,
          isRecoveryCodeAckPending: true,
          idleExpiresAt: new Date(Date.now() + 100000),
          absoluteExpiresAt: new Date(Date.now() + 100000),
        },
      });

      const res = await request(app)
        .post('/api/auth/superadmin/recovery-codes/acknowledge')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('10. Regeneration while acknowledgment is pending returns new codes and invalidates old hashes', async () => {
      const regenRes = await request(app)
        .post('/api/auth/superadmin/recovery-codes/regenerate')
        .set('Authorization', `Bearer ${enrolledSessionToken}`)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(regenRes.status).toBe(200);
      expect(regenRes.body.success).toBe(true);
      expect(regenRes.body.data.recoveryCodes).toHaveLength(8);

      const regeneratedCodes = regenRes.body.data.recoveryCodes;
      expect(regeneratedCodes).not.toEqual(initialRecoveryCodes);

      // Verify that old initial codes are invalidated and CANNOT be redeemed
      const invalidOldCodeAttempt = await request(app)
        .post('/api/auth/superadmin/totp/recovery')
        .set('Authorization', `Bearer ${enrolledSessionToken}`)
        .send({ recoveryCode: initialRecoveryCodes[0] });

      expect(invalidOldCodeAttempt.status).toBe(401);
      expect(invalidOldCodeAttempt.body.message).toMatch(/Invalid recovery code/i);

      // Verify session is still pending acknowledgment
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${enrolledSessionToken}`);
      expect(meRes.body.data.session.isRecoveryCodeAckPending).toBe(true);
    });

    it('11. Valid acknowledgment completes state transition on server and records timestamp', async () => {
      const ackRes = await request(app)
        .post('/api/auth/superadmin/recovery-codes/acknowledge')
        .set('Authorization', `Bearer ${enrolledSessionToken}`)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(ackRes.status).toBe(200);
      expect(ackRes.body.success).toBe(true);
      expect(ackRes.body.data.acknowledged).toBe(true);
      expect(ackRes.body.data.acknowledgedAt).toBeTruthy();

      // Check DB records
      const sessionInDb = await prisma.session.findFirst({
        where: { userId: superadminUser.id, revokedAt: null },
      });
      expect(sessionInDb.isRecoveryCodeAckPending).toBe(false);

      const totpInDb = await prisma.userTotp.findUnique({
        where: { userId: superadminUser.id },
      });
      expect(totpInDb.recoveryCodesAcknowledgedAt).not.toBeNull();
    });

    it('12. Repeated acknowledgment is safely rejected (ACK_NOT_PENDING)', async () => {
      const secondAckRes = await request(app)
        .post('/api/auth/superadmin/recovery-codes/acknowledge')
        .set('Authorization', `Bearer ${enrolledSessionToken}`)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(secondAckRes.status).toBe(400);
      expect(secondAckRes.body.code).toBe('ACK_NOT_PENDING');
    });

    it('13. Regeneration is rejected after acknowledgment is already complete', async () => {
      const regenAttempt = await request(app)
        .post('/api/auth/superadmin/recovery-codes/regenerate')
        .set('Authorization', `Bearer ${enrolledSessionToken}`)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(regenAttempt.status).toBe(403);
      expect(regenAttempt.body.code).toBe('FORBIDDEN');
    });

    it('14. Platform access succeeds after acknowledgment', async () => {
      const platformRes = await request(app)
        .get('/api/platform/tenants')
        .set('Authorization', `Bearer ${enrolledSessionToken}`);

      expect(platformRes.status).toBe(200);
      expect(platformRes.body.success).toBe(true);
    });

    it('15. Refresh/session restoration (GET /api/auth/me) reflects acknowledged state', async () => {
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${enrolledSessionToken}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.data.session.isRecoveryCodeAckPending).toBe(false);
    });

    it('16. Logout revokes the session server-side', async () => {
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${enrolledSessionToken}`)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(logoutRes.status).toBe(200);

      // Subsequent call to /api/platform/tenants is rejected with 401
      const checkRes = await request(app)
        .get('/api/platform/tenants')
        .set('Authorization', `Bearer ${enrolledSessionToken}`);

      expect(checkRes.status).toBe(401);
    });
  });

  describe('Concurrency & Race Condition Defenses', () => {
    let raceSessionToken = null;
    let raceUser = null;

    beforeAll(async () => {
      const initialHash = await hashPassword(initialPassword);
      raceUser = await prisma.user.create({
        data: {
          fullName: 'Race Test User',
          phone: `+91855${Math.floor(100000 + Math.random() * 900000)}`,
          email: `race_user_${testId}@billingbuddy.com`,
          passwordHash: initialHash,
          status: 'ACTIVE',
          mustChangePassword: false,
          platformAuthorization: {
            create: { role: 'SUPERADMIN', status: 'ACTIVE' },
          },
          totp: {
            create: {
              secretEncrypted: 'mock_encrypted_secret',
              isEnabled: true,
              recoveryCodeHashes: ['hash1', 'hash2'],
              recoveryCodesAcknowledgedAt: null,
            },
          },
        },
      });

      const { hashToken, generateOpaqueToken } = await import('../src/utils/security.js');
      const token = generateOpaqueToken(32);
      await prisma.session.create({
        data: {
          userId: raceUser.id,
          sessionTokenHash: hashToken(token),
          sessionType: 'PLATFORM',
          isSecondFactorPending: false,
          isRecoveryCodeAckPending: true,
          idleExpiresAt: new Date(Date.now() + 100000),
          absoluteExpiresAt: new Date(Date.now() + 100000),
        },
      });
      raceSessionToken = token;
    });

    afterAll(async () => {
      if (raceUser) {
        await withTestAuditCleanup(async () => {
          await prisma.auditLog.deleteMany({ where: { actorUserId: raceUser.id } });
          await prisma.user.deleteMany({ where: { id: raceUser.id } });
        });
      }
    });

    it('17. Concurrent acknowledgment requests: exactly one succeeds and second is rejected cleanly', async () => {
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/auth/superadmin/recovery-codes/acknowledge')
          .set('Authorization', `Bearer ${raceSessionToken}`)
          .set('X-Requested-With', 'XMLHttpRequest'),
        request(app)
          .post('/api/auth/superadmin/recovery-codes/acknowledge')
          .set('Authorization', `Bearer ${raceSessionToken}`)
          .set('X-Requested-With', 'XMLHttpRequest'),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 400]);
    });
  });

  describe('Recovery-Code Login Consistency & Authorization Coverage', () => {
    let unacknowledgedUser = null;
    let pendingLoginToken = null;
    let postRecoverySessionToken = null;
    let validRecoveryCode = null;

    beforeAll(async () => {
      const initialHash = await hashPassword(initialPassword);
      const { generateRecoveryCodes, hashRecoveryCode } = await import('../src/utils/totp.js');
      const codes = generateRecoveryCodes(4);
      validRecoveryCode = codes[0];

      unacknowledgedUser = await prisma.user.create({
        data: {
          fullName: 'Unacknowledged Recovery User',
          phone: `+91866${Math.floor(100000 + Math.random() * 900000)}`,
          email: `unack_recovery_${testId}@billingbuddy.com`,
          passwordHash: initialHash,
          status: 'ACTIVE',
          mustChangePassword: false,
          platformAuthorization: {
            create: { role: 'SUPERADMIN', status: 'ACTIVE' },
          },
          totp: {
            create: {
              secretEncrypted: 'mock_encrypted_secret',
              isEnabled: true,
              recoveryCodeHashes: codes.map(hashRecoveryCode),
              recoveryCodesAcknowledgedAt: null, // Critical: user never explicitly acknowledged
            },
          },
        },
      });
    });

    afterAll(async () => {
      if (unacknowledgedUser) {
        await withTestAuditCleanup(async () => {
          await prisma.auditLog.deleteMany({ where: { actorUserId: unacknowledgedUser.id } });
          await prisma.user.deleteMany({ where: { id: unacknowledgedUser.id } });
        });
      }
    });

    it('18. Authenticates credentials and issues pending 2FA session', async () => {
      const res = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: unacknowledgedUser.email, password: initialPassword });

      expect(res.status).toBe(200);
      expect(res.body.data.requiresSecondFactor).toBe(true);
      pendingLoginToken = extractSessionCookie(res);
      expect(pendingLoginToken).toBeTruthy();
    });

    it('19. Recovery-code login succeeds, rotates session, but retains pending acknowledgment flag', async () => {
      const res = await request(app)
        .post('/api/auth/superadmin/totp/recovery')
        .set('Authorization', `Bearer ${pendingLoginToken}`)
        .send({ recoveryCode: validRecoveryCode });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isRecoveryCodeAckPending).toBe(true);
      expect(res.body.data.remainingRecoveryCodesCount).toBe(3);

      postRecoverySessionToken = extractSessionCookie(res);
      expect(postRecoverySessionToken).toBeTruthy();
      expect(postRecoverySessionToken).not.toBe(pendingLoginToken);

      // Verify that recoveryCodesAcknowledgedAt in DB is STILL null
      const totpRecord = await prisma.userTotp.findUnique({
        where: { userId: unacknowledgedUser.id },
      });
      expect(totpRecord.recoveryCodesAcknowledgedAt).toBeNull();

      // Verify that the new session in DB is marked isRecoveryCodeAckPending: true
      const sessionInDb = await prisma.session.findFirst({
        where: { userId: unacknowledgedUser.id, revokedAt: null },
      });
      expect(sessionInDb.isRecoveryCodeAckPending).toBe(true);
    });

    it('20. Platform operational APIs remain blocked after recovery-code login', async () => {
      const tenantsRes = await request(app)
        .get('/api/platform/tenants')
        .set('Authorization', `Bearer ${postRecoverySessionToken}`);

      expect(tenantsRes.status).toBe(403);
      expect(tenantsRes.body.code).toBe('RECOVERY_CODE_ACK_REQUIRED');

      const createTenantRes = await request(app)
        .post('/api/platform/tenants')
        .set('Authorization', `Bearer ${postRecoverySessionToken}`)
        .send({
          legalName: 'Blocked Org',
          tradeName: 'Blocked Inc',
          ownerPhone: '+919999988888',
          ownerEmail: 'blocked@example.com',
          ownerFullName: 'Blocked Owner',
        });

      expect(createTenantRes.status).toBe(403);
      expect(createTenantRes.body.code).toBe('RECOVERY_CODE_ACK_REQUIRED');
    });

    it('21. Endpoints mounted outside /api/platform/* also enforce recovery-code acknowledgment', async () => {
      const dashboardRes = await request(app)
        .get('/api/auth/superadmin/dashboard-access')
        .set('Authorization', `Bearer ${postRecoverySessionToken}`);

      expect(dashboardRes.status).toBe(403);
      expect(dashboardRes.body.code).toBe('RECOVERY_CODE_ACK_REQUIRED');
    });

    it('22. Recovery acknowledgment workflow can be accessed and completes the state transition', async () => {
      const ackRes = await request(app)
        .post('/api/auth/superadmin/recovery-codes/acknowledge')
        .set('Authorization', `Bearer ${postRecoverySessionToken}`)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(ackRes.status).toBe(200);
      expect(ackRes.body.success).toBe(true);
      expect(ackRes.body.data.acknowledged).toBe(true);

      // Verify DB state
      const totpRecord = await prisma.userTotp.findUnique({
        where: { userId: unacknowledgedUser.id },
      });
      expect(totpRecord.recoveryCodesAcknowledgedAt).not.toBeNull();

      // Platform operational access is now granted
      const tenantsRes = await request(app)
        .get('/api/platform/tenants')
        .set('Authorization', `Bearer ${postRecoverySessionToken}`);

      expect(tenantsRes.status).toBe(200);
      expect(tenantsRes.body.success).toBe(true);

      // Dashboard access is now granted
      const dashboardRes = await request(app)
        .get('/api/auth/superadmin/dashboard-access')
        .set('Authorization', `Bearer ${postRecoverySessionToken}`);

      expect(dashboardRes.status).toBe(200);
      expect(dashboardRes.body.data.hasAccess).toBe(true);
    });
  });
});
