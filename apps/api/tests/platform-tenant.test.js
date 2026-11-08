import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { hashPassword, hashToken, generateOpaqueToken } from '../src/utils/security.js';
import { createTenant } from '../src/services/tenant.service.js';

describe('Tenant Creation, Listing & Detail API (ADR-002 / WP-02.04D)', () => {
  const testId = Date.now();
  const validPassword = 'SuperAdmin@TestPass2026!';

  let superadminUser = null;
  let superadminToken = null;

  let pending2faUser = null;
  let pending2faToken = null;

  let mustChangePwdUser = null;
  let mustChangePwdToken = null;

  let regularUser = null;
  let regularUserToken = null;

  const createdTenantIds = [];
  const createdUserIds = [];

  // Helper to create an active authenticated session
  async function createSession(userId, { isSecondFactorPending = false } = {}) {
    const rawToken = generateOpaqueToken(32);
    const sessionTokenHash = hashToken(rawToken);
    const now = new Date();

    await prisma.session.create({
      data: {
        userId,
        sessionTokenHash,
        sessionType: 'PLATFORM',
        isSecondFactorPending,
        idleExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
        lastActivityAt: now,
      },
    });

    return rawToken;
  }

  beforeAll(async () => {
    const passwordHash = await hashPassword(validPassword);

    // 1. Fully qualified Superadmin
    superadminUser = await prisma.user.create({
      data: {
        fullName: 'Superadmin Slice Auditor',
        phone: `+91848${Math.floor(100000 + Math.random() * 900000)}`,
        email: `superadmin_slice_${testId}@billingbuddy.com`,
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
    superadminToken = await createSession(superadminUser.id);

    // 2. Superadmin with second-factor pending
    pending2faUser = await prisma.user.create({
      data: {
        fullName: 'Pending 2FA Superadmin',
        phone: `+91849${Math.floor(100000 + Math.random() * 900000)}`,
        email: `pending2fa_${testId}@billingbuddy.com`,
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
    createdUserIds.push(pending2faUser.id);
    pending2faToken = await createSession(pending2faUser.id, { isSecondFactorPending: true });

    // 3. Superadmin with mustChangePassword = true
    mustChangePwdUser = await prisma.user.create({
      data: {
        fullName: 'Must Change Pwd Superadmin',
        phone: `+91850${Math.floor(100000 + Math.random() * 900000)}`,
        email: `mustchange_${testId}@billingbuddy.com`,
        passwordHash,
        status: 'ACTIVE',
        mustChangePassword: true,
        platformAuthorization: {
          create: {
            role: 'SUPERADMIN',
            status: 'ACTIVE',
          },
        },
      },
    });
    createdUserIds.push(mustChangePwdUser.id);
    mustChangePwdToken = await createSession(mustChangePwdUser.id);

    // 4. Regular non-admin user
    regularUser = await prisma.user.create({
      data: {
        fullName: 'Regular Non-Admin User',
        phone: `+91851${Math.floor(100000 + Math.random() * 900000)}`,
        email: `regular_${testId}@billingbuddy.com`,
        passwordHash,
        status: 'ACTIVE',
        mustChangePassword: false,
      },
    });
    createdUserIds.push(regularUser.id);
    regularUserToken = await createSession(regularUser.id);
  });

  afterAll(async () => {
    // Clean up created test tenants (cascades to invitations & onboarding)
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.tenant.delete({ where: { id: tenantId } });
      } catch {
        // Ignored
      }
    }
    // Clean up created test users (cascades to sessions)
    for (const userId of createdUserIds) {
      try {
        await prisma.user.delete({ where: { id: userId } });
      } catch {
        // Ignored
      }
    }
  });

  describe('1. Security & Middleware Pipeline Enforcement (POST /tenants)', () => {
    const validPayload = {
      legalName: 'Apex Electronics Pvt Ltd',
      tradeName: 'Apex Mart',
      slug: `apex-mart-${testId}`,
      ownerFullName: 'Rajesh Kumar',
      ownerPhone: '+919876543210',
      ownerEmail: 'rajesh@apexelectronics.com',
    };

    it('rejects unauthenticated request with HTTP 401', async () => {
      const res = await request(app).post('/api/platform/tenants').send(validPayload);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('rejects non-superadmin user with HTTP 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${regularUserToken}`)
        .set('Origin', 'http://localhost:5173')
        .send(validPayload);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('rejects superadmin when second-factor is pending with HTTP 403 SECOND_FACTOR_REQUIRED', async () => {
      const res = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${pending2faToken}`)
        .set('Origin', 'http://localhost:5173')
        .send(validPayload);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('SECOND_FACTOR_REQUIRED');
    });

    it('rejects superadmin when mustChangePassword is true with HTTP 403 PASSWORD_CHANGE_REQUIRED', async () => {
      const res = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${mustChangePwdToken}`)
        .set('Origin', 'http://localhost:5173')
        .send(validPayload);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    });

    it('rejects cookie-authenticated mutation without CSRF Origin, Referer, or custom header with HTTP 403', async () => {
      const res = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`)
        .send(validPayload);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toMatch(/^CSRF_/);
    });

    it('rejects cookie-authenticated mutation with invalid/disallowed Origin with HTTP 403', async () => {
      const res = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`)
        .set('Origin', 'https://malicious-phishing-site.com')
        .send(validPayload);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('CSRF_ORIGIN_INVALID');
    });
  });

  describe('2. Validation & Request Normalization (POST /tenants)', () => {
    it('rejects payload with missing required fields with HTTP 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`)
        .set('Origin', 'http://localhost:5173')
        .send({
          legalName: '',
          slug: '',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid slug with uppercase letters or spaces with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`)
        .set('Origin', 'http://localhost:5173')
        .send({
          legalName: 'Invalid Slug Store',
          slug: 'Invalid Slug With Spaces!',
          ownerFullName: 'Rajesh Kumar',
          ownerPhone: '+919876543210',
          ownerEmail: 'rajesh@example.com',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid non-E.164 phone format with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`)
        .set('Origin', 'http://localhost:5173')
        .send({
          legalName: 'Invalid Phone Store',
          slug: `valid-slug-${testId}-phone`,
          ownerFullName: 'Rajesh Kumar',
          ownerPhone: '9876543210',
          ownerEmail: 'rajesh@example.com',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects malformed email with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`)
        .set('Origin', 'http://localhost:5173')
        .send({
          legalName: 'Invalid Email Store',
          slug: `valid-slug-${testId}-email`,
          ownerFullName: 'Rajesh Kumar',
          ownerPhone: '+919876543210',
          ownerEmail: 'not-a-valid-email',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('3. Successful Tenant Creation & Atomic Provisioning', () => {
    const slug = `pune-supermart-${testId}`;
    const payload = {
      legalName: 'Pune Supermart Enterprises Pvt Ltd',
      tradeName: 'Pune Supermart',
      slug,
      ownerFullName: 'Suresh Patil',
      ownerPhone: '+919123456789',
      ownerEmail: 'suresh@punesupermart.com',
    };

    let responseData = null;

    it('creates tenant with HTTP 201 and appropriate security headers', async () => {
      const res = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`)
        .set('Origin', 'http://localhost:5173')
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      expect(res.headers['cache-control']).toBe('no-store, no-cache, must-revalidate, private');
      expect(res.headers['pragma']).toBe('no-cache');
      expect(res.headers['referrer-policy']).toBe('no-referrer');

      responseData = res.body.data;
      createdTenantIds.push(responseData.tenant.id);

      expect(responseData.tenant).toHaveProperty('id');
      expect(responseData.tenant.slug).toBe(slug);
      expect(responseData.tenant.legalName).toBe(payload.legalName);
      expect(responseData.tenant.tradeName).toBe(payload.tradeName);
      expect(responseData.tenant.status).toBe('INVITED');

      expect(responseData.invitation).toHaveProperty('id');
      expect(responseData.invitation.status).toBe('INVITED_PENDING_ACCEPTANCE');
      expect(responseData.invitation.nominatedPhone).toBe(payload.ownerPhone);
      expect(responseData.invitation.nominatedEmail).toBe(payload.ownerEmail);
      expect(responseData.invitation).toHaveProperty('rawToken');
      expect(responseData.invitation.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

      expect(responseData.invitation.activationUrl).toMatch(
        /^http:\/\/localhost:5173\/owner\/activate#token=[A-Za-z0-9_-]{43}$/
      );
      expect(responseData.invitation.whatsappUrl).toMatch(/^https:\/\/wa\.me\/919123456789\?text=/);
      expect(responseData.invitation.whatsappUrl).toContain(encodeURIComponent('Pune Supermart'));

      expect(responseData.invitation).not.toHaveProperty('tokenHash');
      expect(responseData).not.toHaveProperty('tokenHash');
    });

    it('atomically creates Tenant record in PostgreSQL with status INVITED', async () => {
      const tenant = await prisma.tenant.findUnique({
        where: { id: responseData.tenant.id },
      });

      expect(tenant).not.toBeNull();
      expect(tenant.slug).toBe(slug);
      expect(tenant.status).toBe('INVITED');
      expect(tenant.legalName).toBe(payload.legalName);
      expect(tenant.tradeName).toBe(payload.tradeName);
    });

    it('atomically initializes OnboardingProgress at Step 1', async () => {
      const progress = await prisma.onboardingProgress.findUnique({
        where: { tenantId: responseData.tenant.id },
      });

      expect(progress).not.toBeNull();
      expect(progress.currentStep).toBe(1);
      expect(progress.isCompleted).toBe(false);
      expect(progress.stepData).toEqual({});
    });

    it('atomically creates OwnerInvitation with PENDING status and valid 12h expiry', async () => {
      const invitation = await prisma.ownerInvitation.findUnique({
        where: { id: responseData.invitation.id },
      });

      expect(invitation).not.toBeNull();
      expect(invitation.tenantId).toBe(responseData.tenant.id);
      expect(invitation.status).toBe('PENDING');
      expect(invitation.invitedPhone).toBe(payload.ownerPhone);
      expect(invitation.invitedEmail).toBe(payload.ownerEmail);
      expect(invitation.createdById).toBe(superadminUser.id);

      const createdTime = new Date(invitation.createdAt).getTime();
      const expiresTime = new Date(invitation.expiresAt).getTime();
      const durationHours = (expiresTime - createdTime) / (1000 * 60 * 60);
      expect(Math.round(durationHours)).toBe(12);

      expect(invitation.tokenHash).toMatch(/^[0-9a-f]{64}$/);

      const expectedHash = crypto
        .createHash('sha256')
        .update(responseData.invitation.rawToken)
        .digest('hex');
      expect(invitation.tokenHash).toBe(expectedHash);
      expect(JSON.stringify(invitation)).not.toContain(responseData.invitation.rawToken);
    });

    it('atomically records AuditLog with safe metadata and zero secret leakage', async () => {
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          targetTenantId: responseData.tenant.id,
          action: 'CREATE_TENANT',
        },
      });

      expect(auditLog).not.toBeNull();
      expect(auditLog.actorUserId).toBe(superadminUser.id);
      expect(auditLog.eventType).toBe('TENANT_CREATED');
      expect(auditLog.resourceType).toBe('TENANT');
      expect(auditLog.resourceId).toBe(responseData.tenant.id);

      const meta = auditLog.metadata;
      expect(meta.slug).toBe(slug);
      expect(meta.legalName).toBe(payload.legalName);
      expect(meta.tradeName).toBe(payload.tradeName);
      expect(meta.nominatedPhone).toBe(payload.ownerPhone);
      expect(meta.nominatedEmail).toBe(payload.ownerEmail);

      expect(JSON.stringify(meta)).not.toContain(responseData.invitation.rawToken);
      expect(JSON.stringify(meta)).not.toContain(responseData.invitation.tokenHash);
      expect(JSON.stringify(meta)).not.toContain('activationUrl');
      expect(JSON.stringify(meta)).not.toContain('whatsappUrl');
    });
  });

  describe('4. Duplicate Slug & Multi-Tenant Support & Rollback', () => {
    it('returns HTTP 409 SLUG_ALREADY_EXISTS when slug is already taken', async () => {
      const duplicateSlug = `dup-slug-${testId}`;
      const payload = {
        legalName: 'First Store Limited',
        slug: duplicateSlug,
        ownerFullName: 'Anil Sharma',
        ownerPhone: '+919988776655',
        ownerEmail: 'anil@firststore.com',
      };

      const firstRes = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`)
        .set('Origin', 'http://localhost:5173')
        .send(payload);

      expect(firstRes.status).toBe(201);
      createdTenantIds.push(firstRes.body.data.tenant.id);

      const secondRes = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`)
        .set('Origin', 'http://localhost:5173')
        .send({
          ...payload,
          legalName: 'Second Store Limited (Competing)',
        });

      expect(secondRes.status).toBe(409);
      expect(secondRes.body.success).toBe(false);
      expect(secondRes.body.code).toBe('SLUG_ALREADY_EXISTS');
      expect(secondRes.body.message).toMatch(/already exists/i);
    });

    it('permits nominating an owner phone/email already associated with another store', async () => {
      const sharedPhone = '+919876543219';
      const sharedEmail = 'multi_owner@example.com';

      const firstRes = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`)
        .set('Origin', 'http://localhost:5173')
        .send({
          legalName: 'Owner Store One Pvt Ltd',
          tradeName: 'Store One',
          slug: `multi-store-one-${testId}`,
          ownerFullName: 'Multi Store Owner',
          ownerPhone: sharedPhone,
          ownerEmail: sharedEmail,
        });

      expect(firstRes.status).toBe(201);
      createdTenantIds.push(firstRes.body.data.tenant.id);

      const secondRes = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`)
        .set('Origin', 'http://localhost:5173')
        .send({
          legalName: 'Owner Store Two Pvt Ltd',
          tradeName: 'Store Two',
          slug: `multi-store-two-${testId}`,
          ownerFullName: 'Multi Store Owner',
          ownerPhone: sharedPhone,
          ownerEmail: sharedEmail,
        });

      expect(secondRes.status).toBe(201);
      createdTenantIds.push(secondRes.body.data.tenant.id);

      expect(firstRes.body.data.tenant.id).not.toBe(secondRes.body.data.tenant.id);
      expect(firstRes.body.data.invitation.id).not.toBe(secondRes.body.data.invitation.id);
      expect(firstRes.body.data.invitation.nominatedPhone).toBe(sharedPhone);
      expect(secondRes.body.data.invitation.nominatedPhone).toBe(sharedPhone);
    });

    it('ignores __simulateFailure in HTTP payload and completes tenant creation successfully', async () => {
      const benignSlug = `benign-hook-${testId}`;
      const payload = {
        legalName: 'Benign Hook Store Limited',
        slug: benignSlug,
        ownerFullName: 'Benign Tester',
        ownerPhone: '+919111222444',
        ownerEmail: 'benign@example.com',
        __simulateFailure: true,
      };

      const res = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`)
        .set('Origin', 'http://localhost:5173')
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tenant.slug).toBe(benignSlug);
      createdTenantIds.push(res.body.data.tenant.id);

      const tenant = await prisma.tenant.findUnique({
        where: { slug: benignSlug },
      });
      expect(tenant).not.toBeNull();
    });

    it('atomically rolls back all writes if database operation fails (foreign key constraint violation)', async () => {
      const rollbackSlug = `rollback-fk-${testId}`;
      const nonExistentUserId = crypto.randomUUID();

      let thrownError = null;
      try {
        await createTenant({
          legalName: 'Rollback Store Limited',
          slug: rollbackSlug,
          ownerFullName: 'Rollback Tester',
          ownerPhone: '+919111222333',
          ownerEmail: 'rollback@example.com',
          actorUserId: nonExistentUserId,
        });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).not.toBeNull();
      // Prisma throws P2003 for foreign key constraint violation
      expect(thrownError.code).toBe('P2003');

      // Verify that earlier writes (Tenant, OnboardingProgress) were completely rolled back
      const tenant = await prisma.tenant.findUnique({
        where: { slug: rollbackSlug },
      });
      expect(tenant).toBeNull();

      const onboarding = await prisma.onboardingProgress.findFirst({
        where: { tenant: { slug: rollbackSlug } },
      });
      expect(onboarding).toBeNull();
    });
  });

  describe('5. Tenant Listing API (GET /api/platform/tenants)', () => {
    let seededTenant1 = null;
    let seededTenant2 = null;
    let seededTenant3 = null;

    beforeAll(async () => {
      // Seed 3 specific tenants for search and pagination verification
      const res1 = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`)
        .set('Origin', 'http://localhost:5173')
        .send({
          legalName: 'Listing Alpha Retail Ltd',
          tradeName: 'Alpha Mart',
          slug: `alpha-mart-${testId}`,
          ownerFullName: 'Alpha Owner',
          ownerPhone: '+919000000001',
          ownerEmail: 'alpha@example.com',
        });
      seededTenant1 = res1.body.data.tenant;
      createdTenantIds.push(seededTenant1.id);

      const res2 = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`)
        .set('Origin', 'http://localhost:5173')
        .send({
          legalName: 'Listing Beta Groceries Ltd',
          tradeName: 'Beta Fresh',
          slug: `beta-fresh-${testId}`,
          ownerFullName: 'Beta Owner',
          ownerPhone: '+919000000002',
          ownerEmail: 'beta@example.com',
        });
      seededTenant2 = res2.body.data.tenant;
      createdTenantIds.push(seededTenant2.id);

      const res3 = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`)
        .set('Origin', 'http://localhost:5173')
        .send({
          legalName: 'Listing Gamma Pharmacy Ltd',
          tradeName: 'Gamma Chemist',
          slug: `gamma-chemist-${testId}`,
          ownerFullName: 'Gamma Owner',
          ownerPhone: '+919000000003',
          ownerEmail: 'gamma@example.com',
        });
      seededTenant3 = res3.body.data.tenant;
      createdTenantIds.push(seededTenant3.id);
    });

    it('returns 200 with default pagination (page=1, limit=20) and security headers', async () => {
      const res = await request(app)
        .get('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.headers['cache-control']).toBe('no-store, no-cache, must-revalidate, private');
      expect(res.headers['pragma']).toBe('no-cache');

      expect(res.body.data).toHaveProperty('tenants');
      expect(Array.isArray(res.body.data.tenants)).toBe(true);
      expect(res.body.data.tenants.length).toBeGreaterThanOrEqual(3);

      expect(res.body.data.pagination).toEqual({
        page: 1,
        limit: 20,
        total: expect.any(Number),
        totalPages: expect.any(Number),
        hasNextPage: expect.any(Boolean),
        hasPrevPage: false,
      });
    });

    it('enforces pagination page limits and clamps limit to maximum 50', async () => {
      // Invalid page < 1 returns 400
      const errRes = await request(app)
        .get('/api/platform/tenants?page=0')
        .set('Cookie', `bb_session=${superadminToken}`);
      expect(errRes.status).toBe(400);
      expect(errRes.body.code).toBe('VALIDATION_ERROR');

      // Limit > 50 returns 400
      const errLimitRes = await request(app)
        .get('/api/platform/tenants?limit=51')
        .set('Cookie', `bb_session=${superadminToken}`);
      expect(errLimitRes.status).toBe(400);
      expect(errLimitRes.body.code).toBe('VALIDATION_ERROR');

      // Valid limit = 50 returns 200
      const validLimitRes = await request(app)
        .get('/api/platform/tenants?limit=50')
        .set('Cookie', `bb_session=${superadminToken}`);
      expect(validLimitRes.status).toBe(200);
      expect(validLimitRes.body.data.pagination.limit).toBe(50);
    });

    it('filters tenants by status', async () => {
      const res = await request(app)
        .get('/api/platform/tenants?status=INVITED')
        .set('Cookie', `bb_session=${superadminToken}`);

      expect(res.status).toBe(200);
      for (const t of res.body.data.tenants) {
        expect(t.status).toBe('INVITED');
      }

      // Invalid status returns 400
      const invalidStatusRes = await request(app)
        .get('/api/platform/tenants?status=INVALID_STATUS')
        .set('Cookie', `bb_session=${superadminToken}`);
      expect(invalidStatusRes.status).toBe(400);
      expect(invalidStatusRes.body.code).toBe('VALIDATION_ERROR');
    });

    it('searches tenants by legalName, tradeName, slug, and nominatedPhone', async () => {
      // 1. Search by tradeName
      const tradeRes = await request(app)
        .get('/api/platform/tenants?search=Beta%20Fresh')
        .set('Cookie', `bb_session=${superadminToken}`);
      expect(tradeRes.status).toBe(200);
      expect(tradeRes.body.data.tenants.some((t) => t.slug === `beta-fresh-${testId}`)).toBe(true);

      // 2. Search by slug
      const slugRes = await request(app)
        .get(`/api/platform/tenants?search=gamma-chemist-${testId}`)
        .set('Cookie', `bb_session=${superadminToken}`);
      expect(slugRes.status).toBe(200);
      expect(slugRes.body.data.tenants.length).toBe(1);
      expect(slugRes.body.data.tenants[0].slug).toBe(`gamma-chemist-${testId}`);

      // 3. Search by nominatedPhone
      const phoneRes = await request(app)
        .get('/api/platform/tenants?search=%2B919000000001')
        .set('Cookie', `bb_session=${superadminToken}`);
      expect(phoneRes.status).toBe(200);
      expect(phoneRes.body.data.tenants.some((t) => t.slug === `alpha-mart-${testId}`)).toBe(true);
    });

    it('returns empty result set cleanly when no match is found', async () => {
      const res = await request(app)
        .get('/api/platform/tenants?search=non_existent_search_query_123456')
        .set('Cookie', `bb_session=${superadminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.tenants).toEqual([]);
      expect(res.body.data.pagination.total).toBe(0);
      expect(res.body.data.pagination.totalPages).toBe(1);
    });

    it('enforces stable deterministic ordering (createdAt DESC, id DESC)', async () => {
      const res = await request(app)
        .get('/api/platform/tenants?limit=10')
        .set('Cookie', `bb_session=${superadminToken}`);

      expect(res.status).toBe(200);
      const tenants = res.body.data.tenants;
      for (let i = 0; i < tenants.length - 1; i++) {
        const current = new Date(tenants[i].createdAt).getTime();
        const next = new Date(tenants[i + 1].createdAt).getTime();
        expect(current).toBeGreaterThanOrEqual(next);
      }
    });
  });

  describe('6. Tenant Detail API (GET /api/platform/tenants/:tenantId)', () => {
    let detailTenant = null;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`)
        .set('Origin', 'http://localhost:5173')
        .send({
          legalName: 'Detailed Store Enterprises',
          tradeName: 'Detailed Store',
          slug: `detailed-store-${testId}`,
          ownerFullName: 'Detailed Owner',
          ownerPhone: '+919222333444',
          ownerEmail: 'detail@example.com',
        });
      detailTenant = res.body.data.tenant;
      createdTenantIds.push(detailTenant.id);
    });

    it('returns 200 with full details, onboarding progress, and invitation history', async () => {
      const res = await request(app)
        .get(`/api/platform/tenants/${detailTenant.id}`)
        .set('Cookie', `bb_session=${superadminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.headers['cache-control']).toBe('no-store, no-cache, must-revalidate, private');

      const data = res.body.data;
      expect(data.id).toBe(detailTenant.id);
      expect(data.slug).toBe(detailTenant.slug);
      expect(data.legalName).toBe(detailTenant.legalName);
      expect(data.status).toBe('INVITED');

      // Verify onboarding progress
      expect(data.onboarding).not.toBeNull();
      expect(data.onboarding.currentStep).toBe(1);
      expect(data.onboarding.isCompleted).toBe(false);
      expect(data.onboarding.stepData).toEqual({});

      // Verify current invitation and history
      expect(data.currentInvitation).not.toBeNull();
      expect(data.currentInvitation.status).toBe('INVITED_PENDING_ACCEPTANCE');
      expect(data.currentInvitation.nominatedPhone).toBe('+919222333444');
      expect(data.currentInvitation.nominatedEmail).toBe('detail@example.com');
      expect(data.currentInvitation.isExpired).toBe(false);

      expect(Array.isArray(data.invitationHistory)).toBe(true);
      expect(data.invitationHistory.length).toBe(1);
      expect(data.invitationHistory[0].id).toBe(data.currentInvitation.id);
    });

    it('returns HTTP 404 TENANT_NOT_FOUND for unknown tenant UUID', async () => {
      const unknownUuid = crypto.randomUUID();
      const res = await request(app)
        .get(`/api/platform/tenants/${unknownUuid}`)
        .set('Cookie', `bb_session=${superadminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('TENANT_NOT_FOUND');
    });

    it('returns HTTP 400 VALIDATION_ERROR for non-UUID parameter', async () => {
      const res = await request(app)
        .get('/api/platform/tenants/not-a-valid-uuid')
        .set('Cookie', `bb_session=${superadminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('7. Deterministic Invitation Lifecycle Derivation', () => {
    let lifecycleTenant = null;

    beforeAll(async () => {
      // 1. Create a tenant
      const res = await request(app)
        .post('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`)
        .set('Origin', 'http://localhost:5173')
        .send({
          legalName: 'Lifecycle Test Tenant',
          tradeName: 'Lifecycle Mart',
          slug: `lifecycle-mart-${testId}`,
          ownerFullName: 'Lifecycle Owner',
          ownerPhone: '+919333444555',
          ownerEmail: 'lifecycle@example.com',
        });
      lifecycleTenant = res.body.data.tenant;
      createdTenantIds.push(lifecycleTenant.id);

      const tenantId = lifecycleTenant.id;
      const dummyHash1 = crypto.randomBytes(32).toString('hex');
      const dummyHash2 = crypto.randomBytes(32).toString('hex');
      const dummyHash3 = crypto.randomBytes(32).toString('hex');
      const dummyHash4 = crypto.randomBytes(32).toString('hex');

      // 2. Add an expired PENDING invitation (expiresAt in the past)
      await prisma.ownerInvitation.create({
        data: {
          tenantId,
          invitedEmail: 'lifecycle@example.com',
          invitedPhone: '+919333444555',
          tokenHash: dummyHash1,
          status: 'PENDING',
          expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
          createdAt: new Date(Date.now() - 7200000),
        },
      });

      // 3. Add an ACCEPTED invitation
      await prisma.ownerInvitation.create({
        data: {
          tenantId,
          invitedEmail: 'lifecycle@example.com',
          invitedPhone: '+919333444555',
          tokenHash: dummyHash2,
          status: 'ACCEPTED',
          expiresAt: new Date(Date.now() + 3600000),
          acceptedAt: new Date(),
          createdAt: new Date(Date.now() - 5000000),
        },
      });

      // 4. Add a SUPERSEDED invitation whose expiresAt is in the past
      await prisma.ownerInvitation.create({
        data: {
          tenantId,
          invitedEmail: 'lifecycle@example.com',
          invitedPhone: '+919333444555',
          tokenHash: dummyHash3,
          status: 'SUPERSEDED',
          expiresAt: new Date(Date.now() - 100000),
          revokedAt: new Date(),
          createdAt: new Date(Date.now() - 6000000),
        },
      });

      // 5. Add a REVOKED invitation whose expiresAt is in the past
      await prisma.ownerInvitation.create({
        data: {
          tenantId,
          invitedEmail: 'lifecycle@example.com',
          invitedPhone: '+919333444555',
          tokenHash: dummyHash4,
          status: 'REVOKED',
          expiresAt: new Date(Date.now() - 100000),
          revokedAt: new Date(),
          createdAt: new Date(Date.now() - 8000000),
        },
      });
    });

    it('correctly maps lifecycle status with ADR-002 precedence and separates isExpired', async () => {
      const res = await request(app)
        .get(`/api/platform/tenants/${lifecycleTenant.id}`)
        .set('Cookie', `bb_session=${superadminToken}`);

      expect(res.status).toBe(200);
      const history = res.body.data.invitationHistory;

      // History must contain all 5 invitations (1 from creation + 4 seeded)
      expect(history.length).toBe(5);

      // 1. Pending & unexpired: displayStatus = 'INVITED_PENDING_ACCEPTANCE', isExpired = false
      const pendingUnexpired = history.find((i) => i.rawStatus === 'PENDING' && !i.isExpired);
      expect(pendingUnexpired).toBeDefined();
      expect(pendingUnexpired.status).toBe('INVITED_PENDING_ACCEPTANCE');
      expect(pendingUnexpired.isExpired).toBe(false);

      // 2. Pending & expired: displayStatus = 'EXPIRED', isExpired = true
      const pendingExpired = history.find((i) => i.rawStatus === 'PENDING' && i.isExpired);
      expect(pendingExpired).toBeDefined();
      expect(pendingExpired.status).toBe('EXPIRED');
      expect(pendingExpired.isExpired).toBe(true);

      // 3. Accepted: displayStatus = 'ACCEPTED'
      const accepted = history.find((i) => i.rawStatus === 'ACCEPTED');
      expect(accepted).toBeDefined();
      expect(accepted.status).toBe('ACCEPTED');
      expect(accepted.acceptedAt).not.toBeNull();

      // 4. Superseded: displayStatus = 'SUPERSEDED' (NOT merely expired even if expiresAt in past)
      const superseded = history.find((i) => i.rawStatus === 'SUPERSEDED');
      expect(superseded).toBeDefined();
      expect(superseded.status).toBe('SUPERSEDED');
      expect(superseded.isExpired).toBe(true); // separate boolean is true, but status is SUPERSEDED

      // 5. Revoked: displayStatus = 'REVOKED' (NOT merely expired even if expiresAt in past)
      const revoked = history.find((i) => i.rawStatus === 'REVOKED');
      expect(revoked).toBeDefined();
      expect(revoked.status).toBe('REVOKED');
      expect(revoked.isExpired).toBe(true); // separate boolean is true, but status is REVOKED
    });
  });

  describe('8. Security & Secret Exclusion Verification on GET Endpoints', () => {
    it('rejects unauthenticated GET /api/platform/tenants with HTTP 401', async () => {
      const res = await request(app).get('/api/platform/tenants');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('rejects unauthenticated GET /api/platform/tenants/:id with HTTP 401', async () => {
      const res = await request(app).get(`/api/platform/tenants/${crypto.randomUUID()}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('rejects non-superadmin user on GET endpoints with HTTP 403 FORBIDDEN', async () => {
      const listRes = await request(app)
        .get('/api/platform/tenants')
        .set('Cookie', `bb_session=${regularUserToken}`);
      expect(listRes.status).toBe(403);
      expect(listRes.body.code).toBe('FORBIDDEN');

      const detailRes = await request(app)
        .get(`/api/platform/tenants/${crypto.randomUUID()}`)
        .set('Cookie', `bb_session=${regularUserToken}`);
      expect(detailRes.status).toBe(403);
      expect(detailRes.body.code).toBe('FORBIDDEN');
    });

    it('rejects superadmin with 2FA pending on GET endpoints with HTTP 403 SECOND_FACTOR_REQUIRED', async () => {
      const listRes = await request(app)
        .get('/api/platform/tenants')
        .set('Cookie', `bb_session=${pending2faToken}`);
      expect(listRes.status).toBe(403);
      expect(listRes.body.code).toBe('SECOND_FACTOR_REQUIRED');

      const detailRes = await request(app)
        .get(`/api/platform/tenants/${crypto.randomUUID()}`)
        .set('Cookie', `bb_session=${pending2faToken}`);
      expect(detailRes.status).toBe(403);
      expect(detailRes.body.code).toBe('SECOND_FACTOR_REQUIRED');
    });

    it('rejects superadmin with mustChangePassword on GET endpoints with HTTP 403 PASSWORD_CHANGE_REQUIRED', async () => {
      const listRes = await request(app)
        .get('/api/platform/tenants')
        .set('Cookie', `bb_session=${mustChangePwdToken}`);
      expect(listRes.status).toBe(403);
      expect(listRes.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

      const detailRes = await request(app)
        .get(`/api/platform/tenants/${crypto.randomUUID()}`)
        .set('Cookie', `bb_session=${mustChangePwdToken}`);
      expect(detailRes.status).toBe(403);
      expect(detailRes.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    });

    it('strictly excludes tokenHash, raw tokens, and secrets from all GET responses', async () => {
      const listRes = await request(app)
        .get('/api/platform/tenants')
        .set('Cookie', `bb_session=${superadminToken}`);

      const listJson = JSON.stringify(listRes.body);
      expect(listJson).not.toContain('tokenHash');
      expect(listJson).not.toContain('rawToken');
      expect(listJson).not.toContain('passwordHash');
      expect(listJson).not.toContain('secretEncrypted');

      if (createdTenantIds.length > 0) {
        const detailRes = await request(app)
          .get(`/api/platform/tenants/${createdTenantIds[0]}`)
          .set('Cookie', `bb_session=${superadminToken}`);

        const detailJson = JSON.stringify(detailRes.body);
        expect(detailJson).not.toContain('tokenHash');
        expect(detailJson).not.toContain('rawToken');
        expect(detailJson).not.toContain('passwordHash');
        expect(detailJson).not.toContain('secretEncrypted');
      }
    });
  });
});
