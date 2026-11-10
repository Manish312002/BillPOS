import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { prisma } from '../src/db/client.js';
import * as subscriptionService from '../src/services/subscription.service.js';
import * as entitlementService from '../src/services/entitlement.service.js';
import {
  requireFeature,
  enforceSubscriptionAccess,
  requireWriteAccess,
  requireQuota,
} from '../src/middleware/entitlement.js';
import {
  SUBSCRIPTION_STATUS,
  BILLING_CYCLE,
  FEATURE_KEYS,
  FEATURE_VALUE_TYPE,
  SUBSCRIPTION_ERROR_CODES,
  ERROR_CODES,
} from '@billingbuddy/shared';

describe('WP-SUB-02 Slice 4: Entitlements Engine & Middleware Suite', () => {
  const testId = Date.now();
  let superadminUser;
  let testPlanStarter;
  let testPlanGrowth;
  let testPlanEnterprise;

  beforeAll(async () => {
    // 1. Create superadmin test user
    superadminUser = await prisma.user.create({
      data: {
        fullName: 'Entitlement Test Superadmin',
        phone: `+91912${Math.floor(100000 + Math.random() * 900000)}`,
        email: `ent_admin_${testId}_${Math.random().toString(36).substring(7)}@billingbuddy.com`,
        passwordHash: 'dummy_hash',
        status: 'ACTIVE',
        platformAuthorization: {
          create: {
            role: 'SUPERADMIN',
            status: 'ACTIVE',
          },
        },
      },
    });

    // 2. Fetch or create STARTER, GROWTH, and ENTERPRISE plans
    testPlanStarter = await prisma.plan.upsert({
      where: { code: 'STARTER' },
      create: {
        code: 'STARTER',
        name: 'Starter Tier',
        description: 'Single outlet retail',
        trialDays: 0,
        isActive: true,
        isPublic: true,
        version: 1,
        features: {
          create: [
            { featureKey: FEATURE_KEYS.MAX_OUTLETS, valueType: FEATURE_VALUE_TYPE.NUMERIC, numericValue: 1 },
            { featureKey: FEATURE_KEYS.MAX_USERS, valueType: FEATURE_VALUE_TYPE.NUMERIC, numericValue: 2 },
            { featureKey: FEATURE_KEYS.MAX_DEVICES, valueType: FEATURE_VALUE_TYPE.NUMERIC, numericValue: 2 },
            { featureKey: FEATURE_KEYS.MAX_PRODUCTS, valueType: FEATURE_VALUE_TYPE.NUMERIC, numericValue: 250 },
            { featureKey: FEATURE_KEYS.OFFLINE_POS, valueType: FEATURE_VALUE_TYPE.BOOLEAN, booleanValue: true },
            { featureKey: FEATURE_KEYS.ADVANCED_REPORTS, valueType: FEATURE_VALUE_TYPE.BOOLEAN, booleanValue: false },
          ],
        },
        prices: {
          create: [
            { billingCycle: BILLING_CYCLE.MONTHLY, amountPaise: 14900n, isActive: true },
            { billingCycle: BILLING_CYCLE.ANNUAL, amountPaise: 149000n, isActive: true },
          ],
        },
      },
      update: {},
      include: { prices: true, features: true },
    });

    testPlanGrowth = await prisma.plan.upsert({
      where: { code: 'GROWTH' },
      create: {
        code: 'GROWTH',
        name: 'Growth Tier',
        description: 'Expanding multi-outlet',
        trialDays: 0,
        isActive: true,
        isPublic: true,
        version: 1,
        features: {
          create: [
            { featureKey: FEATURE_KEYS.MAX_OUTLETS, valueType: FEATURE_VALUE_TYPE.NUMERIC, numericValue: 3 },
            { featureKey: FEATURE_KEYS.MAX_USERS, valueType: FEATURE_VALUE_TYPE.NUMERIC, numericValue: 10 },
            { featureKey: FEATURE_KEYS.MAX_DEVICES, valueType: FEATURE_VALUE_TYPE.NUMERIC, numericValue: 6 },
            { featureKey: FEATURE_KEYS.MAX_PRODUCTS, valueType: FEATURE_VALUE_TYPE.NUMERIC, numericValue: 5000 },
            { featureKey: FEATURE_KEYS.OFFLINE_POS, valueType: FEATURE_VALUE_TYPE.BOOLEAN, booleanValue: true },
            { featureKey: FEATURE_KEYS.ADVANCED_REPORTS, valueType: FEATURE_VALUE_TYPE.BOOLEAN, booleanValue: true },
          ],
        },
        prices: {
          create: [
            { billingCycle: BILLING_CYCLE.MONTHLY, amountPaise: 24900n, isActive: true },
            { billingCycle: BILLING_CYCLE.ANNUAL, amountPaise: 249000n, isActive: true },
          ],
        },
      },
      update: {},
      include: { prices: true, features: true },
    });

    testPlanEnterprise = await prisma.plan.upsert({
      where: { code: 'ENTERPRISE' },
      create: {
        code: 'ENTERPRISE',
        name: 'Enterprise Tier',
        description: 'Large enterprise chains',
        trialDays: 0,
        isActive: true,
        isPublic: true,
        version: 1,
        features: {
          create: [
            { featureKey: FEATURE_KEYS.MAX_OUTLETS, valueType: FEATURE_VALUE_TYPE.NUMERIC, numericValue: -1 }, // Unlimited
            { featureKey: FEATURE_KEYS.MAX_USERS, valueType: FEATURE_VALUE_TYPE.NUMERIC, numericValue: -1 },
            { featureKey: FEATURE_KEYS.MAX_DEVICES, valueType: FEATURE_VALUE_TYPE.NUMERIC, numericValue: -1 },
            { featureKey: FEATURE_KEYS.MAX_PRODUCTS, valueType: FEATURE_VALUE_TYPE.NUMERIC, numericValue: -1 },
            { featureKey: FEATURE_KEYS.OFFLINE_POS, valueType: FEATURE_VALUE_TYPE.BOOLEAN, booleanValue: true },
            { featureKey: FEATURE_KEYS.ADVANCED_REPORTS, valueType: FEATURE_VALUE_TYPE.BOOLEAN, booleanValue: true },
          ],
        },
        prices: {
          create: [
            { billingCycle: BILLING_CYCLE.MONTHLY, amountPaise: 399900n, isActive: true },
            { billingCycle: BILLING_CYCLE.ANNUAL, amountPaise: 3999000n, isActive: true },
          ],
        },
      },
      update: {},
      include: { prices: true, features: true },
    });
  });

  afterAll(async () => {
    if (superadminUser) {
      await prisma.platformAuthorization.deleteMany({
        where: { userId: superadminUser.id },
      });
    }
  });

  async function createTestTenant(nameSuffix) {
    const slug = `ent-test-${testId}-${nameSuffix}-${Math.random().toString(36).substring(7)}`;
    return prisma.tenant.create({
      data: {
        legalName: `Ent Test Legal ${nameSuffix}`,
        tradeName: `Ent Test Store ${nameSuffix}`,
        slug,
        status: 'ACTIVE',
      },
    });
  }

  // =========================================================================
  // 1. Entitlement Resolution Engine & Precedence Rules
  // =========================================================================
  describe('1. Entitlement Resolution Engine & Precedence Rules', () => {
    it('resolves boolean feature enabled and disabled correctly from plan', async () => {
      const tenant = await createTestTenant('bool-features');
      await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        actorUserId: superadminUser.id,
        reason: 'Assigning STARTER plan for boolean feature test',
      });

      const entitlements = await entitlementService.resolveTenantEntitlements(tenant.id);
      expect(entitlements.features[FEATURE_KEYS.OFFLINE_POS].effectiveValue).toBe(true);
      expect(entitlements.features[FEATURE_KEYS.OFFLINE_POS].source).toBe('PLAN');

      expect(entitlements.features[FEATURE_KEYS.ADVANCED_REPORTS].effectiveValue).toBe(false);
      expect(entitlements.features[FEATURE_KEYS.ADVANCED_REPORTS].source).toBe('PLAN');

      const canAccessOffline = await entitlementService.canAccessFeature(tenant.id, FEATURE_KEYS.OFFLINE_POS);
      expect(canAccessOffline.hasAccess).toBe(true);

      const canAccessReports = await entitlementService.canAccessFeature(tenant.id, FEATURE_KEYS.ADVANCED_REPORTS);
      expect(canAccessReports.hasAccess).toBe(false);
      expect(canAccessReports.code).toBe(SUBSCRIPTION_ERROR_CODES.FEATURE_DISABLED);
    });

    it('resolves finite numeric quotas and unlimited (-1) quota correctly', async () => {
      const tenantStarter = await createTestTenant('finite-quota');
      await subscriptionService.assignPlan({
        tenantId: tenantStarter.id,
        planCode: 'STARTER',
        actorUserId: superadminUser.id,
        reason: 'Assigning STARTER plan for finite quota test',
      });

      const starterLimit = await entitlementService.getFeatureLimit(tenantStarter.id, FEATURE_KEYS.MAX_OUTLETS);
      expect(starterLimit.limit).toBe(1);
      expect(starterLimit.isUnlimited).toBe(false);

      const tenantEnterprise = await createTestTenant('unlimited-quota');
      await subscriptionService.assignPlan({
        tenantId: tenantEnterprise.id,
        planCode: 'ENTERPRISE',
        actorUserId: superadminUser.id,
        reason: 'Assigning ENTERPRISE plan for unlimited quota test',
      });

      const entLimit = await entitlementService.getFeatureLimit(tenantEnterprise.id, FEATURE_KEYS.MAX_OUTLETS);
      expect(entLimit.limit).toBe(-1);
      expect(entLimit.isUnlimited).toBe(true);
      expect(entLimit.source).toBe('PLAN');
    });

    it('missing or unknown feature keys are denied by default', async () => {
      const tenant = await createTestTenant('unknown-feature');
      await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      const unknownAccess = await entitlementService.canAccessFeature(tenant.id, 'non_existent_future_feature');
      expect(unknownAccess.hasAccess).toBe(false);
      expect(unknownAccess.code).toBe(SUBSCRIPTION_ERROR_CODES.FEATURE_NOT_INCLUDED);
      expect(unknownAccess.source).toBe('DEFAULT');

      await expect(
        entitlementService.assertFeatureAccess(tenant.id, 'non_existent_future_feature')
      ).rejects.toMatchObject({
        statusCode: 403,
        code: SUBSCRIPTION_ERROR_CODES.FEATURE_NOT_INCLUDED,
      });

      const limit = await entitlementService.getFeatureLimit(tenant.id, 'non_existent_metric');
      expect(limit.limit).toBe(0);
      expect(limit.isUnlimited).toBe(false);
      expect(limit.source).toBe('DEFAULT');
    });

    it('active override takes precedence over plan feature', async () => {
      const tenant = await createTestTenant('active-override');
      const sub = await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        actorUserId: superadminUser.id,
        reason: 'Starter plan with 1 outlet limit',
      });

      // Grant override: increase max_outlets from 1 to 5
      await prisma.tenantEntitlementOverride.create({
        data: {
          tenantId: tenant.id,
          subscriptionId: sub.id,
          featureKey: FEATURE_KEYS.MAX_OUTLETS,
          valueType: FEATURE_VALUE_TYPE.NUMERIC,
          numericValue: 5,
          reason: 'Pilot store opening extra outlets',
          grantedById: superadminUser.id,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days
        },
      });

      const limit = await entitlementService.getFeatureLimit(tenant.id, FEATURE_KEYS.MAX_OUTLETS);
      expect(limit.limit).toBe(5);
      expect(limit.source).toBe('OVERRIDE');
    });

    it('expired override is ignored and plan value is restored', async () => {
      const tenant = await createTestTenant('expired-override');
      const sub = await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        actorUserId: superadminUser.id,
        reason: 'Starter plan with 1 outlet limit',
      });

      // Insert expired override
      await prisma.tenantEntitlementOverride.create({
        data: {
          tenantId: tenant.id,
          subscriptionId: sub.id,
          featureKey: FEATURE_KEYS.MAX_OUTLETS,
          valueType: FEATURE_VALUE_TYPE.NUMERIC,
          numericValue: 5,
          reason: 'Expired promo override',
          grantedById: superadminUser.id,
          expiresAt: new Date(Date.now() - 1000 * 60), // Expired 1 min ago
        },
      });

      const limit = await entitlementService.getFeatureLimit(tenant.id, FEATURE_KEYS.MAX_OUTLETS);
      expect(limit.limit).toBe(1); // Restored to STARTER plan limit
      expect(limit.source).toBe('PLAN');
    });

    it('override belonging to another tenant is never applied', async () => {
      const tenantA = await createTestTenant('tenant-a-override');
      const tenantB = await createTestTenant('tenant-b-target');

      const subA = await subscriptionService.assignPlan({
        tenantId: tenantA.id,
        planCode: 'STARTER',
        actorUserId: superadminUser.id,
        reason: 'Tenant A Starter Plan',
      });

      await subscriptionService.assignPlan({
        tenantId: tenantB.id,
        planCode: 'STARTER',
        actorUserId: superadminUser.id,
        reason: 'Tenant B Starter Plan',
      });

      // Grant override to Tenant A only
      await prisma.tenantEntitlementOverride.create({
        data: {
          tenantId: tenantA.id,
          subscriptionId: subA.id,
          featureKey: FEATURE_KEYS.MAX_OUTLETS,
          valueType: FEATURE_VALUE_TYPE.NUMERIC,
          numericValue: 10,
          reason: 'Tenant A exclusive override',
          grantedById: superadminUser.id,
        },
      });

      // Tenant A gets 10
      const limitA = await entitlementService.getFeatureLimit(tenantA.id, FEATURE_KEYS.MAX_OUTLETS);
      expect(limitA.limit).toBe(10);
      expect(limitA.source).toBe('OVERRIDE');

      // Tenant B still has 1
      const limitB = await entitlementService.getFeatureLimit(tenantB.id, FEATURE_KEYS.MAX_OUTLETS);
      expect(limitB.limit).toBe(1);
      expect(limitB.source).toBe('PLAN');
    });
  });

  // =========================================================================
  // 2. Subscription & Tenant Status Enforcement Matrix
  // =========================================================================
  describe('2. Subscription & Tenant Status Enforcement Matrix', () => {
    it('Tenant platform suspension blocks all operations regardless of plan or override', async () => {
      const tenant = await createTestTenant('tenant-suspended-block');
      const sub = await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'ENTERPRISE',
        actorUserId: superadminUser.id,
        reason: 'Enterprise plan before suspension',
      });

      // Grant override
      await prisma.tenantEntitlementOverride.create({
        data: {
          tenantId: tenant.id,
          subscriptionId: sub.id,
          featureKey: FEATURE_KEYS.OFFLINE_POS,
          valueType: FEATURE_VALUE_TYPE.BOOLEAN,
          booleanValue: true,
          reason: 'Override',
          grantedById: superadminUser.id,
        },
      });

      // Administratively suspend Tenant (Platform Level)
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'SUSPENDED' },
      });

      const res = await entitlementService.canAccessFeature(tenant.id, FEATURE_KEYS.OFFLINE_POS);
      expect(res.hasAccess).toBe(false);
      expect(res.code).toBe(SUBSCRIPTION_ERROR_CODES.TENANT_SUSPENDED);

      await expect(
        entitlementService.assertFeatureAccess(tenant.id, FEATURE_KEYS.OFFLINE_POS)
      ).rejects.toMatchObject({
        statusCode: 403,
        code: SUBSCRIPTION_ERROR_CODES.TENANT_SUSPENDED,
      });

      // Quota assertion also fails
      await prisma.$transaction(async (tx) => {
        await expect(
          entitlementService.assertQuotaAvailable(tenant.id, FEATURE_KEYS.MAX_USERS, { tx })
        ).rejects.toMatchObject({
          statusCode: 403,
          code: SUBSCRIPTION_ERROR_CODES.TENANT_SUSPENDED,
        });
      });
    });

    it('Commercial subscription suspension blocks commercial feature access', async () => {
      const tenant = await createTestTenant('sub-suspended-block');
      const sub = await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      // Put subscription into SUSPENDED
      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: { status: SUBSCRIPTION_STATUS.SUSPENDED },
      });

      const access = await entitlementService.canAccessFeature(tenant.id, FEATURE_KEYS.OFFLINE_POS);
      expect(access.hasAccess).toBe(false);
      expect(access.code).toBe(SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_SUSPENDED);

      await expect(
        entitlementService.assertFeatureAccess(tenant.id, FEATURE_KEYS.OFFLINE_POS)
      ).rejects.toMatchObject({
        statusCode: 403,
        code: SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_SUSPENDED,
      });
    });

    it('GRACE_PERIOD permits normal access with grace warning metadata', async () => {
      const tenant = await createTestTenant('grace-access');
      const sub = await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      const graceEnd = new Date(Date.now() + 1000 * 60 * 60 * 48); // 48h remaining
      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: {
          status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
          gracePeriodEndsAt: graceEnd,
        },
      });

      const entitlements = await entitlementService.resolveTenantEntitlements(tenant.id);
      expect(entitlements.lifecycle.canMutate).toBe(true);
      expect(entitlements.lifecycle.inGrace).toBe(true);
      expect(entitlements.lifecycle.gracePeriodEndsAt).toBeDefined();

      const access = await entitlementService.canAccessFeature(tenant.id, FEATURE_KEYS.OFFLINE_POS);
      expect(access.hasAccess).toBe(true);
    });

    it('READ_ONLY mode blocks mutations while permitting reads', async () => {
      const tenant = await createTestTenant('read-only-access');
      const sub = await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: { status: SUBSCRIPTION_STATUS.READ_ONLY },
      });

      const entitlements = await entitlementService.resolveTenantEntitlements(tenant.id);
      expect(entitlements.lifecycle.canMutate).toBe(false);
      expect(entitlements.lifecycle.canRead).toBe(true);
      expect(entitlements.lifecycle.isReadOnly).toBe(true);

      // Quota assertion (mutation) is rejected with SUBSCRIPTION_READ_ONLY
      await prisma.$transaction(async (tx) => {
        await expect(
          entitlementService.assertQuotaAvailable(tenant.id, FEATURE_KEYS.MAX_USERS, { tx })
        ).rejects.toMatchObject({
          statusCode: 403,
          code: SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_READ_ONLY,
        });
      });
    });

    it('CANCELED and EXPIRED subscriptions block commercial operations', async () => {
      const tenant = await createTestTenant('canceled-access');
      const sub = await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      await subscriptionService.cancelSubscriptionImmediately({
        tenantId: tenant.id,
        reason: 'Immediate administrative cancellation for test',
        actorUserId: superadminUser.id,
      });

      const entitlements = await entitlementService.resolveTenantEntitlements(tenant.id);
      expect(entitlements.subscription).toBeNull(); // No active subscription
      expect(entitlements.lifecycle.isSubscriptionInactive).toBe(true);
      expect(entitlements.lifecycle.canMutate).toBe(false);

      const access = await entitlementService.canAccessFeature(tenant.id, FEATURE_KEYS.OFFLINE_POS);
      expect(access.hasAccess).toBe(false);
      expect(access.code).toBe(SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_INACTIVE);
    });
  });

  // =========================================================================
  // 3. Downgrade Validation (Decision D-05)
  // =========================================================================
  describe('3. Downgrade Validation (Decision D-05)', () => {
    it('permits plan downgrade when current usage is within target plan limits', async () => {
      const tenant = await createTestTenant('downgrade-permitted');
      await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'GROWTH',
        actorUserId: superadminUser.id,
        reason: 'Initial growth plan',
      });

      // Target STARTER has max_outlets: 1, max_users: 2
      // Current usage: 1 user, 1 outlet
      const result = await entitlementService.validatePlanDowngrade(tenant.id, 'STARTER', {
        resourceCounts: {
          [FEATURE_KEYS.MAX_OUTLETS]: 1,
          [FEATURE_KEYS.MAX_USERS]: 2,
        },
      });

      expect(result.valid).toBe(true);
      expect(result.targetPlanCode).toBe('STARTER');
    });

    it('strictly blocks plan downgrade when current usage exceeds target plan limits with 422 DOWNGRADE_VIOLATION', async () => {
      const tenant = await createTestTenant('downgrade-blocked');
      await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'GROWTH',
        actorUserId: superadminUser.id,
        reason: 'Initial growth plan with 3 outlets and 10 users',
      });

      // Current tenant usage: 2 outlets (exceeds STARTER limit of 1)
      await expect(
        entitlementService.validatePlanDowngrade(tenant.id, 'STARTER', {
          resourceCounts: {
            [FEATURE_KEYS.MAX_OUTLETS]: 2,
            [FEATURE_KEYS.MAX_USERS]: 2,
          },
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: SUBSCRIPTION_ERROR_CODES.DOWNGRADE_VIOLATION,
        details: expect.objectContaining({
          targetPlanCode: 'STARTER',
          violations: expect.arrayContaining([
            expect.objectContaining({
              featureKey: FEATURE_KEYS.MAX_OUTLETS,
              currentUsage: 2,
              targetLimit: 1,
            }),
          ]),
        }),
      });
    });
  });

  // =========================================================================
  // 4. Entitlement Express Middleware Suite
  // =========================================================================
  describe('4. Entitlement Express Middleware Suite', () => {
    function createMockApp(tenantContext) {
      const app = express();
      app.use(express.json());

      // Inject server-side authenticated context
      app.use((req, res, next) => {
        if (tenantContext) {
          req.currentMembership = tenantContext.membership;
          req.session = tenantContext.session;
        }
        next();
      });

      // Test route protected by requireFeature
      app.get('/test/feature-reports', requireFeature(FEATURE_KEYS.ADVANCED_REPORTS), (req, res) => {
        res.json({ success: true, feature: req.featureEntitlement });
      });

      // Test route protected by enforceSubscriptionAccess (allowing read-only GET)
      app.get('/test/orders', enforceSubscriptionAccess({ allowReadOnly: true }), (req, res) => {
        res.json({ success: true, readOnly: req.isSubscriptionReadOnly || false });
      });

      // Test route protected by requireWriteAccess (mutating route)
      app.post('/test/orders', requireWriteAccess(), (req, res) => {
        res.status(201).json({ success: true, created: true });
      });

      // Test route protected by requireQuota
      app.post('/test/outlets', requireQuota(FEATURE_KEYS.MAX_OUTLETS, 1), (req, res) => {
        res.status(201).json({ success: true, outletCreated: true });
      });

      return app;
    }

    it('requireFeature allows request when feature is enabled and blocks when disabled', async () => {
      const tenant = await createTestTenant('mw-feature');
      await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER', // advanced_reports = false
        actorUserId: superadminUser.id,
        reason: 'Starter plan',
      });

      const app = createMockApp({
        membership: { tenantId: tenant.id, role: 'STORE_OWNER' },
        session: { activeTenantId: tenant.id },
      });

      const resBlocked = await request(app).get('/test/feature-reports');
      expect(resBlocked.status).toBe(403);
      expect(resBlocked.body.error.code).toBe(SUBSCRIPTION_ERROR_CODES.FEATURE_DISABLED);

      // Upgrade to GROWTH (advanced_reports = true)
      await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'GROWTH',
        actorUserId: superadminUser.id,
        reason: 'Upgrade to GROWTH for reports test',
      });

      const resAllowed = await request(app).get('/test/feature-reports');
      expect(resAllowed.status).toBe(200);
      expect(resAllowed.body.success).toBe(true);
    });

    it('enforceSubscriptionAccess attaches grace-period headers during GRACE_PERIOD', async () => {
      const tenant = await createTestTenant('mw-grace');
      const sub = await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      const graceEnd = new Date(Date.now() + 1000 * 60 * 60 * 48);
      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: {
          status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
          gracePeriodEndsAt: graceEnd,
        },
      });

      const app = createMockApp({
        membership: { tenantId: tenant.id, role: 'STORE_OWNER' },
      });

      const res = await request(app).get('/test/orders');
      expect(res.status).toBe(200);
      expect(res.headers['x-subscription-grace-period']).toBe('true');
      expect(res.headers['x-subscription-grace-ends-At'] || res.headers['x-subscription-grace-ends-at']).toBeDefined();
    });

    it('enforceSubscriptionAccess allows GET in READ_ONLY but blocks POST mutation with 403', async () => {
      const tenant = await createTestTenant('mw-read-only');
      const sub = await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: { status: SUBSCRIPTION_STATUS.READ_ONLY },
      });

      const app = createMockApp({
        membership: { tenantId: tenant.id, role: 'STORE_OWNER' },
      });

      // Safe read is allowed with header
      const resGet = await request(app).get('/test/orders');
      expect(resGet.status).toBe(200);
      expect(resGet.headers['x-subscription-read-only']).toBe('true');

      // Write mutation is blocked
      const resPost = await request(app).post('/test/orders').send({ item: 'Coffee' });
      expect(resPost.status).toBe(403);
      expect(resPost.body.error.code).toBe(SUBSCRIPTION_ERROR_CODES.SUBSCRIPTION_READ_ONLY);
    });

    it('middleware fails closed with 403 TENANT_CONTEXT_REQUIRED when tenant context is missing', async () => {
      const app = createMockApp(null); // No authenticated membership or session

      const res = await request(app).get('/test/feature-reports');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(SUBSCRIPTION_ERROR_CODES.TENANT_CONTEXT_REQUIRED);
    });
  });

  // =========================================================================
  // 5. Tenant Isolation & Untrusted Client Input Defense
  // =========================================================================
  describe('5. Tenant Isolation & Untrusted Client Input Defense', () => {
    it('request body or query tenantId cannot override authenticated server context in middleware', async () => {
      const tenantA = await createTestTenant('legit-tenant-a');
      const tenantB = await createTestTenant('victim-tenant-b');

      // Tenant A is STARTER (offline_pos: true, advanced_reports: false)
      await subscriptionService.assignPlan({
        tenantId: tenantA.id,
        planCode: 'STARTER',
        actorUserId: superadminUser.id,
        reason: 'Tenant A Starter Plan',
      });

      // Tenant B is GROWTH (offline_pos: true, advanced_reports: true)
      await subscriptionService.assignPlan({
        tenantId: tenantB.id,
        planCode: 'GROWTH',
        actorUserId: superadminUser.id,
        reason: 'Tenant B Growth Plan',
      });

      const app = express();
      app.use(express.json());

      // Authenticated as Tenant A
      app.use((req, res, next) => {
        req.currentMembership = { tenantId: tenantA.id, role: 'STORE_OWNER' };
        next();
      });

      app.get('/test/reports', requireFeature(FEATURE_KEYS.ADVANCED_REPORTS), (req, res) => {
        res.json({ success: true });
      });

      // Attacker sends Tenant B ID in query and body attempting to hijack Tenant B's reports feature
      const res = await request(app)
        .get(`/test/reports?tenantId=${tenantB.id}`)
        .send({ tenantId: tenantB.id });

      // Must be evaluated strictly against Tenant A (where advanced_reports is false -> 403)
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(SUBSCRIPTION_ERROR_CODES.FEATURE_DISABLED);
    });
  });
});
