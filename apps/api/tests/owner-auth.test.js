import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { hashPassword, hashToken, generateOpaqueToken } from '../src/utils/security.js';
import { maskIdentifier } from '../src/services/auth.service.js';
import { withTestAuditCleanup } from './helpers/testAuditCleanup.js';

describe('Store Owner Authentication, Activation & Invitation Lifecycle (ADR-002)', () => {
  const testId = Date.now();
  const superadminPassword = 'SuperAdmin@SecureTest2026!';
  const ownerPassword = 'StoreOwner@SecurePass2026!';

  let superadminUser = null;
  let superadminSessionToken = null;

  const createdTenantIds = [];
  const createdUserIds = [];

  // Helper to extract session cookie from response
  function getSessionCookie(res) {
    const cookies = res.headers['set-cookie'];
    if (!cookies) return null;
    const cookieArray = Array.isArray(cookies) ? cookies : [cookies];
    const sessionCookie = cookieArray.find((c) => c.startsWith('bb_session='));
    return sessionCookie ? sessionCookie.split(';')[0] : null;
  }

  // Helper to create an active Superadmin session
  async function createSuperadminSession(userId) {
    const rawToken = generateOpaqueToken(32);
    const sessionTokenHash = hashToken(rawToken);
    const now = new Date();

    await prisma.session.create({
      data: {
        userId,
        sessionTokenHash,
        sessionType: 'PLATFORM',
        isSecondFactorPending: false,
        isRecoveryCodeAckPending: false,
        idleExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
        lastActivityAt: now,
      },
    });

    return rawToken;
  }

  beforeAll(async () => {
    const passwordHash = await hashPassword(superadminPassword);

    // Seed dedicated Superadmin
    superadminUser = await prisma.user.create({
      data: {
        fullName: 'Superadmin OwnerAuth Tester',
        phone: `+91850${Math.floor(100000 + Math.random() * 900000)}`,
        email: `sa_ownerauth_${testId}@billingbuddy.com`,
        passwordHash,
        status: 'ACTIVE',
        mustChangePassword: false,
        platformAuthorization: {
          create: {
            role: 'SUPERADMIN',
            status: 'ACTIVE',
          },
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
    createdUserIds.push(superadminUser.id);

    superadminSessionToken = await createSuperadminSession(superadminUser.id);
  });

  afterAll(async () => {
    await withTestAuditCleanup(async () => {
      if (createdTenantIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { targetTenantId: { in: createdTenantIds } } });
        await prisma.session.deleteMany({ where: { activeTenantId: { in: createdTenantIds } } });
        await prisma.onboardingProgress.deleteMany({
          where: { tenantId: { in: createdTenantIds } },
        });
        await prisma.ownerInvitation.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
        await prisma.tenantMembership.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
        await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
      }

      if (createdUserIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
        await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
        await prisma.platformAuthorization.deleteMany({ where: { userId: { in: createdUserIds } } });
        await prisma.userTotp.deleteMany({ where: { userId: { in: createdUserIds } } });
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
    });
  });

  describe('1. Superadmin Password Change Persistence (Issue 1)', () => {
    let testSaUser = null;
    let testSaToken = null;

    it('persists mustChangePassword=false upon password change and maintains it across logout & subsequent login', async () => {
      const initialPwd = 'Initial@Password2026!';
      const initialHash = await hashPassword(initialPwd);
      const newPwd = 'Updated@SuperAdmin2026!';

      // Create a superadmin user with mustChangePassword = true
      testSaUser = await prisma.user.create({
        data: {
          fullName: 'Password Change Tester',
          phone: `+91851${Math.floor(100000 + Math.random() * 900000)}`,
          email: `sa_pwd_${testId}@billingbuddy.com`,
          passwordHash: initialHash,
          status: 'ACTIVE',
          mustChangePassword: true,
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
      createdUserIds.push(testSaUser.id);

      testSaToken = await createSuperadminSession(testSaUser.id);

      // Verify privileged access is denied while mustChangePassword is true
      const deniedRes = await request(app)
        .get('/api/auth/superadmin/dashboard-access')
        .set('Cookie', [`bb_session=${testSaToken}`]);
      expect(deniedRes.status).toBe(403);
      expect(deniedRes.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

      // Change password
      const changeRes = await request(app)
        .post('/api/auth/change-password')
        .set('Cookie', [`bb_session=${testSaToken}`])
        .set('Referer', 'http://localhost:5173')
        .send({
          currentPassword: initialPwd,
          newPassword: newPwd,
        });

      expect(changeRes.status).toBe(200);
      expect(changeRes.body.data.mustChangePassword).toBe(false);
      expect(changeRes.body.data.user.mustChangePassword).toBe(false);

      // Check database persistence directly
      const dbUser = await prisma.user.findUnique({ where: { id: testSaUser.id } });
      expect(dbUser.mustChangePassword).toBe(false);

      // Verify GET /api/auth/me returns mustChangePassword: false
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`bb_session=${testSaToken}`]);
      expect(meRes.status).toBe(200);
      expect(meRes.body.data.user.mustChangePassword).toBe(false);

      // Verify privileged dashboard access is now granted
      const accessRes = await request(app)
        .get('/api/auth/superadmin/dashboard-access')
        .set('Cookie', [`bb_session=${testSaToken}`]);
      expect(accessRes.status).toBe(200);
      expect(accessRes.body.data.hasAccess).toBe(true);

      // Log out
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', [`bb_session=${testSaToken}`])
        .set('Referer', 'http://localhost:5173');
      expect(logoutRes.status).toBe(200);

      // Verify old session revoked
      const meRevoked = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`bb_session=${testSaToken}`]);
      expect(meRevoked.status).toBe(401);

      // Login again with the new password
      const loginRes = await request(app)
        .post('/api/auth/superadmin/login')
        .set('Referer', 'http://localhost:5173')
        .send({
          identifier: testSaUser.phone,
          password: newPwd,
        });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.data.mustChangePassword).toBe(false);
      expect(loginRes.body.data.user.mustChangePassword).toBe(false);
    });
  });

  describe('2. Store Owner WhatsApp Activation & Validation (Issue 2)', () => {
    let tenant = null;
    let rawToken = null;
    let invitedPhone = null;
    let invitedEmail = null;

    beforeAll(async () => {
      invitedPhone = `+91911${Math.floor(100000 + Math.random() * 900000)}`;
      invitedEmail = `owner_act_${testId}@teststore.com`;

      // Superadmin creates a tenant
      const res = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', [`bb_session=${superadminSessionToken}`])
        .set('Referer', 'http://localhost:5173')
        .send({
          legalName: `Test Grocery ${testId} Ltd`,
          tradeName: `Test Grocery ${testId}`,
          slug: `test-grocery-${testId}`,
          ownerFullName: 'Aarav Patel',
          ownerPhone: invitedPhone,
          ownerEmail: invitedEmail,
        });

      expect(res.status).toBe(201);
      tenant = res.body.data.tenant;
      rawToken = res.body.data.invitation.rawToken;
      createdTenantIds.push(tenant.id);

      expect(res.body.data.invitation.activationUrl).toContain(`/owner/activate#token=${rawToken}`);
      expect(res.body.data.invitation.whatsappUrl).toContain('https://wa.me/');
    });

    it('POST /api/auth/owner/invitation/validate verifies valid token without exposing secrets', async () => {
      const res = await request(app)
        .post('/api/auth/owner/invitation/validate')
        .set('Referer', 'http://localhost:5173')
        .send({ token: rawToken });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(true);
      expect(res.body.data.tenant.id).toBe(tenant.id);
      expect(res.body.data.tenant.slug).toBe(tenant.slug);
      expect(res.body.data.invitedPhone).toBe(invitedPhone);
      expect(res.body.data.invitedEmail).toBe(invitedEmail);
      expect(res.body.data.tokenHash).toBeUndefined();
      expect(res.body.data.rawToken).toBeUndefined();
    });

    it('POST /api/auth/owner/invitation/validate rejects invalid or nonexistent token with 404', async () => {
      const res = await request(app)
        .post('/api/auth/owner/invitation/validate')
        .set('Referer', 'http://localhost:5173')
        .send({ token: 'nonexistent_token_string_with_min_16_chars' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('INVITATION_NOT_FOUND');
    });

    it('POST /api/auth/owner/activate rejects weak password', async () => {
      const res = await request(app)
        .post('/api/auth/owner/activate')
        .set('Referer', 'http://localhost:5173')
        .send({
          token: rawToken,
          password: 'weak',
        });

      expect(res.status).toBe(400);
    });

    it('POST /api/auth/owner/activate activates tenant, creates user & session, sets cookie', async () => {
      const res = await request(app)
        .post('/api/auth/owner/activate')
        .set('Referer', 'http://localhost:5173')
        .send({
          token: rawToken,
          password: ownerPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.user.phone).toBe(invitedPhone);
      expect(res.body.data.user.email).toBe(invitedEmail);
      expect(res.body.data.user.mustChangePassword).toBe(false);
      expect(res.body.data.activeTenant.status).toBe('ACTIVE');
      expect(res.body.data.membership.role).toBe('STORE_OWNER');
      expect(res.body.data.membership.status).toBe('ACTIVE');

      createdUserIds.push(res.body.data.user.id);

      // Verify cookie
      const cookie = getSessionCookie(res);
      expect(cookie).toBeTruthy();
      expect(cookie).toContain('bb_session=');

      // Verify Tenant status in database is ACTIVE
      const dbTenant = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      expect(dbTenant.status).toBe('ACTIVE');

      // Verify OwnerInvitation status in database is ACCEPTED
      const dbInvitation = await prisma.ownerInvitation.findFirst({
        where: { tenantId: tenant.id },
      });
      expect(dbInvitation.status).toBe('ACCEPTED');
      expect(dbInvitation.acceptedAt).toBeTruthy();

      // Verify OnboardingProgress step 1 initialized
      const dbProgress = await prisma.onboardingProgress.findUnique({
        where: { tenantId: tenant.id },
      });
      expect(dbProgress.currentStep).toBe(1);

      // Verify Trial Subscription automatically provisioned (Decision D-03)
      const dbSub = await prisma.tenantSubscription.findFirst({
        where: { tenantId: tenant.id },
      });
      expect(dbSub).toBeDefined();
      expect(dbSub.status).toBe('TRIAL');

      // Verify AuditLog TENANT_ACTIVATED recorded with masked identifiers (SEC-AUD-03)
      const dbAudit = await prisma.auditLog.findFirst({
        where: { targetTenantId: tenant.id, eventType: 'TENANT_ACTIVATED' },
      });
      expect(dbAudit).toBeTruthy();
      expect(dbAudit.metadata.phone).not.toBe(invitedPhone);
      expect(dbAudit.metadata.phone).toBe(maskIdentifier(invitedPhone));
      expect(dbAudit.metadata.email).not.toBe(invitedEmail);
      expect(dbAudit.metadata.email).toBe(maskIdentifier(invitedEmail));
    });

    it('rejects repeated activation attempts on already accepted invitation with 410', async () => {
      const res = await request(app)
        .post('/api/auth/owner/activate')
        .set('Referer', 'http://localhost:5173')
        .send({
          token: rawToken,
          password: ownerPassword,
        });

      expect(res.status).toBe(410);
      expect(res.body.code).toBe('INVITATION_ALREADY_ACCEPTED');
    });

    it('supports multi-tenant owner identity reuse without creating duplicate users', async () => {
      // Create a second tenant with the same owner phone
      const secondRes = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', [`bb_session=${superadminSessionToken}`])
        .set('Referer', 'http://localhost:5173')
        .send({
          legalName: `Second Store ${testId} Ltd`,
          slug: `second-store-${testId}`,
          ownerFullName: 'Aarav Patel',
          ownerPhone: invitedPhone,
          ownerEmail: `secondary_${invitedEmail}`,
        });

      expect(secondRes.status).toBe(201);
      const secondTenant = secondRes.body.data.tenant;
      const secondToken = secondRes.body.data.invitation.rawToken;
      createdTenantIds.push(secondTenant.id);

      // Activate second store with existing owner identity
      const actRes = await request(app)
        .post('/api/auth/owner/activate')
        .set('Referer', 'http://localhost:5173')
        .send({
          token: secondToken,
          password: ownerPassword,
        });

      expect(actRes.status).toBe(200);
      expect(actRes.body.data.user.phone).toBe(invitedPhone);

      // Verify only ONE User row exists for this phone number
      const userCount = await prisma.user.count({ where: { phone: invitedPhone } });
      expect(userCount).toBe(1);

      // Verify user has TWO active memberships
      const memberships = await prisma.tenantMembership.findMany({
        where: { userId: actRes.body.data.user.id },
      });
      expect(memberships.length).toBe(2);
    });

    it('F-WP02-02: preserves existing user credentials and password hash during multi-tenant activation', async () => {
      const ownerIdentityPhone = `+91977${Math.floor(100000 + Math.random() * 900000)}`;
      const ownerIdentityEmail = `preserve_${testId}@multiowner.com`;
      const originalStorePassword = 'OriginalSecurePassword2026!';
      const secondStorePassword = 'SecondAttemptPassword2026!';

      // 1. Create and activate Store A for an owner
      const storeARes = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', [`bb_session=${superadminSessionToken}`])
        .set('Referer', 'http://localhost:5173')
        .send({
          legalName: `Store A Retail ${testId}`,
          slug: `store-a-${testId}`,
          ownerFullName: 'Preserve Identity Owner',
          ownerPhone: ownerIdentityPhone,
          ownerEmail: ownerIdentityEmail,
        });

      expect(storeARes.status).toBe(201);
      const storeA = storeARes.body.data.tenant;
      const tokenA = storeARes.body.data.invitation.rawToken;
      createdTenantIds.push(storeA.id);

      const activateARes = await request(app)
        .post('/api/auth/owner/activate')
        .set('Referer', 'http://localhost:5173')
        .send({
          token: tokenA,
          password: originalStorePassword,
        });

      expect(activateARes.status).toBe(200);
      createdUserIds.push(activateARes.body.data.user.id);

      // 2. Record the owner's password hash from database
      const userAfterA = await prisma.user.findUnique({
        where: { id: activateARes.body.data.user.id },
      });
      const recordedPasswordHash = userAfterA.passwordHash;
      expect(recordedPasswordHash).toBeTruthy();

      // 3. Create an invitation for Store B using the same identity
      const storeBRes = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', [`bb_session=${superadminSessionToken}`])
        .set('Referer', 'http://localhost:5173')
        .send({
          legalName: `Store B Retail ${testId}`,
          slug: `store-b-${testId}`,
          ownerFullName: 'Preserve Identity Owner',
          ownerPhone: ownerIdentityPhone,
          ownerEmail: `secondary_${ownerIdentityEmail}`,
        });

      expect(storeBRes.status).toBe(201);
      const storeB = storeBRes.body.data.tenant;
      const tokenB = storeBRes.body.data.invitation.rawToken;
      createdTenantIds.push(storeB.id);

      // 4. Activate Store B with a different password
      const activateBRes = await request(app)
        .post('/api/auth/owner/activate')
        .set('Referer', 'http://localhost:5173')
        .send({
          token: tokenB,
          password: secondStorePassword,
        });

      expect(activateBRes.status).toBe(200);

      // 5. Verify the password hash is completely unchanged in PostgreSQL
      const userAfterB = await prisma.user.findUnique({
        where: { id: activateARes.body.data.user.id },
      });
      expect(userAfterB.passwordHash).toBe(recordedPasswordHash);

      // 6. Verify both tenant memberships are active
      const memberships = await prisma.tenantMembership.findMany({
        where: { userId: userAfterB.id },
      });
      expect(memberships.length).toBe(2);
      expect(memberships.every((m) => m.status === 'ACTIVE' && m.role === 'STORE_OWNER')).toBe(
        true
      );

      // 7. Verify the original password still works for login
      const loginOrigRes = await request(app)
        .post('/api/auth/owner/login')
        .set('Referer', 'http://localhost:5173')
        .send({
          identifier: ownerIdentityPhone,
          password: originalStorePassword,
        });

      expect(loginOrigRes.status).toBe(200);

      // 8. Verify the second activation password cannot replace or work as the login password
      const loginSecondRes = await request(app)
        .post('/api/auth/owner/login')
        .set('Referer', 'http://localhost:5173')
        .send({
          identifier: ownerIdentityPhone,
          password: secondStorePassword,
        });

      expect(loginSecondRes.status).toBe(401);
      expect(loginSecondRes.body.code).toBe('UNAUTHORIZED');
    });

    it('F-WP02-03: atomic invitation consumption ensures exactly one of concurrent activation requests succeeds', async () => {
      const concurrentPhone = `+91966${Math.floor(100000 + Math.random() * 900000)}`;
      const concurrentEmail = `concurrent_${testId}@race.com`;

      // 1. Create one pending invitation
      const tenantRes = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', [`bb_session=${superadminSessionToken}`])
        .set('Referer', 'http://localhost:5173')
        .send({
          legalName: `Concurrent Store ${testId}`,
          slug: `concurrent-${testId}`,
          ownerFullName: 'Race Condition Owner',
          ownerPhone: concurrentPhone,
          ownerEmail: concurrentEmail,
        });

      expect(tenantRes.status).toBe(201);
      const tenant = tenantRes.body.data.tenant;
      const token = tenantRes.body.data.invitation.rawToken;
      createdTenantIds.push(tenant.id);

      // 2. Submit two activation requests concurrently with the same token
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/auth/owner/activate')
          .set('Referer', 'http://localhost:5173')
          .send({ token, password: ownerPassword }),
        request(app)
          .post('/api/auth/owner/activate')
          .set('Referer', 'http://localhost:5173')
          .send({ token, password: ownerPassword }),
      ]);

      // 3. Verify exactly one request succeeds and one receives controlled rejection
      const winningRes = res1.status === 200 ? res1 : res2;
      const losingRes = res1.status === 200 ? res2 : res1;
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 410]);

      expect(winningRes.status).toBe(200);
      expect(winningRes.body.success).toBe(true);
      createdUserIds.push(winningRes.body.data.user.id);

      // 6. Verify the losing request receives a controlled error, not an unhandled 500
      expect(losingRes.status).toBe(410);
      expect(losingRes.body.success).toBe(false);
      expect(losingRes.body.code).toBe('INVITATION_ALREADY_ACCEPTED');

      // 4. Verify the invitation is accepted exactly once in the database
      const invitation = await prisma.ownerInvitation.findFirst({
        where: { tenantId: tenant.id },
      });
      expect(invitation.status).toBe('ACCEPTED');

      // 5. Verify only one membership and one activation audit event are created
      const memberships = await prisma.tenantMembership.findMany({
        where: { tenantId: tenant.id },
      });
      expect(memberships.length).toBe(1);

      const auditLogs = await prisma.auditLog.findMany({
        where: { targetTenantId: tenant.id, eventType: 'TENANT_ACTIVATED' },
      });
      expect(auditLogs.length).toBe(1);
    });
  });

  describe('3. Store Owner Login & Portal Isolation (Issue 3)', () => {
    let ownerPhone = null;
    let ownerEmail = null;
    let tenantSlug = null;
    let ownerSessionCookie = null;

    beforeAll(async () => {
      ownerPhone = `+91922${Math.floor(100000 + Math.random() * 900000)}`;
      ownerEmail = `owner_login_${testId}@myshop.com`;
      tenantSlug = `my-shop-${testId}`;

      // Provision and activate
      const tRes = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', [`bb_session=${superadminSessionToken}`])
        .set('Referer', 'http://localhost:5173')
        .send({
          legalName: `My Shop ${testId}`,
          slug: tenantSlug,
          ownerFullName: 'Vikram Seth',
          ownerPhone,
          ownerEmail,
        });

      createdTenantIds.push(tRes.body.data.tenant.id);
      const token = tRes.body.data.invitation.rawToken;

      const actRes = await request(app)
        .post('/api/auth/owner/activate')
        .set('Referer', 'http://localhost:5173')
        .send({
          token,
          password: ownerPassword,
        });

      createdUserIds.push(actRes.body.data.user.id);
    });

    it('rejects owner login with incorrect password', async () => {
      const res = await request(app)
        .post('/api/auth/owner/login')
        .set('Referer', 'http://localhost:5173')
        .send({
          identifier: ownerPhone,
          password: 'WrongPassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('allows owner login with phone and establishes TENANT session', async () => {
      const res = await request(app)
        .post('/api/auth/owner/login')
        .set('Referer', 'http://localhost:5173')
        .send({
          identifier: ownerPhone,
          password: ownerPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.user.phone).toBe(ownerPhone);
      expect(res.body.data.activeTenant.slug).toBe(tenantSlug);
      expect(res.body.data.tenantMemberships.length).toBeGreaterThanOrEqual(1);

      ownerSessionCookie = getSessionCookie(res);
      expect(ownerSessionCookie).toBeTruthy();
    });

    it('allows owner login with email and explicit tenantSlug', async () => {
      const res = await request(app)
        .post('/api/auth/owner/login')
        .set('Referer', 'http://localhost:5173')
        .send({
          identifier: ownerEmail,
          password: ownerPassword,
          tenantSlug,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.activeTenant.slug).toBe(tenantSlug);
    });

    it('rejects owner login for a store slug the owner does not belong to', async () => {
      const res = await request(app)
        .post('/api/auth/owner/login')
        .set('Referer', 'http://localhost:5173')
        .send({
          identifier: ownerEmail,
          password: ownerPassword,
          tenantSlug: 'nonexistent-store-slug',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('enforces portal isolation: Store Owner is blocked from Superadmin routes', async () => {
      const res = await request(app)
        .get('/api/platform/tenants')
        .set('Cookie', [ownerSessionCookie]);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('enforces portal isolation: Superadmin is blocked from Store Owner routes', async () => {
      const res = await request(app)
        .get('/api/owner/overview')
        .set('Cookie', [`bb_session=${superadminSessionToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('Store Owner successfully accesses GET /api/owner/overview', async () => {
      const res = await request(app).get('/api/owner/overview').set('Cookie', [ownerSessionCookie]);

      expect(res.status).toBe(200);
      expect(res.body.data.tenant.slug).toBe(tenantSlug);
      expect(res.body.data.membership.role).toBe('STORE_OWNER');
      expect(res.body.data.user.phone).toBe(ownerPhone);
    });
  });

  describe('4. Invitation Lifecycle & Resending (Issue 4)', () => {
    let tenant = null;
    let initialToken = null;
    let phone = null;
    let email = null;

    beforeAll(async () => {
      phone = `+91933${Math.floor(100000 + Math.random() * 900000)}`;
      email = `reissue_${testId}@lifecycle.com`;

      const res = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', [`bb_session=${superadminSessionToken}`])
        .set('Referer', 'http://localhost:5173')
        .send({
          legalName: `Lifecycle Store ${testId}`,
          slug: `lifecycle-${testId}`,
          ownerFullName: 'Meera Rao',
          ownerPhone: phone,
          ownerEmail: email,
        });

      tenant = res.body.data.tenant;
      initialToken = res.body.data.invitation.rawToken;
      createdTenantIds.push(tenant.id);
    });

    it('POST /api/platform/tenants/:tenantId/invitations/resend supersedes old invitation and issues valid new token', async () => {
      const resendRes = await request(app)
        .post(`/api/platform/tenants/${tenant.id}/invitations/resend`)
        .set('Cookie', [`bb_session=${superadminSessionToken}`])
        .set('Referer', 'http://localhost:5173');

      expect(resendRes.status).toBe(200);
      const newToken = resendRes.body.data.invitation.rawToken;
      expect(newToken).toBeTruthy();
      expect(newToken).not.toBe(initialToken);
      expect(resendRes.body.data.invitation.activationUrl).toContain(
        `/owner/activate#token=${newToken}`
      );

      // Verify the OLD invitation token is now SUPERSEDED
      const validateOldRes = await request(app)
        .post('/api/auth/owner/invitation/validate')
        .set('Referer', 'http://localhost:5173')
        .send({ token: initialToken });

      expect(validateOldRes.status).toBe(410);
      expect(validateOldRes.body.code).toBe('INVITATION_SUPERSEDED');

      // Verify attempting to activate with the OLD token is rejected
      const activateOldRes = await request(app)
        .post('/api/auth/owner/activate')
        .set('Referer', 'http://localhost:5173')
        .send({
          token: initialToken,
          password: ownerPassword,
        });

      expect(activateOldRes.status).toBe(410);
      expect(activateOldRes.body.code).toBe('INVITATION_SUPERSEDED');

      // Verify the NEW invitation token validates successfully
      const validateNewRes = await request(app)
        .post('/api/auth/owner/invitation/validate')
        .set('Referer', 'http://localhost:5173')
        .send({ token: newToken });

      expect(validateNewRes.status).toBe(200);
      expect(validateNewRes.body.data.valid).toBe(true);

      // Verify activation with the NEW token succeeds
      const activateNewRes = await request(app)
        .post('/api/auth/owner/activate')
        .set('Referer', 'http://localhost:5173')
        .send({
          token: newToken,
          password: ownerPassword,
        });

      expect(activateNewRes.status).toBe(200);
      expect(activateNewRes.body.data.user.phone).toBe(phone);
      createdUserIds.push(activateNewRes.body.data.user.id);

      // Verify invitation history in GET /api/platform/tenants/:tenantId
      const detailRes = await request(app)
        .get(`/api/platform/tenants/${tenant.id}`)
        .set('Cookie', [`bb_session=${superadminSessionToken}`]);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.data.invitationHistory.length).toBe(2);
      expect(detailRes.body.data.invitationHistory[0].status).toBe('ACCEPTED');
      expect(detailRes.body.data.invitationHistory[1].status).toBe('SUPERSEDED');

      // Cannot resend after activation
      const cannotResendRes = await request(app)
        .post(`/api/platform/tenants/${tenant.id}/invitations/resend`)
        .set('Cookie', [`bb_session=${superadminSessionToken}`])
        .set('Referer', 'http://localhost:5173');

      expect(cannotResendRes.status).toBe(400);
      expect(cannotResendRes.body.code).toBe('INVITATION_ALREADY_ACCEPTED');
    });

    it('rejects resend for non-existent tenant with 404', async () => {
      const res = await request(app)
        .post('/api/platform/tenants/00000000-0000-4000-8000-000000000000/invitations/resend')
        .set('Cookie', [`bb_session=${superadminSessionToken}`])
        .set('Referer', 'http://localhost:5173');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('TENANT_NOT_FOUND');
    });
  });

  describe('5. Phone & Email Normalization, Ambiguous Matching & E2E Onboarding Flow (Section 3-7)', () => {
    const sectionTestId = Date.now();
    const e2ePassword = 'E2E@OwnerSecurePass2026!';
    const raw10DigitPhone = `982${Math.floor(1000000 + Math.random() * 9000000)}`;
    const e164Phone = `+91${raw10DigitPhone}`;
    const e2eEmail = `e2e_owner_${sectionTestId}@freshgrocers.in`;
    const e2eSlug = `e2e-grocers-${sectionTestId}`;

    let e2eTenant = null;
    let e2eRawToken = null;
    let e2eUserId = null;

    it('Step 1-3: Provisions tenant and activates owner using password', async () => {
      // 1. Create tenant
      const createRes = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', [`bb_session=${superadminSessionToken}`])
        .set('Referer', 'http://localhost:5173')
        .send({
          legalName: `E2E Grocers Ltd ${sectionTestId}`,
          tradeName: 'Fresh Grocers',
          slug: e2eSlug,
          ownerFullName: 'Ananya Sharma',
          ownerPhone: e164Phone,
          ownerEmail: e2eEmail,
        });

      expect(createRes.status).toBe(201);
      e2eTenant = createRes.body.data.tenant;
      e2eRawToken = createRes.body.data.invitation.rawToken;
      createdTenantIds.push(e2eTenant.id);

      // 2. Validate token
      const valRes = await request(app)
        .post('/api/auth/owner/invitation/validate')
        .set('Referer', 'http://localhost:5173')
        .send({ token: e2eRawToken });

      expect(valRes.status).toBe(200);
      expect(valRes.body.data.valid).toBe(true);

      // 3. Activate owner using password
      const actRes = await request(app)
        .post('/api/auth/owner/activate')
        .set('Referer', 'http://localhost:5173')
        .send({
          token: e2eRawToken,
          password: e2ePassword,
        });

      expect(actRes.status).toBe(200);
      expect(actRes.body.data.user.phone).toBe(e164Phone);
      expect(actRes.body.data.activeTenant.slug).toBe(e2eSlug);
      e2eUserId = actRes.body.data.user.id;
      createdUserIds.push(e2eUserId);
    });

    it('Step 4-8: Logs out and logs in using 10-digit domestic phone (without +91), formatted phone, and verifies /api/owner/overview', async () => {
      // 5a. Login with 10-digit phone number without +91
      const login10Res = await request(app)
        .post('/api/auth/owner/login')
        .set('Referer', 'http://localhost:5173')
        .send({
          identifier: raw10DigitPhone,
          password: e2ePassword,
          tenantSlug: e2eSlug,
        });

      expect(login10Res.status).toBe(200);
      expect(login10Res.body.data.user.phone).toBe(e164Phone);
      expect(login10Res.body.data.activeTenant.slug).toBe(e2eSlug);

      const sessionCookie1 = getSessionCookie(login10Res);
      expect(sessionCookie1).toBeTruthy();

      // Verify access to /api/owner/overview
      const overviewRes1 = await request(app)
        .get('/api/owner/overview')
        .set('Cookie', [sessionCookie1]);

      expect(overviewRes1.status).toBe(200);
      expect(overviewRes1.body.data.tenant.slug).toBe(e2eSlug);
      expect(overviewRes1.body.data.membership.role).toBe('STORE_OWNER');

      // 5b. Login with formatted phone number with spaces and leading zero
      const formattedPhone = `0${raw10DigitPhone}`;
      const loginFormattedRes = await request(app)
        .post('/api/auth/owner/login')
        .set('Referer', 'http://localhost:5173')
        .send({
          identifier: formattedPhone,
          password: e2ePassword,
        });

      expect(loginFormattedRes.status).toBe(200);
      expect(loginFormattedRes.body.data.user.phone).toBe(e164Phone);

      // 5c. Login with spaced formatted number
      const spacedPhone = ` +91 ${raw10DigitPhone.slice(0, 5)} ${raw10DigitPhone.slice(5)} `;
      const loginSpacedRes = await request(app)
        .post('/api/auth/owner/login')
        .set('Referer', 'http://localhost:5173')
        .send({
          identifier: spacedPhone,
          password: e2ePassword,
        });

      expect(loginSpacedRes.status).toBe(200);
      expect(loginSpacedRes.body.data.user.phone).toBe(e164Phone);
    });

    it('Step 9-10: Logs out, logs in with email, and verifies another store cannot be accessed without membership', async () => {
      // 9. Login with uppercase email
      const upperEmail = e2eEmail.toUpperCase();
      const loginEmailRes = await request(app)
        .post('/api/auth/owner/login')
        .set('Referer', 'http://localhost:5173')
        .send({
          identifier: `  ${upperEmail}  `,
          password: e2ePassword,
        });

      expect(loginEmailRes.status).toBe(200);
      expect(loginEmailRes.body.data.user.email).toBe(e2eEmail);
      expect(loginEmailRes.body.data.activeTenant.slug).toBe(e2eSlug);

      // 10. Cannot access another store slug without membership
      const otherStoreRes = await request(app)
        .post('/api/auth/owner/login')
        .set('Referer', 'http://localhost:5173')
        .send({
          identifier: e2eEmail,
          password: e2ePassword,
          tenantSlug: 'unauthorized-other-store',
        });

      expect(otherStoreRes.status).toBe(403);
      expect(otherStoreRes.body.code).toBe('FORBIDDEN');
    });

    it('Activation rejects ambiguous identity conflict when phone and email belong to different accounts with 409', async () => {
      const userAPhone = `+91971${Math.floor(100000 + Math.random() * 900000)}`;
      const userAEmail = `user_a_${sectionTestId}@conflict.test`;
      const userBPhone = `+91972${Math.floor(100000 + Math.random() * 900000)}`;
      const userBEmail = `user_b_${sectionTestId}@conflict.test`;
      const passHash = await hashPassword('SampleConflictPass123!');

      // Create User A
      const userA = await prisma.user.create({
        data: {
          fullName: 'Conflict User A',
          phone: userAPhone,
          email: userAEmail,
          passwordHash: passHash,
          status: 'ACTIVE',
        },
      });
      createdUserIds.push(userA.id);

      // Create User B
      const userB = await prisma.user.create({
        data: {
          fullName: 'Conflict User B',
          phone: userBPhone,
          email: userBEmail,
          passwordHash: passHash,
          status: 'ACTIVE',
        },
      });
      createdUserIds.push(userB.id);

      // Create tenant nominated with User A's phone and User B's email
      const conflictTenantRes = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', [`bb_session=${superadminSessionToken}`])
        .set('Referer', 'http://localhost:5173')
        .send({
          legalName: `Conflict Tenant ${sectionTestId}`,
          slug: `conflict-${sectionTestId}`,
          ownerFullName: 'Conflicted Owner',
          ownerPhone: userAPhone,
          ownerEmail: userBEmail,
        });

      expect(conflictTenantRes.status).toBe(201);
      const conflictToken = conflictTenantRes.body.data.invitation.rawToken;
      createdTenantIds.push(conflictTenantRes.body.data.tenant.id);

      // Activating with conflicting identity must fail with 409 IDENTITY_CONFLICT
      const conflictActRes = await request(app)
        .post('/api/auth/owner/activate')
        .set('Referer', 'http://localhost:5173')
        .send({
          token: conflictToken,
          password: 'NewStorePass123!',
        });

      expect(conflictActRes.status).toBe(409);
      expect(conflictActRes.body.code).toBe('IDENTITY_CONFLICT');
    });

    it('Safe server-side diagnostics: returns generic 401 when user not found, without leaking user enumeration', async () => {
      const nonExistentPhone = '9991112233';
      const res = await request(app)
        .post('/api/auth/owner/login')
        .set('Referer', 'http://localhost:5173')
        .send({
          identifier: nonExistentPhone,
          password: 'AnyPassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(res.body.message).toBe('Invalid credentials');
    });

    it('Safe server-side diagnostics: returns 403 when store is suspended', async () => {
      // Suspend e2eTenant
      await prisma.tenant.update({
        where: { id: e2eTenant.id },
        data: { status: 'SUSPENDED' },
      });

      const res = await request(app)
        .post('/api/auth/owner/login')
        .set('Referer', 'http://localhost:5173')
        .send({
          identifier: raw10DigitPhone,
          password: e2ePassword,
          tenantSlug: e2eSlug,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_SUSPENDED');

      // Restore to ACTIVE
      await prisma.tenant.update({
        where: { id: e2eTenant.id },
        data: { status: 'ACTIVE' },
      });
    });
  });
});
