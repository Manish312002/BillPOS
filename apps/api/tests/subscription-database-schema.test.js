import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

describe('WP-SUB-02 Slice 1: Subscription Database Schema & Invariants', () => {
  let prisma;
  let testTenantId;
  let starterPlan;
  let starterPrice;
  let superadminUser;

  beforeAll(async () => {
    prisma = new PrismaClient();

    // 1. Fetch starter plan and price from seeded catalog
    starterPlan = await prisma.plan.findUnique({
      where: { code: 'STARTER' },
      include: { prices: true, features: true }
    });
    expect(starterPlan).toBeDefined();
    expect(starterPlan.code).toBe('STARTER');

    starterPrice = starterPlan.prices.find((p) => p.billingCycle === 'MONTHLY');
    expect(starterPrice).toBeDefined();
    expect(typeof starterPrice.amountPaise).toBe('bigint');
    expect(starterPrice.amountPaise).toBe(99900n);

    // 2. Fetch or create a superadmin user for override/audit tests
    superadminUser = await prisma.user.findFirst({
      where: { platformAuthorization: { role: 'SUPERADMIN' } }
    });
    if (!superadminUser) {
      superadminUser = await prisma.user.create({
        data: {
          fullName: 'Test Superadmin',
          phone: `+9199000${Date.now().toString().slice(-5)}`,
          email: `test_admin_${Date.now()}@billingbuddy.test`,
          status: 'ACTIVE',
          platformAuthorization: {
            create: { role: 'SUPERADMIN', status: 'ACTIVE' }
          }
        }
      });
    }

    // 3. Create an isolated test tenant
    const testTenant = await prisma.tenant.create({
      data: {
        legalName: 'Slice 1 Test Store Ltd',
        slug: `slice1-test-${Date.now()}`,
        status: 'ACTIVE'
      }
    });
    testTenantId = testTenant.id;
  });

  afterAll(async () => {
    if (testTenantId) {
      // Clean up test tenant (cascades to subscriptions and child tables)
      await prisma.tenant.delete({ where: { id: testTenantId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  describe('1. Commercial Plan & Pricing Model', () => {
    it('persists all four baseline tiers with exact codes and sort orders', async () => {
      const plans = await prisma.plan.findMany({
        where: { code: { in: ['TRIAL_14', 'STARTER', 'GROWTH', 'ENTERPRISE'] } },
        orderBy: { sortOrder: 'asc' }
      });

      expect(plans.map((p) => p.code)).toEqual(['TRIAL_14', 'STARTER', 'GROWTH', 'ENTERPRISE']);
    });

    it('stores plan prices strictly in 64-bit integer paise (BigInt)', async () => {
      const growthPlan = await prisma.plan.findUnique({
        where: { code: 'GROWTH' },
        include: { prices: true }
      });

      const monthlyPrice = growthPlan.prices.find((p) => p.billingCycle === 'MONTHLY');
      const annualPrice = growthPlan.prices.find((p) => p.billingCycle === 'ANNUAL');

      expect(typeof monthlyPrice.amountPaise).toBe('bigint');
      expect(monthlyPrice.amountPaise).toBe(249900n); // ₹2,499.00
      expect(typeof annualPrice.amountPaise).toBe('bigint');
      expect(annualPrice.amountPaise).toBe(2499000n); // ₹24,990.00
    });

    it('maps plan features correctly including unlimited representations (-1)', async () => {
      const enterprisePlan = await prisma.plan.findUnique({
        where: { code: 'ENTERPRISE' },
        include: { features: true }
      });

      const maxOutletsFeature = enterprisePlan.features.find((f) => f.featureKey === 'max_outlets');
      const offlinePosFeature = enterprisePlan.features.find((f) => f.featureKey === 'offline_pos');

      expect(maxOutletsFeature.numericValue).toBe(-1); // Canonical UNLIMITED representation
      expect(offlinePosFeature.booleanValue).toBe(true);
    });

    it('enforces single active price per billing cycle while permitting multiple inactive historical prices', async () => {
      // 1. Attempt to create a SECOND active monthly price for starterPlan -> must FAIL with unique constraint
      await expect(
        prisma.planPrice.create({
          data: {
            planId: starterPlan.id,
            billingCycle: 'MONTHLY',
            amountPaise: 119900n,
            isActive: true
          }
        })
      ).rejects.toThrow();

      // 2. Create an INACTIVE historical price for starterPlan (e.g. legacy price v1) -> must SUCCEED
      const inactivePrice1 = await prisma.planPrice.create({
        data: {
          planId: starterPlan.id,
          billingCycle: 'MONTHLY',
          amountPaise: 79900n,
          isActive: false
        }
      });
      expect(inactivePrice1.id).toBeDefined();

      // 3. Create a SECOND INACTIVE historical price for starterPlan (e.g. legacy price v2) -> must ALSO SUCCEED
      // (This proves that multiple inactive historical prices are permitted without collision!)
      const inactivePrice2 = await prisma.planPrice.create({
        data: {
          planId: starterPlan.id,
          billingCycle: 'MONTHLY',
          amountPaise: 89900n,
          isActive: false
        }
      });
      expect(inactivePrice2.id).toBeDefined();

      // 4. Verify both inactive historical prices exist alongside the active price
      const allMonthlyPrices = await prisma.planPrice.findMany({
        where: { planId: starterPlan.id, billingCycle: 'MONTHLY' }
      });
      expect(allMonthlyPrices.filter((p) => p.isActive)).toHaveLength(1);
      expect(allMonthlyPrices.filter((p) => !p.isActive).length).toBeGreaterThanOrEqual(2);

      // Clean up the two test inactive prices
      await prisma.planPrice.deleteMany({
        where: { id: { in: [inactivePrice1.id, inactivePrice2.id] } }
      });
    });
  });

  describe('2. Single Active Subscription vs Historical Retention (Finding 1 & Decision D-02)', () => {
    it('enforces single current subscription per tenant via partial unique index', async () => {
      // 1. Create first ACTIVE subscription for test tenant
      const activeSub = await prisma.tenantSubscription.create({
        data: {
          tenantId: testTenantId,
          planId: starterPlan.id,
          planPriceId: starterPrice.id,
          status: 'ACTIVE',
          billingCycle: 'MONTHLY',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });
      expect(activeSub.id).toBeDefined();

      // 2. Attempt to create a SECOND active subscription for the SAME tenant
      // Must be rejected by idx_tenant_subscriptions_single_active
      await expect(
        prisma.tenantSubscription.create({
          data: {
            tenantId: testTenantId,
            planId: starterPlan.id,
            planPriceId: starterPrice.id,
            status: 'ACTIVE',
            billingCycle: 'MONTHLY',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
          }
        })
      ).rejects.toThrow();

      // 3. Transition the first subscription to CANCELED
      await prisma.tenantSubscription.update({
        where: { id: activeSub.id },
        data: { status: 'CANCELED', canceledAt: new Date() }
      });

      // 4. Now attempt to create a new ACTIVE subscription for the same tenant
      // Must SUCCEED because the previous row is CANCELED (excluded by the partial index)
      const reactivatedSub = await prisma.tenantSubscription.create({
        data: {
          tenantId: testTenantId,
          planId: starterPlan.id,
          planPriceId: starterPrice.id,
          status: 'ACTIVE',
          billingCycle: 'MONTHLY',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });
      expect(reactivatedSub.id).toBeDefined();

      // 5. Verify that BOTH subscription records exist in history
      const allSubscriptions = await prisma.tenantSubscription.findMany({
        where: { tenantId: testTenantId },
        orderBy: { createdAt: 'asc' }
      });
      expect(allSubscriptions).toHaveLength(2);
      expect(allSubscriptions[0].status).toBe('CANCELED');
      expect(allSubscriptions[1].status).toBe('ACTIVE');

      // Clean up for subsequent tests
      await prisma.tenantSubscription.deleteMany({ where: { tenantId: testTenantId } });
    });
  });

  describe('3. Invoices, Payments & Deduplication (Decision D-09)', () => {
    it('creates an invoice with integer paise amounts and links to subscription', async () => {
      const sub = await prisma.tenantSubscription.create({
        data: {
          tenantId: testTenantId,
          planId: starterPlan.id,
          planPriceId: starterPrice.id,
          status: 'ACTIVE',
          billingCycle: 'MONTHLY',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });

      const invoice = await prisma.subscriptionInvoice.create({
        data: {
          invoiceNumber: `INV-TEST-${Date.now()}`,
          tenantId: testTenantId,
          subscriptionId: sub.id,
          planPriceId: starterPrice.id,
          subtotalPaise: 99900n,
          taxPaise: 17982n, // 18% GST = ₹179.82
          totalPaise: 117882n,
          status: 'ISSUED',
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });

      expect(invoice.id).toBeDefined();
      expect(invoice.totalPaise).toBe(117882n);

      // Create Payment with UTR
      const utrNumber = `UTR${Date.now()}`;
      const payment = await prisma.subscriptionPayment.create({
        data: {
          tenantId: testTenantId,
          invoiceId: invoice.id,
          amountPaise: 117882n,
          method: 'UPI',
          referenceNumber: utrNumber,
          status: 'PENDING'
        }
      });
      expect(payment.id).toBeDefined();
      expect(payment.referenceNumber).toBe(utrNumber);

      // Duplicate UTR check: Attempting to insert identical UTR must fail
      await expect(
        prisma.subscriptionPayment.create({
          data: {
            tenantId: testTenantId,
            invoiceId: invoice.id,
            amountPaise: 117882n,
            method: 'UPI',
            referenceNumber: utrNumber, // Duplicate
            status: 'PENDING'
          }
        })
      ).rejects.toThrow();

      // Clean up
      await prisma.subscriptionPayment.deleteMany({ where: { tenantId: testTenantId } });
      await prisma.subscriptionInvoice.deleteMany({ where: { tenantId: testTenantId } });
      await prisma.tenantSubscription.deleteMany({ where: { tenantId: testTenantId } });
    });
  });

  describe('4. Entitlement Overrides (Decision D-08)', () => {
    it('creates an entitlement override with mandatory reason and grantor audit link', async () => {
      const sub = await prisma.tenantSubscription.create({
        data: {
          tenantId: testTenantId,
          planId: starterPlan.id,
          planPriceId: starterPrice.id,
          status: 'ACTIVE',
          billingCycle: 'MONTHLY',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });

      const override = await prisma.tenantEntitlementOverride.create({
        data: {
          tenantId: testTenantId,
          subscriptionId: sub.id,
          featureKey: 'max_outlets',
          valueType: 'NUMERIC',
          numericValue: 3,
          reason: 'Authorized multi-outlet pilot by Superadmin',
          grantedById: superadminUser.id
        }
      });

      expect(override.id).toBeDefined();
      expect(override.numericValue).toBe(3);
      expect(override.featureKey).toBe('max_outlets');

      // Duplicate override for same tenant + featureKey must fail
      await expect(
        prisma.tenantEntitlementOverride.create({
          data: {
            tenantId: testTenantId,
            subscriptionId: sub.id,
            featureKey: 'max_outlets',
            valueType: 'NUMERIC',
            numericValue: 5,
            reason: 'Second duplicate override attempt',
            grantedById: superadminUser.id
          }
        })
      ).rejects.toThrow();

      // Clean up
      await prisma.tenantEntitlementOverride.deleteMany({ where: { tenantId: testTenantId } });
      await prisma.tenantSubscription.deleteMany({ where: { tenantId: testTenantId } });
    });
  });
});
