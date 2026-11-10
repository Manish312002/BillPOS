import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/db/client.js';
import * as subscriptionService from '../src/services/subscription.service.js';
import * as entitlementService from '../src/services/entitlement.service.js';
import {
  SUBSCRIPTION_STATUS,
  BILLING_CYCLE,
  FEATURE_KEYS,
  FEATURE_VALUE_TYPE,
  SUBSCRIPTION_ERROR_CODES,
} from '@billingbuddy/shared';

describe('WP-SUB-02 Slice 4: Quota Concurrency & Pessimistic Locking Tests', () => {
  const testId = Date.now();
  let superadminUser;
  let testPlanStarter;
  let testPlanEnterprise;

  beforeAll(async () => {
    // 1. Create superadmin test user
    superadminUser = await prisma.user.create({
      data: {
        fullName: 'Quota Concurrency Superadmin',
        phone: `+91913${Math.floor(100000 + Math.random() * 900000)}`,
        email: `quota_admin_${testId}_${Math.random().toString(36).substring(7)}@billingbuddy.com`,
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

    // 2. Fetch or create STARTER plan (max_users: 2, max_outlets: 1, max_devices: 2, max_products: 250)
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
            { featureKey: FEATURE_KEYS.MAX_OUTLETS, valueType: FEATURE_VALUE_TYPE.NUMERIC, numericValue: -1 },
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
    const slug = `quota-test-${testId}-${nameSuffix}-${Math.random().toString(36).substring(7)}`;
    return prisma.tenant.create({
      data: {
        legalName: `Quota Test Legal ${nameSuffix}`,
        tradeName: `Quota Test Store ${nameSuffix}`,
        slug,
        status: 'ACTIVE',
      },
    });
  }

  async function createTestUser(emailSuffix) {
    return prisma.user.create({
      data: {
        fullName: `Cashier User ${emailSuffix}`,
        phone: `+91914${Math.floor(100000 + Math.random() * 900000)}`,
        email: `cashier_${testId}_${emailSuffix}_${Math.random().toString(36).substring(7)}@billingbuddy.com`,
        status: 'ACTIVE',
      },
    });
  }

  // =========================================================================
  // 1. Quota Assertion Boundary Tests (Below, At, and Over Limit)
  // =========================================================================
  describe('1. Quota Assertion Boundary Tests (Below, At, and Over Limit)', () => {
    it('permits creation when usage is below limit and exactly at limit', async () => {
      const tenant = await createTestTenant('boundary-check');
      await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER', // max_users = 2
        actorUserId: superadminUser.id,
        reason: 'Starter plan with 2 users limit',
      });

      // 0 existing users: requesting 1 is below limit (1 <= 2)
      await prisma.$transaction(async (tx) => {
        const check1 = await entitlementService.assertQuotaAvailable(
          tenant.id,
          FEATURE_KEYS.MAX_USERS,
          { tx, additionalCount: 1 }
        );
        expect(check1.allowed).toBe(true);
        expect(check1.remaining).toBe(1);
      });

      // Create 1 user
      const user1 = await createTestUser('u1');
      await prisma.tenantMembership.create({
        data: {
          tenantId: tenant.id,
          userId: user1.id,
          role: 'STORE_OWNER',
          status: 'ACTIVE',
        },
      });

      // 1 existing user: requesting 1 is exactly at limit (1 + 1 == 2)
      await prisma.$transaction(async (tx) => {
        const check2 = await entitlementService.assertQuotaAvailable(
          tenant.id,
          FEATURE_KEYS.MAX_USERS,
          { tx, additionalCount: 1 }
        );
        expect(check2.allowed).toBe(true);
        expect(check2.remaining).toBe(0);
      });
    });

    it('strictly rejects when usage exceeds limit with 403 QUOTA_EXCEEDED and upgrade guidance', async () => {
      const tenant = await createTestTenant('over-limit-check');
      await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER', // max_users = 2
        actorUserId: superadminUser.id,
        reason: 'Starter plan with 2 users limit',
      });

      // Populate 2 active users (reaching limit)
      const u1 = await createTestUser('ol1');
      const u2 = await createTestUser('ol2');
      await prisma.tenantMembership.createMany({
        data: [
          { tenantId: tenant.id, userId: u1.id, role: 'STORE_OWNER', status: 'ACTIVE' },
          { tenantId: tenant.id, userId: u2.id, role: 'STORE_CASHIER', status: 'ACTIVE' },
        ],
      });

      // Requesting 1 more slot when at limit (2 + 1 > 2)
      await prisma.$transaction(async (tx) => {
        await expect(
          entitlementService.assertQuotaAvailable(tenant.id, FEATURE_KEYS.MAX_USERS, {
            tx,
            additionalCount: 1,
          })
        ).rejects.toMatchObject({
          statusCode: 403,
          code: SUBSCRIPTION_ERROR_CODES.QUOTA_EXCEEDED,
          details: expect.objectContaining({
            featureKey: FEATURE_KEYS.MAX_USERS,
            limit: 2,
            currentUsage: 2,
            remaining: 0,
            upgradeGuidance: expect.objectContaining({
              suggestedPlan: 'GROWTH',
            }),
          }),
        });
      });
    });

    it('handles unlimited quotas (-1) unconditionally', async () => {
      const tenant = await createTestTenant('unlimited-quota-check');
      await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'ENTERPRISE', // max_users = -1
        actorUserId: superadminUser.id,
        reason: 'Enterprise unlimited plan',
      });

      await prisma.$transaction(async (tx) => {
        const check = await entitlementService.assertQuotaAvailable(
          tenant.id,
          FEATURE_KEYS.MAX_USERS,
          { tx, additionalCount: 100 }
        );
        expect(check.allowed).toBe(true);
        expect(check.isUnlimited).toBe(true);
        expect(check.limit).toBe(-1);
      });
    });
  });

  // =========================================================================
  // 2. Active vs Soft-Deleted / Inactive Resource Accounting
  // =========================================================================
  describe('2. Active vs Soft-Deleted / Inactive Resource Accounting', () => {
    it('discounts INACTIVE memberships and counts only authoritative ACTIVE resources', async () => {
      const tenant = await createTestTenant('inactive-accounting');
      await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER', // max_users = 2
        actorUserId: superadminUser.id,
        reason: 'Starter plan with 2 users limit',
      });

      const u1 = await createTestUser('active1');
      const u2 = await createTestUser('inactive1');

      // 1 ACTIVE user, 1 INACTIVE user
      await prisma.tenantMembership.create({
        data: { tenantId: tenant.id, userId: u1.id, role: 'STORE_OWNER', status: 'ACTIVE' },
      });
      await prisma.tenantMembership.create({
        data: { tenantId: tenant.id, userId: u2.id, role: 'STORE_CASHIER', status: 'INACTIVE' },
      });

      // Total rows in DB is 2, but ACTIVE count is only 1
      const usage = await entitlementService.getTenantUsage(tenant.id);
      expect(usage[FEATURE_KEYS.MAX_USERS]).toBe(1);

      // Quota check allows adding a 2nd active user because limit is 2
      await prisma.$transaction(async (tx) => {
        const check = await entitlementService.assertQuotaAvailable(
          tenant.id,
          FEATURE_KEYS.MAX_USERS,
          { tx, additionalCount: 1 }
        );
        expect(check.allowed).toBe(true);
        expect(check.currentUsage).toBe(1);
        expect(check.remaining).toBe(0);
      });
    });
  });

  // =========================================================================
  // 3. Four Quota Categories Evaluation
  // =========================================================================
  describe('3. Four Quota Categories Evaluation', () => {
    it('correctly evaluates limits for outlets, users, devices, and products', async () => {
      const tenant = await createTestTenant('four-categories');
      await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        actorUserId: superadminUser.id,
        reason: 'Starter plan 4 categories check',
      });

      const outletsLimit = await entitlementService.getFeatureLimit(tenant.id, FEATURE_KEYS.MAX_OUTLETS);
      expect(outletsLimit.limit).toBe(1);

      const usersLimit = await entitlementService.getFeatureLimit(tenant.id, FEATURE_KEYS.MAX_USERS);
      expect(usersLimit.limit).toBe(2);

      const devicesLimit = await entitlementService.getFeatureLimit(tenant.id, FEATURE_KEYS.MAX_DEVICES);
      expect(devicesLimit.limit).toBe(2);

      const productsLimit = await entitlementService.getFeatureLimit(tenant.id, FEATURE_KEYS.MAX_PRODUCTS);
      expect(productsLimit.limit).toBe(500);

      // Quota assertion with explicit currentUsage for non-user models
      await prisma.$transaction(async (tx) => {
        // Outlets (limit 1, usage 0 -> allowed)
        const checkOutlet = await entitlementService.assertQuotaAvailable(
          tenant.id,
          FEATURE_KEYS.MAX_OUTLETS,
          { tx, currentUsage: 0 }
        );
        expect(checkOutlet.allowed).toBe(true);

        // Outlets (limit 1, usage 1 -> rejected)
        await expect(
          entitlementService.assertQuotaAvailable(tenant.id, FEATURE_KEYS.MAX_OUTLETS, {
            tx,
            currentUsage: 1,
          })
        ).rejects.toMatchObject({
          code: SUBSCRIPTION_ERROR_CODES.QUOTA_EXCEEDED,
        });

        // Products (limit 500, usage 500 -> rejected)
        await expect(
          entitlementService.assertQuotaAvailable(tenant.id, FEATURE_KEYS.MAX_PRODUCTS, {
            tx,
            currentUsage: 500,
          })
        ).rejects.toMatchObject({
          code: SUBSCRIPTION_ERROR_CODES.QUOTA_EXCEEDED,
        });
      });
    });
  });

  // =========================================================================
  // 4. PostgreSQL Real Concurrency Quota Race (TC-CONC-01)
  // =========================================================================
  describe('4. PostgreSQL Real Concurrency Quota Race (TC-CONC-01)', () => {
    it('five concurrent creation attempts on the final remaining slot produce exactly ONE success and FOUR 403 rejections', async () => {
      const tenant = await createTestTenant('concurrency-race');
      await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER', // max_users = 2
        actorUserId: superadminUser.id,
        reason: 'Starter plan for concurrency race test',
      });

      // 1. Create the first user so exactly 1 slot is remaining (1/2 used)
      const initialUser = await createTestUser('initial-owner');
      await prisma.tenantMembership.create({
        data: {
          tenantId: tenant.id,
          userId: initialUser.id,
          role: 'STORE_OWNER',
          status: 'ACTIVE',
        },
      });

      // Pre-condition assertion: exactly 1 active user in DB
      const initialCount = await prisma.tenantMembership.count({
        where: { tenantId: tenant.id, status: 'ACTIVE' },
      });
      expect(initialCount).toBe(1);

      // 2. Prepare 5 concurrent users to attempt creation
      const candidateUsers = await Promise.all([
        createTestUser('cand-1'),
        createTestUser('cand-2'),
        createTestUser('cand-3'),
        createTestUser('cand-4'),
        createTestUser('cand-5'),
      ]);

      // 3. Launch 5 simultaneous transactions competing for the 1 remaining slot
      // Lock hierarchy: TenantSubscription row lock (SELECT ... FOR UPDATE) serializes requests
      const raceResults = await Promise.allSettled(
        candidateUsers.map((candidate, idx) =>
          prisma.$transaction(
            async (tx) => {
              // Atomically assert quota availability with pessimistic row lock
              await entitlementService.assertQuotaAvailable(tenant.id, FEATURE_KEYS.MAX_USERS, {
                tx,
                additionalCount: 1,
              });

              // Create the membership in the same transaction
              return tx.tenantMembership.create({
                data: {
                  tenantId: tenant.id,
                  userId: candidate.id,
                  role: 'STORE_CASHIER',
                  status: 'ACTIVE',
                },
              });
            },
            {
              timeout: 10000, // 10s transaction timeout
            }
          )
        )
      );

      // 4. Verify outcomes:
      const fulfilled = raceResults.filter((r) => r.status === 'fulfilled');
      const rejected = raceResults.filter((r) => r.status === 'rejected');

      // EXACTLY 1 transaction must succeed
      expect(fulfilled).toHaveLength(1);

      // EXACTLY 4 transactions must be rejected
      expect(rejected).toHaveLength(4);

      // Verify each rejection is due to QUOTA_EXCEEDED
      rejected.forEach((rej) => {
        expect(rej.reason).toBeDefined();
        expect(rej.reason.code || rej.reason.message).toMatch(/QUOTA_EXCEEDED|quota exceeded/i);
      });

      // 5. Authoritative Database Verification:
      // The final count in PostgreSQL must NEVER exceed the plan quota of 2
      const finalActiveCount = await prisma.tenantMembership.count({
        where: { tenantId: tenant.id, status: 'ACTIVE' },
      });
      expect(finalActiveCount).toBe(2);

      // Total memberships (active or inactive) in database for this tenant must be exactly 2
      const totalCount = await prisma.tenantMembership.count({
        where: { tenantId: tenant.id },
      });
      expect(totalCount).toBe(2);
    });
  });
});
