import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { hashPassword, hashToken, generateOpaqueToken } from '../src/utils/security.js';
import { withTestAuditCleanup } from './helpers/testCleanup.js';
import * as authService from '../src/services/auth.service.js';
import {
  AUDIT_MODULES,
  AUDIT_EVENT_TYPES,
  AUDIT_ACTIONS,
  AUDIT_STATUS,
} from '@billingbuddy/shared';

describe('Module 3.2.1: Authentication Audit Event Instrumentation', () => {
  const testId = Date.now();
  const superadminPhone = `+91850${Math.floor(100000 + Math.random() * 900000)}`;
  const superadminEmail = `superadmin_${testId}@billingbuddy.com`;
  const superadminPassword = 'AuditAdminPass2026!';

  const ownerPhone = `+91960${Math.floor(100000 + Math.random() * 900000)}`;
  const ownerEmail = `owner_${testId}@storetest.com`;
  const ownerPassword = 'StoreOwnerPass2026!';

  const ALLOWED_ORIGIN = 'http://localhost:5173';

  let superadminUser = null;
  let ownerUser = null;
  let activeTenant = null;
  let suspendedTenant = null;
  let suspendedOwnerUser = null;
  let suspendedUser = null;

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
    // 1. Create Superadmin User
    const superadminHash = await hashPassword(superadminPassword);
    superadminUser = await prisma.user.create({
      data: {
        fullName: 'Audit Superadmin Tester',
        phone: superadminPhone,
        email: superadminEmail,
        passwordHash: superadminHash,
        status: 'ACTIVE',
        mustChangePassword: false,
        platformAuthorization: {
          create: {
            role: 'SUPERADMIN',
            status: 'ACTIVE',
          },
        },
      },
    });

    // 2. Create Active Tenant & Store Owner
    const ownerHash = await hashPassword(ownerPassword);
    activeTenant = await prisma.tenant.create({
      data: {
        slug: `audit-store-${testId}`,
        legalName: 'Audit Active Store Ltd',
        status: 'ACTIVE',
      },
    });

    ownerUser = await prisma.user.create({
      data: {
        fullName: 'Audit Store Owner',
        phone: ownerPhone,
        email: ownerEmail,
        passwordHash: ownerHash,
        status: 'ACTIVE',
        tenantMemberships: {
          create: {
            tenantId: activeTenant.id,
            role: 'STORE_OWNER',
            status: 'ACTIVE',
          },
        },
      },
    });

    // 3. Create Suspended Tenant & Store Owner
    suspendedTenant = await prisma.tenant.create({
      data: {
        slug: `audit-suspended-store-${testId}`,
        legalName: 'Audit Suspended Store Ltd',
        status: 'SUSPENDED',
      },
    });

    suspendedOwnerUser = await prisma.user.create({
      data: {
        fullName: 'Suspended Store Owner',
        phone: `+91970${Math.floor(100000 + Math.random() * 900000)}`,
        email: `suspended_owner_${testId}@storetest.com`,
        passwordHash: ownerHash,
        status: 'ACTIVE',
        tenantMemberships: {
          create: {
            tenantId: suspendedTenant.id,
            role: 'STORE_OWNER',
            status: 'ACTIVE',
          },
        },
      },
    });

    // 4. Create Suspended User
    suspendedUser = await prisma.user.create({
      data: {
        fullName: 'Suspended User',
        phone: `+91980${Math.floor(100000 + Math.random() * 900000)}`,
        email: `suspended_user_${testId}@billingbuddy.com`,
        passwordHash: superadminHash,
        status: 'SUSPENDED',
      },
    });
  });

  afterAll(async () => {
    await withTestAuditCleanup(async () => {
      const userIds = [
        superadminUser?.id,
        ownerUser?.id,
        suspendedOwnerUser?.id,
        suspendedUser?.id,
      ].filter(Boolean);

      if (userIds.length > 0) {
        await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      }

      if (userIds.length > 0) {
        await prisma.auditLog.deleteMany({
          where: {
            OR: [
              { actorUserId: { in: userIds } },
              { targetTenantId: { in: [activeTenant?.id, suspendedTenant?.id].filter(Boolean) } },
            ],
          },
        });
      }

      if (userIds.length > 0) {
        await prisma.tenantMembership.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.platformAuthorization.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }

      if (activeTenant) {
        await prisma.tenant.delete({ where: { id: activeTenant.id } }).catch(() => {});
      }
      if (suspendedTenant) {
        await prisma.tenant.delete({ where: { id: suspendedTenant.id } }).catch(() => {});
      }
    });
  });

  describe('1. Superadmin Authentication Audit Events', () => {
    it('records SUPERADMIN_LOGIN_SUCCESS with actorUserId on valid credentials', async () => {
      const beforeCount = await prisma.auditLog.count({
        where: {
          action: AUDIT_ACTIONS.SUPERADMIN_LOGIN_SUCCESS,
          actorUserId: superadminUser.id,
        },
      });

      const res = await request(app)
        .post('/api/auth/superadmin/login')
        .send({
          identifier: superadminEmail,
          password: superadminPassword,
        });

      expect(res.status).toBe(200);

      const afterLogs = await prisma.auditLog.findMany({
        where: {
          action: AUDIT_ACTIONS.SUPERADMIN_LOGIN_SUCCESS,
          actorUserId: superadminUser.id,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(afterLogs.length).toBe(beforeCount + 1);
      const audit = afterLogs[0];
      expect(audit.module).toBe(AUDIT_MODULES.AUTH);
      expect(audit.eventType).toBe(AUDIT_EVENT_TYPES.SECURITY_AUTH);
      expect(audit.status).toBe(AUDIT_STATUS.SUCCESS);
      expect(audit.actorRole).toBe('SUPERADMIN');
      expect(audit.resourceType).toBe('SESSION');
      expect(audit.resourceId).toBeTruthy();
      expect(audit.metadata).toBeDefined();
      expect(audit.metadata.identifier).toBe(authService.maskIdentifier(superadminEmail));
      expect(JSON.stringify(audit.metadata)).not.toContain(superadminPassword);
    });

    it('records SUPERADMIN_LOGIN_FAILED with actorUserId=null on invalid password', async () => {
      const maskedEmail = authService.maskIdentifier(superadminEmail);
      const beforeLogs = await prisma.auditLog.findMany({
        where: {
          action: AUDIT_ACTIONS.SUPERADMIN_LOGIN_FAILED,
          metadata: {
            path: ['identifier'],
            equals: maskedEmail,
          },
        },
      });

      const res = await request(app)
        .post('/api/auth/superadmin/login')
        .send({
          identifier: superadminEmail,
          password: 'CompletelyWrongPassword123!',
        });

      expect(res.status).toBe(401);

      const afterLogs = await prisma.auditLog.findMany({
        where: {
          action: AUDIT_ACTIONS.SUPERADMIN_LOGIN_FAILED,
          metadata: {
            path: ['identifier'],
            equals: maskedEmail,
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(afterLogs.length).toBe(beforeLogs.length + 1);
      const audit = afterLogs[0];
      expect(audit.actorUserId).toBeNull(); // Must NOT fabricate actor identity
      expect(audit.status).toBe(AUDIT_STATUS.FAILURE);
      expect(audit.metadata.identifier).toBe(maskedEmail);
      expect(audit.metadata.reason).toBe('INVALID_CREDENTIALS');
      expect(JSON.stringify(audit.metadata)).not.toContain('CompletelyWrongPassword123!');
    });

    it('records SUPERADMIN_LOGIN_FAILED with actorUserId=null on unknown user', async () => {
      const unknownEmail = `unknown_${Date.now()}@billingbuddy.com`;
      const res = await request(app)
        .post('/api/auth/superadmin/login')
        .send({
          identifier: unknownEmail,
          password: 'AnyPassword123!',
        });

      expect(res.status).toBe(401);

      const latestLog = await prisma.auditLog.findFirst({
        where: { action: AUDIT_ACTIONS.SUPERADMIN_LOGIN_FAILED },
        orderBy: { createdAt: 'desc' },
      });

      expect(latestLog.actorUserId).toBeNull();
      expect(latestLog.metadata.identifier).toBe(authService.maskIdentifier(unknownEmail));
      expect(latestLog.metadata.reason).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('2. Store Owner Authentication Audit Events', () => {
    it('records OWNER_LOGIN_SUCCESS with actorUserId and targetTenantId on valid login', async () => {
      const beforeCount = await prisma.auditLog.count({
        where: {
          action: AUDIT_ACTIONS.OWNER_LOGIN_SUCCESS,
          actorUserId: ownerUser.id,
        },
      });

      const res = await request(app)
        .post('/api/auth/owner/login')
        .send({
          identifier: ownerEmail,
          password: ownerPassword,
          tenantSlug: activeTenant.slug,
        });

      expect(res.status).toBe(200);

      const afterLogs = await prisma.auditLog.findMany({
        where: {
          action: AUDIT_ACTIONS.OWNER_LOGIN_SUCCESS,
          actorUserId: ownerUser.id,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(afterLogs.length).toBe(beforeCount + 1);
      const audit = afterLogs[0];
      expect(audit.actorRole).toBe('STORE_OWNER');
      expect(audit.targetTenantId).toBe(activeTenant.id);
      expect(audit.status).toBe(AUDIT_STATUS.SUCCESS);
      expect(audit.resourceType).toBe('SESSION');
      expect(audit.metadata.identifier).toBe(authService.maskIdentifier(ownerEmail));
      expect(audit.metadata.tenantSlug).toBe(activeTenant.slug);
    });

    it('records OWNER_LOGIN_FAILED with actorUserId=null on invalid password', async () => {
      const beforeCount = await prisma.auditLog.count({
        where: { action: AUDIT_ACTIONS.OWNER_LOGIN_FAILED },
      });

      const res = await request(app)
        .post('/api/auth/owner/login')
        .send({
          identifier: ownerEmail,
          password: 'WrongPassword999!',
        });

      expect(res.status).toBe(401);

      const afterCount = await prisma.auditLog.count({
        where: { action: AUDIT_ACTIONS.OWNER_LOGIN_FAILED },
      });

      expect(afterCount).toBe(beforeCount + 1);
      const audit = await prisma.auditLog.findFirst({
        where: { action: AUDIT_ACTIONS.OWNER_LOGIN_FAILED },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit.actorUserId).toBeNull();
      expect(audit.metadata.reason).toBe('INVALID_CREDENTIALS');
      expect(audit.metadata.identifier).toBe(authService.maskIdentifier(ownerEmail));
    });

    it('records OWNER_LOGIN_FAILED when tenant is suspended', async () => {
      const res = await request(app)
        .post('/api/auth/owner/login')
        .send({
          identifier: suspendedOwnerUser.email,
          password: ownerPassword,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_SUSPENDED');

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: AUDIT_ACTIONS.OWNER_LOGIN_FAILED,
          targetTenantId: suspendedTenant.id,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit.actorUserId).toBeNull();
      expect(audit.metadata.reason).toBe('TENANT_SUSPENDED');
    });
  });

  describe('3. Session Logout & Revocation Audit Events', () => {
    it('records SUPERADMIN_LOGOUT on successful superadmin logout', async () => {
      const loginRes = await request(app)
        .post('/api/auth/superadmin/login')
        .send({
          identifier: superadminEmail,
          password: superadminPassword,
        });

      const sessionCookie = extractSessionCookie(loginRes);
      expect(sessionCookie).toBeTruthy();

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', `bb_session=${sessionCookie}`)
        .send();

      expect(logoutRes.status).toBe(200);

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: AUDIT_ACTIONS.SUPERADMIN_LOGOUT,
          actorUserId: superadminUser.id,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit.status).toBe(AUDIT_STATUS.SUCCESS);
      expect(audit.metadata.revocationReason).toBe('USER_LOGOUT');
    });

    it('records OWNER_LOGOUT on successful owner logout', async () => {
      const loginRes = await request(app)
        .post('/api/auth/owner/login')
        .send({
          identifier: ownerEmail,
          password: ownerPassword,
        });

      const sessionCookie = extractSessionCookie(loginRes);
      expect(sessionCookie).toBeTruthy();

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', `bb_session=${sessionCookie}`)
        .send();

      expect(logoutRes.status).toBe(200);

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: AUDIT_ACTIONS.OWNER_LOGOUT,
          actorUserId: ownerUser.id,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit.status).toBe(AUDIT_STATUS.SUCCESS);
      expect(audit.targetTenantId).toBe(activeTenant.id);
    });

    it('records session revocation via authService.revokeSession helper', async () => {
      const token = generateOpaqueToken(32);
      const session = await prisma.session.create({
        data: {
          userId: superadminUser.id,
          sessionTokenHash: hashToken(token),
          sessionType: 'PLATFORM',
          idleExpiresAt: new Date(Date.now() + 3600000),
          absoluteExpiresAt: new Date(Date.now() + 86400000),
        },
      });

      await authService.revokeSession({
        sessionId: session.id,
        reason: 'SECURITY_INCIDENT_REVOCATION',
      });

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: AUDIT_ACTIONS.SUPERADMIN_SESSION_REVOKED,
          resourceId: session.id,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit.metadata.reason).toBe('SECURITY_INCIDENT_REVOCATION');
      expect(audit.metadata.revokedSessionUserId).toBe(superadminUser.id);
    });
  });

  describe('4. Middleware Session Security & Expiration Audit Events', () => {
    it('records SESSION_VALIDATION_FAILED when accessing protected route with revoked session', async () => {
      const token = generateOpaqueToken(32);
      const session = await prisma.session.create({
        data: {
          userId: superadminUser.id,
          sessionTokenHash: hashToken(token),
          sessionType: 'PLATFORM',
          revokedAt: new Date(),
          idleExpiresAt: new Date(Date.now() + 3600000),
          absoluteExpiresAt: new Date(Date.now() + 86400000),
        },
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `bb_session=${token}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('SESSION_INVALID');

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: AUDIT_ACTIONS.SESSION_VALIDATION_FAILED,
          resourceId: session.id,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit.actorUserId).toBeNull();
      expect(audit.metadata.sessionUserId).toBe(superadminUser.id);
      expect(audit.metadata.reason).toBe('SESSION_REVOKED');
    });

    it('records SESSION_EXPIRED when idle expiration has elapsed', async () => {
      const token = generateOpaqueToken(32);
      const session = await prisma.session.create({
        data: {
          userId: superadminUser.id,
          sessionTokenHash: hashToken(token),
          sessionType: 'PLATFORM',
          idleExpiresAt: new Date(Date.now() - 10000),
          absoluteExpiresAt: new Date(Date.now() + 86400000),
        },
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `bb_session=${token}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('SESSION_IDLE_EXPIRED');

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: AUDIT_ACTIONS.SESSION_EXPIRED,
          resourceId: session.id,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit.actorUserId).toBeNull();
      expect(audit.metadata.sessionUserId).toBe(superadminUser.id);
      expect(audit.metadata.reason).toBe('SESSION_IDLE_EXPIRED');
    });

    it('records SESSION_EXPIRED when absolute expiration has elapsed', async () => {
      const token = generateOpaqueToken(32);
      const session = await prisma.session.create({
        data: {
          userId: superadminUser.id,
          sessionTokenHash: hashToken(token),
          sessionType: 'PLATFORM',
          idleExpiresAt: new Date(Date.now() + 3600000),
          absoluteExpiresAt: new Date(Date.now() - 10000),
        },
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `bb_session=${token}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('SESSION_EXPIRED');

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: AUDIT_ACTIONS.SESSION_EXPIRED,
          resourceId: session.id,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit.actorUserId).toBeNull();
      expect(audit.metadata.sessionUserId).toBe(superadminUser.id);
      expect(audit.metadata.reason).toBe('SESSION_ABSOLUTE_EXPIRED');
    });

    it('records SESSION_VALIDATION_FAILED when user account is suspended', async () => {
      const token = generateOpaqueToken(32);
      const session = await prisma.session.create({
        data: {
          userId: suspendedUser.id,
          sessionTokenHash: hashToken(token),
          sessionType: 'PLATFORM',
          idleExpiresAt: new Date(Date.now() + 3600000),
          absoluteExpiresAt: new Date(Date.now() + 86400000),
        },
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `bb_session=${token}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('USER_INACTIVE');

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: AUDIT_ACTIONS.SESSION_VALIDATION_FAILED,
          resourceId: session.id,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit.actorUserId).toBeNull();
      expect(audit.metadata.sessionUserId).toBe(suspendedUser.id);
      expect(audit.metadata.reason).toBe('USER_INACTIVE');
    });

    it('records TENANT_ACCESS_DENIED in requireStoreOwner when accessing store with suspended tenant', async () => {
      const token = generateOpaqueToken(32);
      await prisma.session.create({
        data: {
          userId: suspendedOwnerUser.id,
          sessionTokenHash: hashToken(token),
          sessionType: 'TENANT',
          activeTenantId: suspendedTenant.id,
          idleExpiresAt: new Date(Date.now() + 3600000),
          absoluteExpiresAt: new Date(Date.now() + 86400000),
        },
      });

      const res = await request(app)
        .get('/api/owner/overview')
        .set('Cookie', `bb_session=${token}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_SUSPENDED');

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: AUDIT_ACTIONS.TENANT_ACCESS_DENIED,
          actorUserId: suspendedOwnerUser.id,
          targetTenantId: suspendedTenant.id,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit.actorRole).toBe('STORE_OWNER');
      expect(audit.status).toBe(AUDIT_STATUS.FAILURE);
      expect(audit.resourceType).toBe('TENANT');
      expect(audit.resourceId).toBe(suspendedTenant.id);
      expect(audit.metadata.reason).toBe('TENANT_SUSPENDED');
    });

    it('records SESSION_ROTATED when rotating session to fully authenticated', async () => {
      const oldToken = generateOpaqueToken(32);
      const oldSession = await prisma.session.create({
        data: {
          userId: superadminUser.id,
          sessionTokenHash: hashToken(oldToken),
          sessionType: 'PLATFORM',
          isSecondFactorPending: true,
          idleExpiresAt: new Date(Date.now() + 3600000),
          absoluteExpiresAt: new Date(Date.now() + 86400000),
        },
      });

      const rotated = await prisma.$transaction(async (tx) => {
        return authService.rotateSessionToFullyAuthenticated(
          tx,
          oldSession.id,
          superadminUser.id,
          '127.0.0.1',
          'test-agent',
          { isRecoveryCodeAckPending: false }
        );
      });

      expect(rotated.newSessionToken).toBeTruthy();

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: AUDIT_ACTIONS.SESSION_ROTATED,
          resourceId: rotated.newSessionId,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit.actorUserId).toBe(superadminUser.id);
      expect(audit.actorRole).toBe('SUPERADMIN');
      expect(audit.status).toBe(AUDIT_STATUS.SUCCESS);
      expect(audit.metadata.previousSessionId).toBe(oldSession.id);
    });
  });

  describe('5. CSRF Protection Audit Events', () => {
    it('records CSRF_VALIDATION_FAILED on state-mutating request with session cookie and disallowed origin', async () => {
      const token = generateOpaqueToken(32);
      await prisma.session.create({
        data: {
          userId: superadminUser.id,
          sessionTokenHash: hashToken(token),
          sessionType: 'PLATFORM',
          idleExpiresAt: new Date(Date.now() + 3600000),
          absoluteExpiresAt: new Date(Date.now() + 86400000),
        },
      });

      const beforeCount = await prisma.auditLog.count({
        where: { action: AUDIT_ACTIONS.CSRF_VALIDATION_FAILED },
      });

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `bb_session=${token}`)
        .set('Origin', 'http://malicious-attacker-site.com')
        .send();

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF_ORIGIN_INVALID');

      const afterCount = await prisma.auditLog.count({
        where: { action: AUDIT_ACTIONS.CSRF_VALIDATION_FAILED },
      });

      expect(afterCount).toBe(beforeCount + 1);
      const audit = await prisma.auditLog.findFirst({
        where: { action: AUDIT_ACTIONS.CSRF_VALIDATION_FAILED },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit.metadata.reason).toBe('CSRF_ORIGIN_INVALID');
      expect(audit.metadata.origin).toBe('http://malicious-attacker-site.com');
    });

    it('records CSRF_VALIDATION_FAILED when Origin and Referer and custom header are missing on cookie mutation', async () => {
      const token = generateOpaqueToken(32);
      await prisma.session.create({
        data: {
          userId: superadminUser.id,
          sessionTokenHash: hashToken(token),
          sessionType: 'PLATFORM',
          idleExpiresAt: new Date(Date.now() + 3600000),
          absoluteExpiresAt: new Date(Date.now() + 86400000),
        },
      });

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `bb_session=${token}`)
        .send();

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF_HEADER_MISSING');

      const audit = await prisma.auditLog.findFirst({
        where: { action: AUDIT_ACTIONS.CSRF_VALIDATION_FAILED },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit.metadata.reason).toBe('CSRF_HEADER_MISSING');
    });
  });

  describe('6. Zero Secret Leakage & Audit Sanitization Guarantee', () => {
    it('verifies metadata across all authentication audit events contains zero raw secrets or password hashes', async () => {
      const allAuthLogs = await prisma.auditLog.findMany({
        where: {
          module: AUDIT_MODULES.AUTH,
          eventType: AUDIT_EVENT_TYPES.SECURITY_AUTH,
        },
      });

      expect(allAuthLogs.length).toBeGreaterThan(0);

      for (const log of allAuthLogs) {
        const metadataStr = JSON.stringify(log.metadata || {});
        expect(metadataStr).not.toContain(superadminPassword);
        expect(metadataStr).not.toContain(ownerPassword);
        expect(metadataStr).not.toContain('CompletelyWrongPassword123!');
        expect(metadataStr).not.toContain('WrongPassword999!');
        expect(metadataStr).not.toContain('$2b$12$'); // No bcrypt hashes
      }
    });

    it('verifies activateOwnerInvitation masks phone and email in TENANT_ACTIVATED audit metadata (SEC-AUD-03)', async () => {
      const invitePhone = `+91999${Math.floor(100000 + Math.random() * 900000)}`;
      const inviteEmail = `invite_${Date.now()}@teststore.com`;
      const rawToken = generateOpaqueToken(32);
      const tokenHash = hashToken(rawToken);

      const invTenant = await prisma.tenant.create({
        data: {
          slug: `activation-audit-test-${Date.now()}`,
          legalName: 'Activation Masking Ltd',
          status: 'INVITED',
        },
      });

      const invitation = await prisma.ownerInvitation.create({
        data: {
          tenantId: invTenant.id,
          tokenHash,
          invitedPhone: invitePhone,
          invitedEmail: inviteEmail,
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      const activateRes = await request(app)
        .post('/api/auth/owner/activate')
        .set('Referer', 'http://localhost:5173')
        .send({
          token: rawToken,
          password: 'ActivationSecurePass2026!',
        });

      expect(activateRes.status).toBe(200);

      const audit = await prisma.auditLog.findFirst({
        where: {
          targetTenantId: invTenant.id,
          eventType: 'TENANT_ACTIVATED',
          action: 'ACTIVATE_TENANT',
        },
      });

      expect(audit).toBeTruthy();
      expect(audit.metadata.phone).not.toBe(invitePhone);
      expect(audit.metadata.phone).toBe(authService.maskIdentifier(invitePhone));
      expect(audit.metadata.email).not.toBe(inviteEmail);
      expect(audit.metadata.email).toBe(authService.maskIdentifier(inviteEmail));

      const rawMetadataStr = JSON.stringify(audit.metadata);
      expect(rawMetadataStr).not.toContain(invitePhone);
      expect(rawMetadataStr).not.toContain(inviteEmail);

      // Cleanup
      await withTestAuditCleanup(async () => {
        await prisma.auditLog.deleteMany({ where: { targetTenantId: invTenant.id } });
        await prisma.session.deleteMany({ where: { activeTenantId: invTenant.id } });
        await prisma.onboardingProgress.deleteMany({ where: { tenantId: invTenant.id } });
        await prisma.ownerInvitation.deleteMany({ where: { id: invitation.id } });
        await prisma.tenantMembership.deleteMany({ where: { tenantId: invTenant.id } });
        await prisma.tenant.delete({ where: { id: invTenant.id } });
        if (activateRes.body.data?.user?.id) {
          await prisma.auditLog.deleteMany({ where: { actorUserId: activateRes.body.data.user.id } });
          await prisma.user.delete({ where: { id: activateRes.body.data.user.id } });
        }
      });
    });
  });

  describe('8. SEC-AUD-04: Audit Persistence Atomicity & Consistency (ADR-010)', () => {
    it('rolls back session creation when audit logging fails during superadmin login', async () => {
      const auditService = await import('../src/services/audit.service.js');
      const originalRecordAuditEvent = auditService.recordAuditEvent;

      // Spy and reject recordAuditEvent when called inside loginSuperadmin transaction
      const recordSpy = vi.spyOn(auditService, 'recordAuditEvent').mockImplementation(async (args) => {
        if (args.action === AUDIT_ACTIONS.SUPERADMIN_LOGIN_SUCCESS) {
          throw new Error('Simulated Database Crash during Audit Log Persistence');
        }
        return originalRecordAuditEvent(args);
      });

      const sessionsBefore = await prisma.session.count({
        where: { userId: superadminUser.id },
      });

      const res = await request(app)
        .post('/api/auth/superadmin/login')
        .send({
          identifier: superadminEmail,
          password: superadminPassword,
        });

      recordSpy.mockRestore();

      // Request fails closed with 500 error because transaction rolled back
      expect(res.status).toBe(500);

      const sessionsAfter = await prisma.session.count({
        where: { userId: superadminUser.id },
      });

      // Assert complete atomicity: no orphaned session was created in the database
      expect(sessionsAfter).toBe(sessionsBefore);
    });

    it('rolls back session creation when audit logging fails during store owner login', async () => {
      const auditService = await import('../src/services/audit.service.js');
      const originalRecordAuditEvent = auditService.recordAuditEvent;

      const recordSpy = vi.spyOn(auditService, 'recordAuditEvent').mockImplementation(async (args) => {
        if (args.action === AUDIT_ACTIONS.OWNER_LOGIN_SUCCESS) {
          throw new Error('Simulated Database Crash during Audit Log Persistence');
        }
        return originalRecordAuditEvent(args);
      });

      const sessionsBefore = await prisma.session.count({
        where: { userId: ownerUser.id },
      });

      const res = await request(app)
        .post('/api/auth/owner/login')
        .send({
          identifier: ownerEmail,
          password: ownerPassword,
        });

      recordSpy.mockRestore();

      expect(res.status).toBe(500);

      const sessionsAfter = await prisma.session.count({
        where: { userId: ownerUser.id },
      });

      expect(sessionsAfter).toBe(sessionsBefore);
    });

    it('dedicated logout Case 1: missing cookie returns 401 without cookie clearance or audit log', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Origin', ALLOWED_ORIGIN)
        .send();

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');

      // No Set-Cookie header emitted when no cookie was sent
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeUndefined();
    });

    it('dedicated logout Case 2: malformed token returns 401, clears cookie, and records SESSION_VALIDATION_FAILED', async () => {
      const malformedToken = '!@#$%^&*()_+';

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', `bb_session=${malformedToken}`)
        .send();

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('SESSION_INVALID');

      // Assert expired Set-Cookie header is emitted to purge bad cookie from browser
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeTruthy();
      expect(setCookie[0]).toContain('bb_session=;');
      expect(setCookie[0]).toContain('Expires=Thu, 01 Jan 1970');

      // Assert standalone security rejection audit log recorded
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: AUDIT_ACTIONS.SESSION_VALIDATION_FAILED,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit.actorUserId).toBeNull();
      expect(audit.metadata.reason).toBe('MALFORMED_TOKEN');
    });

    it('dedicated logout Case 2: unknown token returns 401, clears cookie, and records SESSION_VALIDATION_FAILED', async () => {
      const unknownToken = generateOpaqueToken(32);

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', `bb_session=${unknownToken}`)
        .send();

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('SESSION_INVALID');

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeTruthy();
      expect(setCookie[0]).toContain('bb_session=;');
      expect(setCookie[0]).toContain('Expires=Thu, 01 Jan 1970');

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: AUDIT_ACTIONS.SESSION_VALIDATION_FAILED,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit.actorUserId).toBeNull();
      expect(audit.metadata.reason).toBe('SESSION_NOT_FOUND');
    });

    it('dedicated logout Case 3: already-revoked session returns 200, clears cookie, and skips duplicate audit logs', async () => {
      const revokedToken = generateOpaqueToken(32);
      const session = await prisma.session.create({
        data: {
          userId: superadminUser.id,
          sessionTokenHash: hashToken(revokedToken),
          sessionType: 'PLATFORM',
          revokedAt: new Date(),
          idleExpiresAt: new Date(Date.now() + 3600000),
          absoluteExpiresAt: new Date(Date.now() + 86400000),
        },
      });

      const auditCountBefore = await prisma.auditLog.count({
        where: { resourceId: session.id },
      });

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', `bb_session=${revokedToken}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Logged out successfully');

      // Assert cookie is cleared
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeTruthy();
      expect(setCookie[0]).toContain('bb_session=;');
      expect(setCookie[0]).toContain('Expires=Thu, 01 Jan 1970');

      // Assert zero duplicate audit events created
      const auditCountAfter = await prisma.auditLog.count({
        where: { resourceId: session.id },
      });
      expect(auditCountAfter).toBe(auditCountBefore);

      await withTestAuditCleanup(async () => {
        await prisma.session.delete({ where: { id: session.id } });
      });
    });

    it('concurrent logout requests guarantee exactly one audit log and both return idempotent 200', async () => {
      const testToken = generateOpaqueToken(32);
      const session = await prisma.session.create({
        data: {
          userId: superadminUser.id,
          sessionTokenHash: hashToken(testToken),
          sessionType: 'PLATFORM',
          idleExpiresAt: new Date(Date.now() + 3600000),
          absoluteExpiresAt: new Date(Date.now() + 86400000),
        },
      });

      // Fire two concurrent logout requests with the same session cookie
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/auth/logout')
          .set('Origin', ALLOWED_ORIGIN)
          .set('Cookie', `bb_session=${testToken}`)
          .send(),
        request(app)
          .post('/api/auth/logout')
          .set('Origin', ALLOWED_ORIGIN)
          .set('Cookie', `bb_session=${testToken}`)
          .send(),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Verify that exactly ONE USER_LOGGED_OUT audit event was inserted
      const logoutAudits = await prisma.auditLog.findMany({
        where: {
          resourceId: session.id,
          action: AUDIT_ACTIONS.SUPERADMIN_LOGOUT,
        },
      });
      expect(logoutAudits.length).toBe(1);

      await withTestAuditCleanup(async () => {
        await prisma.auditLog.deleteMany({ where: { resourceId: session.id } });
        await prisma.session.delete({ where: { id: session.id } });
      });
    });

    it('recordSecurityRejectionAuditSafe traps database errors and does not crash caller', async () => {
      const { recordSecurityRejectionAuditSafe } = await import('../src/services/audit.service.js');

      // Pass an invalid status that triggers schema validation failure inside recordAuditEvent
      const result = await recordSecurityRejectionAuditSafe({
        action: AUDIT_ACTIONS.SESSION_VALIDATION_FAILED,
        reason: 'TEST_REJECTION_FAILURE',
        actorUserId: 'invalid-non-uuid-actor-id-format',
      });

      // Should return null and not throw
      expect(result).toBeNull();
    });
  });
});
