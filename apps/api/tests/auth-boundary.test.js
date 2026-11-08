import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { hashPassword, hashToken, generateOpaqueToken } from '../src/utils/security.js';

describe('Backend Authentication & Authorization Boundary (BB-WP02)', () => {
  const testId = Date.now();
  const testPassword = 'AuthBoundary@Pass2026!';

  let superadminUser = null;
  let superadminToken = null;

  let ownerUser = null;
  let ownerToken = null;

  let suspendedMembershipUser = null;
  let suspendedMembershipToken = null;

  let suspendedTenantUser = null;
  let suspendedTenantToken = null;

  let activeTenant = null;
  let suspendedTenant = null;

  const createdUserIds = [];
  const createdTenantIds = [];

  async function createSession(
    userId,
    {
      sessionType = 'PLATFORM',
      activeTenantId = null,
      idleOffsetMs = 30 * 60 * 1000,
      absOffsetMs = 12 * 60 * 60 * 1000,
      revoked = false,
    } = {}
  ) {
    const rawToken = generateOpaqueToken(32);
    const sessionTokenHash = hashToken(rawToken);
    const now = new Date();

    await prisma.session.create({
      data: {
        userId,
        sessionTokenHash,
        sessionType,
        activeTenantId,
        isSecondFactorPending: false,
        idleExpiresAt: new Date(now.getTime() + idleOffsetMs),
        absoluteExpiresAt: new Date(now.getTime() + absOffsetMs),
        revokedAt: revoked ? now : null,
        lastActivityAt: now,
      },
    });

    return rawToken;
  }

  beforeAll(async () => {
    const passwordHash = await hashPassword(testPassword);

    // 1. Create Platform Superadmin
    superadminUser = await prisma.user.create({
      data: {
        fullName: 'Platform Superadmin Boundary Test',
        email: `boundary_superadmin_${testId}@billingbuddy.com`,
        phone: `+91851${Math.floor(100000 + Math.random() * 900000)}`,
        passwordHash,
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
    createdUserIds.push(superadminUser.id);
    superadminToken = await createSession(superadminUser.id, { sessionType: 'PLATFORM' });

    // 2. Create Active Tenant & Active Store Owner
    activeTenant = await prisma.tenant.create({
      data: {
        slug: `boundary-active-store-${testId}`,
        legalName: 'Boundary Active Store Pvt Ltd',
        tradeName: 'Boundary Active Store',
        status: 'ACTIVE',
      },
    });
    createdTenantIds.push(activeTenant.id);

    ownerUser = await prisma.user.create({
      data: {
        fullName: 'Active Store Owner',
        email: `boundary_owner_${testId}@example.com`,
        phone: `+91852${Math.floor(100000 + Math.random() * 900000)}`,
        passwordHash,
        status: 'ACTIVE',
        mustChangePassword: false,
        tenantMemberships: {
          create: {
            tenantId: activeTenant.id,
            role: 'STORE_OWNER',
            status: 'ACTIVE',
          },
        },
      },
    });
    createdUserIds.push(ownerUser.id);
    ownerToken = await createSession(ownerUser.id, {
      sessionType: 'TENANT',
      activeTenantId: activeTenant.id,
    });

    // 3. Create Store Owner with SUSPENDED/INACTIVE Membership
    suspendedMembershipUser = await prisma.user.create({
      data: {
        fullName: 'Suspended Membership Owner',
        email: `suspended_mem_${testId}@example.com`,
        phone: `+91853${Math.floor(100000 + Math.random() * 900000)}`,
        passwordHash,
        status: 'ACTIVE',
        tenantMemberships: {
          create: {
            tenantId: activeTenant.id,
            role: 'STORE_OWNER',
            status: 'INACTIVE', // Inactive membership
          },
        },
      },
    });
    createdUserIds.push(suspendedMembershipUser.id);
    suspendedMembershipToken = await createSession(suspendedMembershipUser.id, {
      sessionType: 'TENANT',
      activeTenantId: activeTenant.id,
    });

    // 4. Create Suspended Tenant and associated Owner
    suspendedTenant = await prisma.tenant.create({
      data: {
        slug: `boundary-suspended-store-${testId}`,
        legalName: 'Boundary Suspended Store Ltd',
        status: 'SUSPENDED',
      },
    });
    createdTenantIds.push(suspendedTenant.id);

    suspendedTenantUser = await prisma.user.create({
      data: {
        fullName: 'Owner of Suspended Tenant',
        email: `suspended_tenant_owner_${testId}@example.com`,
        phone: `+91854${Math.floor(100000 + Math.random() * 900000)}`,
        passwordHash,
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
    createdUserIds.push(suspendedTenantUser.id);
    suspendedTenantToken = await createSession(suspendedTenantUser.id, {
      sessionType: 'TENANT',
      activeTenantId: suspendedTenant.id,
    });
  });

  afterAll(async () => {
    if (createdTenantIds.length > 0) {
      await prisma.session.deleteMany({ where: { activeTenantId: { in: createdTenantIds } } });
      await prisma.tenantMembership.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
      await prisma.ownerInvitation.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
      await prisma.onboardingProgress.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
      await prisma.auditLog.deleteMany({ where: { targetTenantId: { in: createdTenantIds } } });
      await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
      await prisma.platformAuthorization.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  // 1. Missing session receives 401
  it('returns 401 UNAUTHORIZED when no session token is provided', async () => {
    const resPlatform = await request(app).get('/api/platform/tenants');
    expect(resPlatform.status).toBe(401);
    expect(resPlatform.body.success).toBe(false);
    expect(resPlatform.body.code).toBe('UNAUTHORIZED');

    const resOwner = await request(app).get('/api/owner/overview');
    expect(resOwner.status).toBe(401);
    expect(resOwner.body.success).toBe(false);
    expect(resOwner.body.code).toBe('UNAUTHORIZED');
  });

  // 2. Invalid session receives 401
  it('returns 401 SESSION_INVALID when a tampered or invalid session token is provided', async () => {
    const res = await request(app)
      .get('/api/platform/tenants')
      .set('Cookie', 'bb_session=invalid-tampered-opaque-session-token');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('SESSION_INVALID');
  });

  // 3. Revoked session receives 401
  it('returns 401 SESSION_INVALID when session has been revoked', async () => {
    const revokedToken = await createSession(superadminUser.id, { revoked: true });

    const res = await request(app)
      .get('/api/platform/tenants')
      .set('Cookie', `bb_session=${revokedToken}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('SESSION_INVALID');
  });

  // 4. Idle expired session receives 401
  it('returns 401 SESSION_IDLE_EXPIRED when idle expiration window has elapsed', async () => {
    const idleExpiredToken = await createSession(superadminUser.id, { idleOffsetMs: -1000 });

    const res = await request(app)
      .get('/api/platform/tenants')
      .set('Cookie', `bb_session=${idleExpiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('SESSION_IDLE_EXPIRED');
  });

  // 5. Valid Superadmin session can access permitted Platform endpoints
  it('allows authenticated Superadmin to access "/api/platform/tenants"', async () => {
    const res = await request(app)
      .get('/api/platform/tenants')
      .set('Cookie', `bb_session=${superadminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data.tenants || res.body.data)).toBe(true);
  });

  // 6. Store Owner cannot access Superadmin endpoints (403 FORBIDDEN)
  it('returns 403 FORBIDDEN when a Store Owner tries to access Superadmin platform endpoints', async () => {
    const res = await request(app)
      .get('/api/platform/tenants')
      .set('Cookie', `bb_session=${ownerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(res.body.message).toMatch(/Superadmin privileges required/i);
  });

  // 7. Superadmin cannot access Store Owner endpoints (403 portal isolation)
  it('returns 403 FORBIDDEN when Superadmin attempts to access Store Owner endpoints', async () => {
    const res = await request(app)
      .get('/api/owner/overview')
      .set('Cookie', `bb_session=${superadminToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(res.body.message).toMatch(/Superadmins are not authorized to access Store Owner/i);
  });

  // 8. Valid Store Owner session can access permitted Owner endpoints
  it('allows authenticated Store Owner to access "/api/owner/overview"', async () => {
    const res = await request(app)
      .get('/api/owner/overview')
      .set('Cookie', `bb_session=${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tenant.slug).toBe(activeTenant.slug);
    expect(res.body.data.membership.role).toBe('STORE_OWNER');
    expect(res.body.data.membership.status).toBe('ACTIVE');
  });

  // 9. Suspended membership is rejected (403 MEMBERSHIP_INACTIVE)
  it('rejects access to store operations when user membership is inactive or suspended', async () => {
    const res = await request(app)
      .get('/api/owner/overview')
      .set('Cookie', `bb_session=${suspendedMembershipToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('MEMBERSHIP_INACTIVE');
  });

  // 10. Suspended tenant organization is rejected (403 TENANT_SUSPENDED)
  it('rejects access to store operations when tenant organization is suspended', async () => {
    const res = await request(app)
      .get('/api/owner/overview')
      .set('Cookie', `bb_session=${suspendedTenantToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('TENANT_SUSPENDED');
  });

  // 11. GET /api/auth/me returns identity, session, platformRole, activeTenant, and tenantMemberships
  it('returns full identity, session, role, and tenant context from "/api/auth/me"', async () => {
    // For Superadmin
    const saRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `bb_session=${superadminToken}`);

    expect(saRes.status).toBe(200);
    expect(saRes.body.data.platformRole).toBe('SUPERADMIN');
    expect(saRes.body.data.user.email).toBe(superadminUser.email);
    expect(saRes.body.data.session.sessionType).toBe('PLATFORM');

    // For Store Owner
    const ownerRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `bb_session=${ownerToken}`);

    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.data.platformRole).toBeNull();
    expect(ownerRes.body.data.activeTenant.id).toBe(activeTenant.id);
    expect(ownerRes.body.data.tenantMemberships[0].role).toBe('STORE_OWNER');
  });
});
