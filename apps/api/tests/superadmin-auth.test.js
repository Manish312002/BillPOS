import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { hashPassword, hashToken } from '../src/utils/security.js';
import { computeTotpCode, decryptTotpSecret } from '../src/utils/totp.js';

describe('Superadmin Authentication, TOTP & Security Hardening (ADR-002 / WP-02.03D)', () => {
  const testId = Date.now();
  const superadminPhone = `+91838${Math.floor(100000 + Math.random() * 900000)}`;
  const superadminEmail = `superadmin_${testId}@billingbuddy.com`;
  const initialPassword = 'SuperAdmin@InitialPass2026!';
  const updatedPassword = 'SuperAdmin@UpdatedPass2026!';

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
    // 1. Create a platform Superadmin user
    const initialHash = await hashPassword(initialPassword);
    superadminUser = await prisma.user.create({
      data: {
        fullName: 'Test Superadmin Auditor',
        phone: superadminPhone,
        email: superadminEmail,
        passwordHash: initialHash,
        status: 'ACTIVE',
        mustChangePassword: true, // Bootstrap constraint
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
        fullName: 'Regular User',
        phone: `+91700${Math.floor(100000 + Math.random() * 900000)}`,
        email: `regular_${testId}@example.com`,
        passwordHash: initialHash,
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    // Cleanup test data
    if (superadminUser) {
      await prisma.userTotp.deleteMany({ where: { userId: superadminUser.id } });
      await prisma.session.deleteMany({ where: { userId: superadminUser.id } });
      await prisma.platformAuthorization.deleteMany({ where: { userId: superadminUser.id } });
      await prisma.user.delete({ where: { id: superadminUser.id } }).catch(() => {});
    }
    if (nonAdminUser) {
      await prisma.session.deleteMany({ where: { userId: nonAdminUser.id } });
      await prisma.user.delete({ where: { id: nonAdminUser.id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  describe('1. Credential Login, Error Sanitization & Zero Token JSON Exposure (Task 1)', () => {
    it('rejects invalid password with generic 401 error', async () => {
      const res = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: superadminEmail, password: 'WrongPassword123!' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Invalid credentials');
      expect(res.body).not.toHaveProperty('stack');
    });

    it('rejects non-existent identifier with identical generic 401 error (no account enumeration)', async () => {
      const res = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: '+919999999999', password: 'AnyPassword123!' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Invalid credentials');
    });

    it('rejects non-admin credentials trying to access superadmin login', async () => {
      const res = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: nonAdminUser.email, password: initialPassword });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Invalid credentials');
    });

    it('sets HttpOnly cookie and strictly does NOT expose raw session token in JSON', async () => {
      const res = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: superadminPhone, password: initialPassword });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.requiresTotpEnrollment).toBe(true);
      expect(res.body.data.requiresSecondFactor).toBe(true);
      expect(res.body.data.isSecondFactorPending).toBe(true);
      expect(res.body.data.mustChangePassword).toBe(true);

      // Raw session token MUST NOT be exposed in JSON response
      expect(res.body.data).not.toHaveProperty('sessionToken');

      // HttpOnly cookie MUST be set
      expect(res.headers['set-cookie']).toBeDefined();
      const cookie = extractSessionCookie(res);
      expect(cookie).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    });

    it('sending x-client-mode: api CANNOT expose sessionToken in JSON', async () => {
      const res = await request(app)
        .post('/api/auth/superadmin/login')
        .set('x-client-mode', 'api')
        .send({ identifier: superadminPhone, password: initialPassword });

      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('sessionToken');

      const cookie = extractSessionCookie(res);
      expect(cookie).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    });
  });

  describe('2. TOTP Enrollment & Encrypted-at-Rest Persistence', () => {
    let sessionToken = null;

    beforeAll(async () => {
      const loginRes = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: superadminEmail, password: initialPassword });
      sessionToken = extractSessionCookie(loginRes);
    });

    it('rejects unauthenticated enrollment attempts', async () => {
      const res = await request(app).post('/api/auth/superadmin/totp/enroll');
      expect(res.status).toBe(401);
    });

    it('generates an unconfirmed Base32 secret and standard provisioning URI', async () => {
      const res = await request(app)
        .post('/api/auth/superadmin/totp/enroll')
        .set('Authorization', `Bearer ${sessionToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('secret');
      expect(res.body.data).toHaveProperty('provisioningUri');
      expect(res.body.data.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(res.body.data.provisioningUri).toMatch(/^otpauth:\/\/totp\/BillingBuddy:/);
    });

    it('persists TOTP secret encrypted at rest using AES-256-GCM (never plaintext)', async () => {
      const totpRecord = await prisma.userTotp.findUnique({
        where: { userId: superadminUser.id },
      });

      expect(totpRecord).toBeDefined();
      expect(totpRecord.isEnabled).toBe(false); // Unconfirmed

      // Must be serialized AES-256-GCM format: v1:<iv>:<tag>:<ciphertext>
      expect(totpRecord.secretEncrypted).toMatch(/^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);

      // Plaintext secret is not present in raw record
      expect(totpRecord.secretEncrypted).not.toContain('JBSWY');

      // Valid decryptability
      const decrypted = decryptTotpSecret(totpRecord.secretEncrypted);
      expect(decrypted).toMatch(/^[A-Z2-7]{32}$/);
    });
  });

  describe('3. Enrollment Confirmation, Atomic Lockout & Session Rotation (Task 1 & 2)', () => {
    let pendingSessionToken = null;
    let enrolledSecret = null;
    let rotatedSessionToken = null;

    beforeAll(async () => {
      const loginRes = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: superadminEmail, password: initialPassword });
      pendingSessionToken = extractSessionCookie(loginRes);

      const enrollRes = await request(app)
        .post('/api/auth/superadmin/totp/enroll')
        .set('Authorization', `Bearer ${pendingSessionToken}`);
      enrolledSecret = enrollRes.body.data.secret;
    });

    it('rejects confirmation with invalid or malformed 6-digit code', async () => {
      const res = await request(app)
        .post('/api/auth/superadmin/totp/confirm')
        .set('Authorization', `Bearer ${pendingSessionToken}`)
        .send({ code: '000000', secret: enrolledSecret });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('locks enrollment confirmation after 5 consecutive failed attempts via atomic SQL', async () => {
      // 4 more invalid attempts
      for (let i = 0; i < 4; i++) {
        await request(app)
          .post('/api/auth/superadmin/totp/confirm')
          .set('Authorization', `Bearer ${pendingSessionToken}`)
          .send({ code: '000000', secret: enrolledSecret });
      }

      // 5th failed attempt triggers lockout; next attempt returns 429
      const lockRes = await request(app)
        .post('/api/auth/superadmin/totp/confirm')
        .set('Authorization', `Bearer ${pendingSessionToken}`)
        .send({ code: '000000', secret: enrolledSecret });

      expect(lockRes.status).toBe(429);
      expect(lockRes.body.message).toContain('temporarily locked');

      // Reset lockout for confirmation test
      await prisma.userTotp.update({
        where: { userId: superadminUser.id },
        data: { failedAttempts: 0, lockedUntil: null },
      });
    });

    it('confirms enrollment, activates 2FA, reveals recovery codes, rotates session without token in JSON', async () => {
      const validCode = computeTotpCode(enrolledSecret, Date.now());

      const res = await request(app)
        .post('/api/auth/superadmin/totp/confirm')
        .set('Authorization', `Bearer ${pendingSessionToken}`)
        .send({ code: validCode });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('recoveryCodes');
      expect(res.body.data.recoveryCodes).toHaveLength(8);

      // Raw token must NOT be returned in JSON
      expect(res.body.data).not.toHaveProperty('sessionToken');

      rotatedSessionToken = extractSessionCookie(res);
      expect(rotatedSessionToken).toBeDefined();
      expect(rotatedSessionToken).not.toBe(pendingSessionToken); // Session token rotated

      for (const code of res.body.data.recoveryCodes) {
        expect(code).toMatch(/^[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{8}$/);
        const hex = code.replace(/-/g, '');
        expect(hex).toHaveLength(32);
        expect(Buffer.from(hex, 'hex').length * 8).toBe(128);
      }
    });

    it('previous pending session token is revoked and cannot be used after 2FA rotation', async () => {
      const oldRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${pendingSessionToken}`);

      expect(oldRes.status).toBe(401);
      expect(oldRes.body.code).toBe('SESSION_INVALID');

      // New rotated session works and has 2FA completed
      const newRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${rotatedSessionToken}`);

      expect(newRes.status).toBe(200);
      expect(newRes.body.data.session.isSecondFactorPending).toBe(false);
    });
  });

  describe('4. TOTP Verification, Replay Defense & Session Rotation', () => {
    let pendingSessionToken = null;
    let enrolledSecret = null;
    let elevatedSessionToken = null;

    beforeAll(async () => {
      const totpRecord = await prisma.userTotp.findUnique({
        where: { userId: superadminUser.id },
      });
      enrolledSecret = decryptTotpSecret(totpRecord.secretEncrypted);

      // Reset lastAcceptedStep so code for nowStep is accepted
      await prisma.userTotp.update({
        where: { userId: superadminUser.id },
        data: {
          lastAcceptedStep: Math.floor(Date.now() / 30000) - 2,
        },
      });

      const loginRes = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: superadminEmail, password: initialPassword });
      pendingSessionToken = extractSessionCookie(loginRes);
    });

    it('verifies code successfully, rejects replayed code, and rotates session without JSON token', async () => {
      const nowStep = Math.floor(Date.now() / 30000);
      const code = computeTotpCode(enrolledSecret, nowStep * 30000);

      const res = await request(app)
        .post('/api/auth/superadmin/totp/verify')
        .set('Authorization', `Bearer ${pendingSessionToken}`)
        .send({ code });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Raw token must NOT be returned in JSON
      expect(res.body.data).not.toHaveProperty('sessionToken');

      elevatedSessionToken = extractSessionCookie(res);
      expect(elevatedSessionToken).not.toBe(pendingSessionToken);

      // Attempt immediate reuse of the same time-step (REPLAY ATTACK)
      const replayRes = await request(app)
        .post('/api/auth/superadmin/totp/verify')
        .set('Authorization', `Bearer ${elevatedSessionToken}`)
        .send({ code });

      expect(replayRes.status).toBe(400);
      expect(replayRes.body.code).toBe('TOTP_CODE_REUSED');

      // Old pre-2FA session is now revoked
      const oldRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${pendingSessionToken}`);
      expect(oldRes.status).toBe(401);
    });

    it('concurrent duplicate time-step requests result in exactly one success and rejection for the other', async () => {
      const totpRecord = await prisma.userTotp.findUnique({
        where: { userId: superadminUser.id },
      });

      const targetStep = (totpRecord.lastAcceptedStep || Math.floor(Date.now() / 30000)) + 10;

      const [res1, res2] = await Promise.all([
        prisma.userTotp.updateMany({
          where: {
            id: totpRecord.id,
            OR: [{ lastAcceptedStep: null }, { lastAcceptedStep: { lt: targetStep } }],
          },
          data: { lastAcceptedStep: targetStep },
        }),
        prisma.userTotp.updateMany({
          where: {
            id: totpRecord.id,
            OR: [{ lastAcceptedStep: null }, { lastAcceptedStep: { lt: targetStep } }],
          },
          data: { lastAcceptedStep: targetStep },
        }),
      ]);

      const counts = [res1.count, res2.count];
      expect(counts.filter((c) => c === 1)).toHaveLength(1);
      expect(counts.filter((c) => c === 0)).toHaveLength(1);
    });
  });

  describe('5. Recovery Code Atomicity & Concurrency Defense (SEC-AUTH-04)', () => {
    let pendingSessionToken = null;
    let testCodes = null;

    beforeEach(async () => {
      const loginRes = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: superadminEmail, password: initialPassword });
      pendingSessionToken = extractSessionCookie(loginRes);

      const { generateRecoveryCodes, hashRecoveryCode } = await import('../src/utils/totp.js');
      testCodes = generateRecoveryCodes(4);

      await prisma.userTotp.update({
        where: { userId: superadminUser.id },
        data: {
          recoveryCodeHashes: testCodes.map(hashRecoveryCode),
          failedAttempts: 0,
          lockedUntil: null,
        },
      });
    });

    it('accepts valid recovery code, rotates session, and rejects second consumption without JSON token', async () => {
      const res = await request(app)
        .post('/api/auth/superadmin/totp/recovery')
        .set('Authorization', `Bearer ${pendingSessionToken}`)
        .send({ recoveryCode: testCodes[0] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.remainingRecoveryCodesCount).toBe(3);

      // Raw token must NOT be returned in JSON
      expect(res.body.data).not.toHaveProperty('sessionToken');

      const rotatedToken = extractSessionCookie(res);
      expect(rotatedToken).not.toBe(pendingSessionToken);

      // Second attempt with same code fails
      const reattemptRes = await request(app)
        .post('/api/auth/superadmin/totp/recovery')
        .set('Authorization', `Bearer ${rotatedToken}`)
        .send({ recoveryCode: testCodes[0] });

      expect(reattemptRes.status).toBe(401);
    });

    it('MANDATORY CONCURRENCY SCENARIO 1: two concurrent requests redeem DIFFERENT recovery codes without lost update', async () => {
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/auth/superadmin/totp/recovery')
          .set('Authorization', `Bearer ${pendingSessionToken}`)
          .send({ recoveryCode: testCodes[0] }),
        request(app)
          .post('/api/auth/superadmin/totp/recovery')
          .set('Authorization', `Bearer ${pendingSessionToken}`)
          .send({ recoveryCode: testCodes[1] }),
      ]);

      const successes = [res1.status, res2.status].filter((s) => s === 200);
      expect(successes.length).toBeGreaterThanOrEqual(1);

      // Verify PostgreSQL array: both codes [0] and [1] MUST NOT exist in recoveryCodeHashes
      const updatedTotp = await prisma.userTotp.findUnique({
        where: { userId: superadminUser.id },
      });
      const { hashRecoveryCode } = await import('../src/utils/totp.js');
      expect(updatedTotp.recoveryCodeHashes).not.toContain(hashRecoveryCode(testCodes[0]));
      if (res2.status === 200) {
        expect(updatedTotp.recoveryCodeHashes).not.toContain(hashRecoveryCode(testCodes[1]));
      }
    });

    it('MANDATORY CONCURRENCY SCENARIO 2: two concurrent requests redeem the SAME recovery code produce at most one success', async () => {
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/auth/superadmin/totp/recovery')
          .set('Authorization', `Bearer ${pendingSessionToken}`)
          .send({ recoveryCode: testCodes[2] }),
        request(app)
          .post('/api/auth/superadmin/totp/recovery')
          .set('Authorization', `Bearer ${pendingSessionToken}`)
          .send({ recoveryCode: testCodes[2] }),
      ]);

      const statuses = [res1.status, res2.status];
      const successCount = statuses.filter((s) => s === 200).length;
      expect(successCount).toBe(1); // Exactly one succeeded

      const failureCount = statuses.filter((s) => s >= 400).length;
      expect(failureCount).toBe(1);
    });
  });

  describe('6. Password Change Lifecycle & 2FA Bypass Defense', () => {
    let pendingSessionToken = null;
    let elevatedSessionToken = null;

    beforeAll(async () => {
      const loginRes = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: superadminEmail, password: initialPassword });
      pendingSessionToken = extractSessionCookie(loginRes);

      const totpRecord = await prisma.userTotp.findUnique({
        where: { userId: superadminUser.id },
      });
      const enrolledSecret = decryptTotpSecret(totpRecord.secretEncrypted);

      // Reset lastAcceptedStep so code for nowStep is accepted
      await prisma.userTotp.update({
        where: { userId: superadminUser.id },
        data: {
          lastAcceptedStep: Math.floor(Date.now() / 30000) - 2,
        },
      });

      const code = computeTotpCode(enrolledSecret, Date.now());

      const verifyRes = await request(app)
        .post('/api/auth/superadmin/totp/verify')
        .set('Authorization', `Bearer ${pendingSessionToken}`)
        .send({ code });
      elevatedSessionToken = extractSessionCookie(verifyRes);
    });

    it('rejects password change if second-factor is pending (2FA bypass defense)', async () => {
      const freshLogin = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: superadminEmail, password: initialPassword });
      const pendingToken = extractSessionCookie(freshLogin);

      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${pendingToken}`)
        .send({
          currentPassword: initialPassword,
          newPassword: updatedPassword,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('SECOND_FACTOR_REQUIRED');
    });

    it('rejects password change if current password is incorrect', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${elevatedSessionToken}`)
        .send({
          currentPassword: 'IncorrectPassword123!',
          newPassword: updatedPassword,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Current password is incorrect');
    });

    it('rejects password change if new password is identical to current password', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${elevatedSessionToken}`)
        .send({
          currentPassword: initialPassword,
          newPassword: initialPassword,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('cannot be identical');
    });

    it('successfully changes password with native bcrypt 12 rounds and clears mustChangePassword', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${elevatedSessionToken}`)
        .send({
          currentPassword: initialPassword,
          newPassword: updatedPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updatedUser = await prisma.user.findUnique({
        where: { id: superadminUser.id },
      });
      expect(updatedUser.mustChangePassword).toBe(false);
      expect(updatedUser.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    });

    it('permits login with updated password and rejects previous initial password', async () => {
      const oldRes = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: superadminEmail, password: initialPassword });
      expect(oldRes.status).toBe(401);

      const newRes = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: superadminEmail, password: updatedPassword });
      expect(newRes.status).toBe(200);
      expect(newRes.body.data.mustChangePassword).toBe(false);
    });
  });

  describe('7. Mandatory Password-Change Route Guard (SEC-AUTH-08)', () => {
    it('denies privileged dashboard access while mustChangePassword is true', async () => {
      await prisma.user.update({
        where: { id: superadminUser.id },
        data: { mustChangePassword: true },
      });

      const loginRes = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: superadminEmail, password: updatedPassword });

      const totpRecord = await prisma.userTotp.findUnique({
        where: { userId: superadminUser.id },
      });
      const enrolledSecret = decryptTotpSecret(totpRecord.secretEncrypted);

      await prisma.userTotp.update({
        where: { userId: superadminUser.id },
        data: {
          lastAcceptedStep: Math.floor(Date.now() / 30000) - 2,
        },
      });

      const code = computeTotpCode(enrolledSecret, Date.now());

      const verifyRes = await request(app)
        .post('/api/auth/superadmin/totp/verify')
        .set('Authorization', `Bearer ${extractSessionCookie(loginRes)}`)
        .send({ code });

      const privilegedToken = extractSessionCookie(verifyRes);

      // Acknowledge recovery codes so the recovery-code gate is satisfied
      // and we isolate the mandatory password-change gate
      await request(app)
        .post('/api/auth/superadmin/recovery-codes/acknowledge')
        .set('Authorization', `Bearer ${privilegedToken}`)
        .set('X-Requested-With', 'XMLHttpRequest');

      // Accessing /superadmin/dashboard-access must fail with 403 PASSWORD_CHANGE_REQUIRED
      const accessRes = await request(app)
        .get('/api/auth/superadmin/dashboard-access')
        .set('Authorization', `Bearer ${privilegedToken}`);

      expect(accessRes.status).toBe(403);
      expect(accessRes.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

      // Change password to satisfy constraint
      await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${privilegedToken}`)
        .send({
          currentPassword: updatedPassword,
          newPassword: 'BrandNewPassword2026!',
        });

      // Now access is granted
      const grantedRes = await request(app)
        .get('/api/auth/superadmin/dashboard-access')
        .set('Authorization', `Bearer ${privilegedToken}`);

      expect(grantedRes.status).toBe(200);
      expect(grantedRes.body.data.hasAccess).toBe(true);

      // Revert password for downstream tests
      await prisma.user.update({
        where: { id: superadminUser.id },
        data: {
          passwordHash: await hashPassword(updatedPassword),
          mustChangePassword: false,
        },
      });
    });
  });

  describe('8. CSRF & Request-Origin Protection (SEC-AUTH-03)', () => {
    let sessionCookie = null;

    beforeAll(async () => {
      const loginRes = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: superadminEmail, password: updatedPassword });
      sessionCookie = extractSessionCookie(loginRes);
    });

    it('rejects cookie-authenticated mutation with unexpected Origin', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `bb_session=${sessionCookie}`)
        .set('Origin', 'https://malicious-attacker.com');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF_ORIGIN_INVALID');
    });

    it('rejects cookie-authenticated mutation missing Origin, Referer and custom header', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `bb_session=${sessionCookie}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF_HEADER_MISSING');
    });

    it('accepts cookie-authenticated mutation with valid Origin header', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `bb_session=${sessionCookie}`)
        .set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('accepts cookie-authenticated mutation with valid Referer header', async () => {
      const loginRes = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: superadminEmail, password: updatedPassword });
      const freshCookie = extractSessionCookie(loginRes);

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `bb_session=${freshCookie}`)
        .set('Referer', 'http://localhost:5173/settings');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('accepts cookie-authenticated mutation with custom X-Requested-With header', async () => {
      const loginRes = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: superadminEmail, password: updatedPassword });
      const freshCookie = extractSessionCookie(loginRes);

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `bb_session=${freshCookie}`)
        .set('x-requested-with', 'XMLHttpRequest');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('9. Cookie Authentication Lifecycle & Sliding Expiration (SEC-AUTH-06, SEC-AUTH-10)', () => {
    let cookie = null;
    let sessionId = null;

    beforeAll(async () => {
      const loginRes = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: superadminEmail, password: updatedPassword });
      cookie = extractSessionCookie(loginRes);

      const sessionRecord = await prisma.session.findFirst({
        where: { sessionTokenHash: hashToken(cookie) },
      });
      sessionId = sessionRecord.id;
    });

    it('authenticates requests using valid bb_session cookie', async () => {
      const res = await request(app).get('/api/auth/me').set('Cookie', `bb_session=${cookie}`);

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe(superadminEmail);
    });

    it('rejects invalid or forged bb_session cookie', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set(
          'Cookie',
          'bb_session=0000000000000000000000000000000000000000000000000000000000000000'
        );

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('SESSION_INVALID');
    });

    it('SEC-AUTH-06: slides idle expiration on active requests without exceeding absolute limit', async () => {
      const pastActivity = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago
      await prisma.session.update({
        where: { id: sessionId },
        data: {
          lastActivityAt: pastActivity,
          idleExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes left
        },
      });

      const res = await request(app).get('/api/auth/me').set('Cookie', `bb_session=${cookie}`);

      expect(res.status).toBe(200);

      const updatedSession = await prisma.session.findUnique({
        where: { id: sessionId },
      });
      const idleRemainingMs = updatedSession.idleExpiresAt.getTime() - Date.now();
      expect(idleRemainingMs).toBeGreaterThan(25 * 60 * 1000); // Slid to ~30 mins

      expect(updatedSession.idleExpiresAt.getTime()).toBeLessThanOrEqual(
        updatedSession.absoluteExpiresAt.getTime()
      );
    });

    it('logout revokes session server-side and clears bb_session cookie', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `bb_session=${cookie}`)
        .set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(200);

      const clearedCookies = res.headers['set-cookie'].join('; ');
      expect(clearedCookies).toContain('bb_session=;');

      const revokedSession = await prisma.session.findUnique({
        where: { id: sessionId },
      });
      expect(revokedSession.revokedAt).not.toBeNull();
    });
  });

  describe('10. Atomic Lockout Concurrency & Expiry Recovery (Task 2)', () => {
    let sessionToken = null;
    let enrolledSecret = null;

    beforeAll(async () => {
      const totpRecord = await prisma.userTotp.findUnique({
        where: { userId: superadminUser.id },
      });
      enrolledSecret = decryptTotpSecret(totpRecord.secretEncrypted);
    });

    beforeEach(async () => {
      await prisma.userTotp.update({
        where: { userId: superadminUser.id },
        data: {
          failedAttempts: 0,
          lockedUntil: null,
          lastAcceptedStep: Math.floor(Date.now() / 30000) - 2,
        },
      });

      const loginRes = await request(app)
        .post('/api/auth/superadmin/login')
        .send({ identifier: superadminEmail, password: updatedPassword });
      sessionToken = extractSessionCookie(loginRes);
    });

    it('five concurrent invalid verification attempts trigger lockout via single SQL atomic increment', async () => {
      // Send 5 concurrent invalid verification attempts simultaneously
      const results = await Promise.all([
        request(app)
          .post('/api/auth/superadmin/totp/verify')
          .set('Authorization', `Bearer ${sessionToken}`)
          .send({ code: '999991' }),
        request(app)
          .post('/api/auth/superadmin/totp/verify')
          .set('Authorization', `Bearer ${sessionToken}`)
          .send({ code: '999992' }),
        request(app)
          .post('/api/auth/superadmin/totp/verify')
          .set('Authorization', `Bearer ${sessionToken}`)
          .send({ code: '999993' }),
        request(app)
          .post('/api/auth/superadmin/totp/verify')
          .set('Authorization', `Bearer ${sessionToken}`)
          .send({ code: '999994' }),
        request(app)
          .post('/api/auth/superadmin/totp/verify')
          .set('Authorization', `Bearer ${sessionToken}`)
          .send({ code: '999995' }),
      ]);

      // All 5 should fail with 401
      for (const r of results) {
        expect(r.status).toBe(401);
      }

      // Check DB: failedAttempts MUST be exactly 5 (no lost increments)
      const totp = await prisma.userTotp.findUnique({
        where: { userId: superadminUser.id },
      });
      expect(totp.failedAttempts).toBe(5);
      expect(totp.lockedUntil).not.toBeNull();
      expect(totp.lockedUntil.getTime()).toBeGreaterThan(Date.now());

      // 6th attempt must immediately return 429 Too Many Requests
      const lockRes = await request(app)
        .post('/api/auth/superadmin/totp/verify')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ code: '999999' });

      expect(lockRes.status).toBe(429);
      expect(lockRes.body.message).toContain('temporarily locked');
    });

    it('a valid verification racing with the lockout threshold cannot bypass the lockout', async () => {
      // Set failedAttempts to 4 (threshold - 1)
      await prisma.userTotp.update({
        where: { userId: superadminUser.id },
        data: { failedAttempts: 4, lockedUntil: null },
      });

      const validCode = computeTotpCode(enrolledSecret, Date.now());

      // Race 1 invalid attempt (which reaches 5 and locks) and 1 valid attempt concurrently
      const [resFail, resValid] = await Promise.all([
        request(app)
          .post('/api/auth/superadmin/totp/verify')
          .set('Authorization', `Bearer ${sessionToken}`)
          .send({ code: '111111' }),
        request(app)
          .post('/api/auth/superadmin/totp/verify')
          .set('Authorization', `Bearer ${sessionToken}`)
          .send({ code: validCode }),
      ]);

      // Deterministic evaluation:
      // If the failure commits first, the account locks; the valid attempt is blocked (429) and cannot authenticate.
      // If the valid attempt commits first, it resets counters (200), and the failure becomes attempt 1.
      if (resValid.status === 200) {
        // Valid attempt won the race, so it authenticated cleanly
        expect(resValid.body.success).toBe(true);
        expect(resFail.status).toBe(401);
      } else {
        // Failure won the race, account locked: valid attempt MUST NOT bypass the lockout
        expect([400, 429]).toContain(resValid.status);
        expect(resFail.status).toBe(401);

        const lockedTotp = await prisma.userTotp.findUnique({
          where: { userId: superadminUser.id },
        });
        expect(lockedTotp.lockedUntil).not.toBeNull();
      }
    });

    it('expired lockout permits verification again', async () => {
      // Set lockedUntil to 1 second in the past (expired lockout)
      await prisma.userTotp.update({
        where: { userId: superadminUser.id },
        data: {
          failedAttempts: 5,
          lockedUntil: new Date(Date.now() - 1000),
          lastAcceptedStep: Math.floor(Date.now() / 30000) - 2,
        },
      });

      const validCode = computeTotpCode(enrolledSecret, Date.now());

      const res = await request(app)
        .post('/api/auth/superadmin/totp/verify')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ code: validCode });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify DB counters reset
      const totp = await prisma.userTotp.findUnique({
        where: { userId: superadminUser.id },
      });
      expect(totp.failedAttempts).toBe(0);
      expect(totp.lockedUntil).toBeNull();
    });
  });
});
